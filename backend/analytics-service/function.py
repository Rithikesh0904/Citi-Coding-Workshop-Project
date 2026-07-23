"""
Analytics service: the read-model and intelligence layer.

Kept separate from project-service because it is a genuinely different bounded
context. project-service owns transactional writes; this owns derived reads,
scoring, and forecasting. They scale differently and fail differently.

Routes (mounted under /api/analytics-service):
    GET  /health
    GET  /portfolio        -- materialised summary, one fast read
    GET  /forecast         -- projected completion dates and variance
    GET  /scores           -- explainable project health scores
    GET  /insights         -- generated narrative findings
    GET  /audit            -- who changed what, filterable
    POST /refresh          -- rebuild the materialised view (batch job)

On the "intelligent features" requirement: the scoring and insight generation
here are deterministic and rule-based, not machine-learned. That is a
deliberate choice, documented in the README. A project manager can audit and
argue with a weighted score; they cannot audit a black box. Every score
returned includes the component breakdown that produced it.
"""

import db
from http_utils import ApiError, Router, get_query, require, respond

SERVICE = "analytics-service"

# Weights sum to 100. Tuned so schedule slippage dominates, because the
# business problem is fundamentally about missed deadlines.
WEIGHTS = {
    "schedule": 40,
    "progress": 30,
    "budget": 20,
    "blockers": 10,
}


def health(event, params):
    db.query_one("SELECT 1 AS ok")
    return respond(200, {"status": "healthy", "service": SERVICE})


# --------------------------------------------------------------------------
# Portfolio (materialised)
# --------------------------------------------------------------------------

def portfolio(event, params):
    require(event, "read")
    rows = db.query("SELECT * FROM mv_portfolio_summary ORDER BY name")
    return respond(200, {
        "items": rows,
        "refreshed_at": rows[0]["refreshed_at"] if rows else None,
        "note": "Served from a materialised view. POST /refresh to rebuild.",
    })


def refresh(event, params):
    """
    Rebuild the materialised view.

    This is the batch/async pattern the guide asks for. CONCURRENTLY means
    readers are never blocked while it runs. In production this would be
    triggered by EventBridge on a schedule rather than by a request; exposing
    it as an endpoint keeps the behaviour demonstrable.
    """
    require(event, "update")
    db.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_portfolio_summary")
    row = db.query_one("SELECT max(refreshed_at) AS refreshed_at FROM mv_portfolio_summary")
    return respond(200, {
        "status": "refreshed",
        "refreshed_at": row["refreshed_at"] if row else None,
    })


# --------------------------------------------------------------------------
# Forecasting
# --------------------------------------------------------------------------

def forecast(event, params):
    require(event, "read")
    rows = db.query(
        "SELECT * FROM v_project_forecast ORDER BY forecast_variance_days DESC NULLS LAST"
    )

    for row in rows:
        variance = row.get("forecast_variance_days")
        if variance is None:
            row["verdict"] = "no_data"
            row["explanation"] = (
                "No measurable progress yet, so no forecast can be produced."
            )
        elif variance > 14:
            row["verdict"] = "late"
            row["explanation"] = (
                f"At the current rate this finishes about {variance} days after "
                f"the planned end date."
            )
        elif variance > 0:
            row["verdict"] = "at_risk"
            row["explanation"] = (
                f"Tracking roughly {variance} days behind plan -- recoverable, "
                f"but slipping."
            )
        else:
            row["verdict"] = "on_track"
            row["explanation"] = (
                f"Tracking about {abs(variance)} days ahead of the planned end date."
            )

    return respond(200, {
        "items": rows,
        "model": "linear velocity",
        "assumption": (
            "Projects continue at their observed average rate. Over-estimates "
            "completion for projects that front-load simple work."
        ),
    })


# --------------------------------------------------------------------------
# Health scoring
# --------------------------------------------------------------------------

def _score_project(row) -> dict:
    """
    Produce a 0-100 health score with a full component breakdown.

    Each component is scored 0-100 independently, then weighted. Returning the
    breakdown means the number is arguable rather than mysterious.
    """
    components = {}

    # Schedule: how far the forecast slips past the planned end date.
    variance = row.get("forecast_variance_days")
    if variance is None:
        components["schedule"] = 50    # unknown, treated as neutral
    else:
        components["schedule"] = max(0, min(100, 100 - max(0, variance) * 2))

    # Progress: actual completion against where the calendar says we should be.
    actual = float(row.get("avg_percent_complete") or 0)
    expected = float(row.get("expected_pct_complete") or 0)
    if expected <= 0:
        components["progress"] = 100
    else:
        components["progress"] = max(0, min(100, round(100 * actual / expected)))

    # Budget: burn rate against progress. Spending 80% to deliver 40% is bad.
    consumed_pct = row.get("consumed_pct")
    if consumed_pct is None:
        components["budget"] = 100
    elif actual <= 0:
        components["budget"] = max(0, 100 - float(consumed_pct))
    else:
        burn_ratio = float(consumed_pct) / actual
        components["budget"] = max(0, min(100, round(100 - (burn_ratio - 1) * 50)))

    # Blockers: overdue and blocked deliverables, capped.
    penalty = (int(row.get("overdue_deliverables") or 0) * 15
               + int(row.get("blocked_count") or 0) * 20)
    components["blockers"] = max(0, 100 - penalty)

    total = round(sum(components[k] * WEIGHTS[k] / 100 for k in WEIGHTS))

    if total >= 80:
        band = "healthy"
    elif total >= 60:
        band = "watch"
    elif total >= 40:
        band = "at_risk"
    else:
        band = "critical"

    return {
        "project_id": row["project_id"],
        "code": row["code"],
        "name": row["name"],
        "score": total,
        "band": band,
        "components": components,
        "weights": WEIGHTS,
        "drivers": sorted(
            [{"factor": k, "score": v} for k, v in components.items()],
            key=lambda c: c["score"],
        )[:2],
    }


def scores(event, params):
    require(event, "read")
    rows = db.query("SELECT * FROM mv_portfolio_summary")
    scored = sorted((_score_project(r) for r in rows), key=lambda s: s["score"])
    return respond(200, {
        "items": scored,
        "methodology": (
            "Weighted composite of four components. Every score includes its "
            "breakdown so it can be challenged rather than trusted blindly."
        ),
    })


# --------------------------------------------------------------------------
# Insights
# --------------------------------------------------------------------------

def insights(event, params):
    """
    Turn the analytical views into plain-language findings.

    Rule-based, ordered by severity. Each finding names the evidence so a
    reader can verify it rather than take it on faith.
    """
    require(event, "read")
    findings = []

    for row in db.query(
        "SELECT * FROM mv_portfolio_summary "
        "WHERE forecast_variance_days > 14 ORDER BY forecast_variance_days DESC"
    ):
        findings.append({
            "severity": "high",
            "category": "schedule",
            "title": f"{row['code']} is forecast to finish late",
            "detail": (
                f"{row['name']} is {row['avg_percent_complete']}% complete "
                f"against an expected {row['expected_pct_complete']}%. "
                f"Projected overrun is {row['forecast_variance_days']} days."
            ),
            "project_id": row["project_id"],
        })

    for row in db.query(
        "SELECT * FROM v_budget_consumption WHERE consumed_pct > 90 "
        "ORDER BY consumed_pct DESC"
    ):
        findings.append({
            "severity": "high" if float(row["consumed_pct"]) > 100 else "medium",
            "category": "budget",
            "title": f"{row['project_code']} has consumed {row['consumed_pct']}% of budget",
            "detail": (
                f"{row['consumed']:,.0f} spent against {row['allocated_to_lines']:,.0f} "
                f"planned across all budget lines."
            ),
            "project_id": row["project_id"],
        })

    for row in db.query(
        "SELECT full_name, MAX(total_pct) AS peak, MAX(concurrent_projects) AS projects "
        "FROM v_over_allocated_users GROUP BY full_name ORDER BY peak DESC"
    ):
        findings.append({
            "severity": "high" if row["peak"] > 120 else "medium",
            "category": "resourcing",
            "title": f"{row['full_name']} is allocated {row['peak']}% at peak",
            "detail": (
                f"Committed across {row['projects']} projects simultaneously. "
                f"Anything above 100% means promised capacity that does not exist."
            ),
        })

    for row in db.query(
        "SELECT c.root_name, c.descendant_name, c.depth "
        "FROM v_deliverable_dependency_chain c "
        "JOIN deliverables d ON d.id = c.root_id "
        "WHERE d.status = 'blocked' ORDER BY c.depth DESC"
    ):
        findings.append({
            "severity": "high",
            "category": "dependencies",
            "title": f"Blocked work is stalling {row['descendant_name']}",
            "detail": (
                f"'{row['root_name']}' is blocked and sits {row['depth']} "
                f"step(s) upstream of '{row['descendant_name']}'."
            ),
        })

    order = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: order.get(f["severity"], 3))

    return respond(200, {
        "items": findings,
        "generated": "rule-based analysis over the reporting views",
        "counts": {
            "high": sum(1 for f in findings if f["severity"] == "high"),
            "medium": sum(1 for f in findings if f["severity"] == "medium"),
        },
    })


# --------------------------------------------------------------------------
# Audit trail
# --------------------------------------------------------------------------

def audit(event, params):
    require(event, "read")
    f = get_query(event)

    sql = "SELECT * FROM audit_log WHERE 1 = 1"
    args = []
    if f.get("table"):
        sql += " AND table_name = %s"
        args.append(f["table"])
    if f.get("record_id"):
        sql += " AND record_id = %s"
        args.append(f["record_id"])
    if f.get("operation"):
        sql += " AND operation = %s"
        args.append(f["operation"].upper())

    limit = min(int(f.get("limit", 100)), 500)
    sql += " ORDER BY occurred_at DESC LIMIT %s"
    args.append(limit)

    return respond(200, {"items": db.query(sql, tuple(args)), "limit": limit})


router = (
    Router(SERVICE)
    .add("GET", "/health", health)
    .add("GET", "/", health)
    .add("GET", "/portfolio", portfolio)
    .add("POST", "/refresh", refresh)
    .add("GET", "/forecast", forecast)
    .add("GET", "/scores", scores)
    .add("GET", "/insights", insights)
    .add("GET", "/audit", audit)
)


def handler(event=None, context=None):
    return router.dispatch(event or {}, context)


if __name__ == "__main__":
    print(handler({"rawPath": "/health",
                   "requestContext": {"http": {"method": "GET"}}}))
