"""
Project service: the core domain.

Routes (mounted under /api/project-service):
    GET    /health
    GET    /dashboard                     -- all seven business questions
    GET    /projects                      -- filters: status, department_id, manager_id, q
    POST   /projects
    GET    /projects/{id}
    PUT    /projects/{id}
    DELETE /projects/{id}
    GET    /deliverables                  -- filters: project_id, status, overdue
    POST   /deliverables
    PUT    /deliverables/{id}
    DELETE /deliverables/{id}
    GET    /dependencies                  -- full chain, or ?root_id=
    POST   /dependencies
    DELETE /dependencies
    GET    /allocations                   -- filters: project_id, user_id
    POST   /allocations
    DELETE /allocations/{id}
    GET    /budget                        -- consumption per project
    POST   /expenses
    GET    /departments
"""

import db
from http_utils import (ApiError, Router, get_body, get_query, require,
                        respond, validate)

SERVICE = "project-service"

PROJECT_STATUSES = ("planning", "active", "on_hold", "completed", "cancelled")
DELIVERABLE_STATUSES = ("not_started", "in_progress", "blocked", "in_review", "completed")


# --------------------------------------------------------------------------
# Health and dashboard
# --------------------------------------------------------------------------

def health(event, params):
    db.query_one("SELECT 1 AS ok")
    return respond(200, {"status": "healthy", "service": SERVICE})


def dashboard(event, params):
    """
    Answer all seven business questions in a single round trip.

    The frontend dashboard would otherwise fire seven requests on load. One
    endpoint backed by the seven database views keeps the page fast and keeps
    the aggregation logic in SQL where it belongs.
    """
    require(event, "read")

    projects = db.query("SELECT * FROM v_project_status ORDER BY name")
    risks = db.query("SELECT * FROM v_project_risk")
    budgets = db.query("SELECT * FROM v_budget_consumption ORDER BY consumed_pct DESC NULLS LAST")
    over_allocated = db.query(
        "SELECT * FROM v_over_allocated_users ORDER BY total_pct DESC, full_name"
    )
    allocations = db.query(
        "SELECT * FROM v_resource_allocation ORDER BY full_name, start_date"
    )

    # A project is at risk if any single signal fires. Returning the signals
    # alongside the flag lets the UI explain *why* rather than showing an
    # unexplained red badge.
    risk_index = {}
    for row in risks:
        row["at_risk"] = bool(
            row["overdue_deliverables"]
            or row["deliverables_past_project_end"]
            or row["blocked_deliverables"]
            or (row["days_remaining"] is not None and row["days_remaining"] < 0)
        )
        risk_index[str(row["id"])] = row

    for project in projects:
        project["risk"] = risk_index.get(str(project["id"]))

    return respond(200, {
        "projects": projects,
        "risks": risks,
        "budgets": budgets,
        "over_allocated": over_allocated,
        "allocations": allocations,
        "summary": {
            "total_projects": len(projects),
            "active_projects": sum(1 for p in projects if p["status"] == "active"),
            "at_risk_projects": sum(1 for r in risks if r["at_risk"]),
            "over_allocated_people": len({str(o["user_id"]) for o in over_allocated}),
            "total_planned": sum(float(b["planned_budget"] or 0) for b in budgets),
            "total_consumed": sum(float(b["consumed"] or 0) for b in budgets),
        },
    })


# --------------------------------------------------------------------------
# Projects
# --------------------------------------------------------------------------

def list_projects(event, params):
    require(event, "read")
    f = get_query(event)

    sql = "SELECT * FROM v_project_status WHERE 1 = 1"
    args = []
    if f.get("status"):
        sql += " AND status = %s"
        args.append(f["status"])
    if f.get("manager"):
        sql += " AND manager ILIKE %s"
        args.append(f"%{f['manager']}%")
    if f.get("department"):
        sql += " AND department ILIKE %s"
        args.append(f"%{f['department']}%")
    if f.get("q"):
        sql += " AND (name ILIKE %s OR code ILIKE %s)"
        args += [f"%{f['q']}%"] * 2
    sql += " ORDER BY name"

    return respond(200, {"items": db.query(sql, tuple(args))})


def get_project(event, params):
    require(event, "read")
    project = db.query_one("SELECT * FROM v_project_status WHERE id = %s", (params["id"],))
    if not project:
        raise ApiError(404, "Project not found")

    project["deliverables"] = db.query(
        "SELECT d.*, u.full_name AS owner_name FROM deliverables d "
        "LEFT JOIN users u ON u.id = d.owner_id "
        "WHERE d.project_id = %s ORDER BY d.due_date",
        (params["id"],),
    )
    project["budget"] = db.query_one(
        "SELECT * FROM v_budget_consumption WHERE project_id = %s", (params["id"],)
    )
    project["team"] = db.query(
        "SELECT * FROM v_resource_allocation WHERE project_id = %s ORDER BY full_name",
        (params["id"],),
    )
    return respond(200, project)


def create_project(event, params):
    require(event, "create")
    body = validate(get_body(event), required=(
        "code", "name", "department_id", "manager_id", "start_date", "planned_end_date"))

    if body.get("status", "planning") not in PROJECT_STATUSES:
        raise ApiError(400, "Invalid status",
                       [f"status must be one of {', '.join(PROJECT_STATUSES)}"])

    # Verify referenced entities exist so the user gets a clear 400 rather than
    # a raw foreign-key error from PostgreSQL.
    if not db.query_one("SELECT 1 FROM departments WHERE id = %s", (body["department_id"],)):
        raise ApiError(400, "Validation failed", ["department_id does not exist"])
    if not db.query_one("SELECT 1 FROM users WHERE id = %s", (body["manager_id"],)):
        raise ApiError(400, "Validation failed", ["manager_id does not exist"])
    if db.query_one("SELECT 1 FROM projects WHERE code = %s", (body["code"],)):
        raise ApiError(400, "Validation failed", ["A project with that code already exists"])

    created = db.execute(
        "INSERT INTO projects (code, name, description, department_id, manager_id, "
        "status, start_date, planned_end_date, planned_budget) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
        (body["code"], body["name"], body.get("description"), body["department_id"],
         body["manager_id"], body.get("status", "planning"), body["start_date"],
         body["planned_end_date"], body.get("planned_budget", 0)),
    )
    return respond(201, created)


def update_project(event, params):
    require(event, "update")
    body = get_body(event)
    if not db.query_one("SELECT 1 FROM projects WHERE id = %s", (params["id"],)):
        raise ApiError(404, "Project not found")

    updates, args = [], []
    for field in ("code", "name", "description", "department_id", "manager_id",
                  "status", "start_date", "planned_end_date", "actual_end_date",
                  "planned_budget"):
        if field in body:
            updates.append(f"{field} = %s")
            args.append(body[field])
    if not updates:
        raise ApiError(400, "No updatable fields supplied")

    args.append(params["id"])
    return respond(200, db.execute(
        f"UPDATE projects SET {', '.join(updates)} WHERE id = %s RETURNING *", tuple(args)
    ))


def delete_project(event, params):
    require(event, "delete")
    if not db.query_one("SELECT 1 FROM projects WHERE id = %s", (params["id"],)):
        raise ApiError(404, "Project not found")
    db.execute("DELETE FROM projects WHERE id = %s", (params["id"],))
    return respond(204)


# --------------------------------------------------------------------------
# Deliverables
# --------------------------------------------------------------------------

def list_deliverables(event, params):
    require(event, "read")
    f = get_query(event)

    sql = ("SELECT d.*, u.full_name AS owner_name, p.code AS project_code "
           "FROM deliverables d "
           "LEFT JOIN users u ON u.id = d.owner_id "
           "JOIN projects p ON p.id = d.project_id WHERE 1 = 1")
    args = []
    if f.get("project_id"):
        sql += " AND d.project_id = %s"
        args.append(f["project_id"])
    if f.get("status"):
        sql += " AND d.status = %s"
        args.append(f["status"])
    if f.get("overdue") == "true":
        sql += " AND d.status <> 'completed' AND d.due_date < CURRENT_DATE"
    if f.get("q"):
        sql += " AND d.name ILIKE %s"
        args.append(f"%{f['q']}%")
    sql += " ORDER BY d.due_date"

    return respond(200, {"items": db.query(sql, tuple(args))})


def create_deliverable(event, params):
    require(event, "create")
    body = validate(get_body(event), required=("project_id", "name", "due_date"))

    if body.get("status", "not_started") not in DELIVERABLE_STATUSES:
        raise ApiError(400, "Invalid status")
    if not db.query_one("SELECT 1 FROM projects WHERE id = %s", (body["project_id"],)):
        raise ApiError(400, "Validation failed", ["project_id does not exist"])

    percent = int(body.get("percent_complete", 0))
    if not 0 <= percent <= 100:
        raise ApiError(400, "Validation failed", ["percent_complete must be 0-100"])

    status = body.get("status", "not_started")
    completed_at = body.get("completed_at")
    # The schema enforces this pair; filling it in here avoids a confusing
    # constraint-violation message reaching the user.
    if status == "completed":
        percent = 100
        completed_at = completed_at or "CURRENT_DATE"

    created = db.execute(
        "INSERT INTO deliverables (project_id, owner_id, name, description, status, "
        "percent_complete, due_date, completed_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, "
        "COALESCE(%s::date, CASE WHEN %s = 'completed' THEN CURRENT_DATE END)) RETURNING *",
        (body["project_id"], body.get("owner_id"), body["name"], body.get("description"),
         status, percent, body["due_date"],
         body.get("completed_at"), status),
    )
    return respond(201, created)


def update_deliverable(event, params):
    require(event, "update")
    body = get_body(event)
    existing = db.query_one("SELECT * FROM deliverables WHERE id = %s", (params["id"],))
    if not existing:
        raise ApiError(404, "Deliverable not found")

    status = body.get("status", existing["status"])
    if status not in DELIVERABLE_STATUSES:
        raise ApiError(400, "Invalid status")

    percent = int(body.get("percent_complete", existing["percent_complete"]))
    completed_at = body.get("completed_at", existing["completed_at"])
    if status == "completed":
        percent = 100
        completed_at = completed_at or "today"

    return respond(200, db.execute(
        "UPDATE deliverables SET name = %s, description = %s, owner_id = %s, "
        "status = %s, percent_complete = %s, due_date = %s, "
        "completed_at = CASE WHEN %s = 'completed' "
        "                    THEN COALESCE(%s::date, CURRENT_DATE) ELSE NULL END "
        "WHERE id = %s RETURNING *",
        (body.get("name", existing["name"]),
         body.get("description", existing["description"]),
         body.get("owner_id", existing["owner_id"]),
         status, percent, body.get("due_date", existing["due_date"]),
         status,
         None if completed_at in ("today", None) else completed_at,
         params["id"]),
    ))


def delete_deliverable(event, params):
    require(event, "delete")
    if not db.query_one("SELECT 1 FROM deliverables WHERE id = %s", (params["id"],)):
        raise ApiError(404, "Deliverable not found")
    db.execute("DELETE FROM deliverables WHERE id = %s", (params["id"],))
    return respond(204)


# --------------------------------------------------------------------------
# Dependencies
# --------------------------------------------------------------------------

def list_dependencies(event, params):
    require(event, "read")
    f = get_query(event)

    edges = db.query(
        "SELECT dd.predecessor_id, dd.successor_id, dd.dep_type, "
        "       p.name AS predecessor_name, s.name AS successor_name, "
        "       s.status AS successor_status "
        "FROM deliverable_dependencies dd "
        "JOIN deliverables p ON p.id = dd.predecessor_id "
        "JOIN deliverables s ON s.id = dd.successor_id"
    )

    if f.get("root_id"):
        chain = db.query(
            "SELECT * FROM v_deliverable_dependency_chain "
            "WHERE root_id = %s ORDER BY depth",
            (f["root_id"],),
        )
    else:
        chain = db.query("SELECT * FROM v_deliverable_dependency_chain ORDER BY depth")

    return respond(200, {"edges": edges, "chain": chain})


def create_dependency(event, params):
    require(event, "create")
    body = validate(get_body(event), required=("predecessor_id", "successor_id"))

    if body["predecessor_id"] == body["successor_id"]:
        raise ApiError(400, "A deliverable cannot depend on itself")
    for key in ("predecessor_id", "successor_id"):
        if not db.query_one("SELECT 1 FROM deliverables WHERE id = %s", (body[key],)):
            raise ApiError(400, "Validation failed", [f"{key} does not exist"])

    try:
        created = db.execute(
            "INSERT INTO deliverable_dependencies (predecessor_id, successor_id, dep_type) "
            "VALUES (%s, %s, %s) RETURNING *",
            (body["predecessor_id"], body["successor_id"],
             body.get("dep_type", "finish_to_start")),
        )
    except Exception as exc:
        # The database trigger rejects cycles. Translating it here turns a 500
        # into an actionable 400 the user can understand.
        if "cycle" in str(exc).lower():
            raise ApiError(400, "That dependency would create a circular chain")
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise ApiError(400, "That dependency already exists")
        raise
    return respond(201, created)


def delete_dependency(event, params):
    require(event, "delete")
    body = validate(get_body(event), required=("predecessor_id", "successor_id"))
    result = db.execute(
        "DELETE FROM deliverable_dependencies "
        "WHERE predecessor_id = %s AND successor_id = %s",
        (body["predecessor_id"], body["successor_id"]),
    )
    if result.get("rowcount", 0) == 0:
        raise ApiError(404, "Dependency not found")
    return respond(204)


# --------------------------------------------------------------------------
# Allocations
# --------------------------------------------------------------------------

def list_allocations(event, params):
    require(event, "read")
    f = get_query(event)

    sql = "SELECT * FROM v_resource_allocation WHERE 1 = 1"
    args = []
    if f.get("project_id"):
        sql += " AND project_id = %s"
        args.append(f["project_id"])
    if f.get("user_id"):
        sql += " AND user_id = %s"
        args.append(f["user_id"])
    sql += " ORDER BY full_name, start_date"

    return respond(200, {
        "items": db.query(sql, tuple(args)),
        "over_allocated": db.query(
            "SELECT * FROM v_over_allocated_users ORDER BY total_pct DESC"
        ),
    })


def create_allocation(event, params):
    require(event, "create")
    body = validate(get_body(event), required=(
        "project_id", "user_id", "allocation_pct", "start_date", "end_date"))

    pct = int(body["allocation_pct"])
    if not 1 <= pct <= 100:
        raise ApiError(400, "Validation failed", ["allocation_pct must be 1-100"])
    if body["end_date"] < body["start_date"]:
        raise ApiError(400, "Validation failed", ["end_date must not precede start_date"])

    created = db.execute(
        "INSERT INTO allocations (project_id, user_id, deliverable_id, "
        "allocation_pct, start_date, end_date) "
        "VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
        (body["project_id"], body["user_id"], body.get("deliverable_id"),
         pct, body["start_date"], body["end_date"]),
    )

    # Deliberately allowed, but reported. The business asked us to *find*
    # over-allocated people, so blocking the write would hide the signal.
    conflict = db.query_one(
        "SELECT total_pct FROM v_over_allocated_users "
        "WHERE user_id = %s ORDER BY total_pct DESC LIMIT 1",
        (body["user_id"],),
    )
    return respond(201, {
        **created,
        "warning": (f"This person is now allocated {conflict['total_pct']}% "
                    f"at peak") if conflict else None,
    })


def delete_allocation(event, params):
    require(event, "delete")
    result = db.execute("DELETE FROM allocations WHERE id = %s", (params["id"],))
    if result.get("rowcount", 0) == 0:
        raise ApiError(404, "Allocation not found")
    return respond(204)


# --------------------------------------------------------------------------
# Budget
# --------------------------------------------------------------------------

def list_budget(event, params):
    require(event, "read")
    f = get_query(event)
    if f.get("project_id"):
        return respond(200, {
            "summary": db.query_one(
                "SELECT * FROM v_budget_consumption WHERE project_id = %s",
                (f["project_id"],)),
            "lines": db.query(
                "SELECT bl.*, COALESCE(SUM(e.amount), 0) AS spent "
                "FROM budget_lines bl LEFT JOIN expenses e ON e.budget_line_id = bl.id "
                "WHERE bl.project_id = %s GROUP BY bl.id ORDER BY bl.category",
                (f["project_id"],)),
        })
    return respond(200, {"items": db.query(
        "SELECT * FROM v_budget_consumption ORDER BY consumed_pct DESC NULLS LAST")})


def create_expense(event, params):
    require(event, "create")
    body = validate(get_body(event), required=("budget_line_id", "amount", "incurred_on"))
    if float(body["amount"]) <= 0:
        raise ApiError(400, "Validation failed", ["amount must be greater than zero"])
    if not db.query_one("SELECT 1 FROM budget_lines WHERE id = %s", (body["budget_line_id"],)):
        raise ApiError(400, "Validation failed", ["budget_line_id does not exist"])

    return respond(201, db.execute(
        "INSERT INTO expenses (budget_line_id, amount, incurred_on, description) "
        "VALUES (%s, %s, %s, %s) RETURNING *",
        (body["budget_line_id"], body["amount"], body["incurred_on"],
         body.get("description")),
    ))


def list_departments(event, params):
    require(event, "read")
    return respond(200, {"items": db.query("SELECT * FROM departments ORDER BY name")})


# --------------------------------------------------------------------------
# Wiring
# --------------------------------------------------------------------------

router = (
    Router(SERVICE)
    .add("GET", "/health", health)
    .add("GET", "/", health)
    .add("GET", "/dashboard", dashboard)
    .add("GET", "/projects", list_projects)
    .add("POST", "/projects", create_project)
    .add("GET", "/projects/{id}", get_project)
    .add("PUT", "/projects/{id}", update_project)
    .add("DELETE", "/projects/{id}", delete_project)
    .add("GET", "/deliverables", list_deliverables)
    .add("POST", "/deliverables", create_deliverable)
    .add("PUT", "/deliverables/{id}", update_deliverable)
    .add("DELETE", "/deliverables/{id}", delete_deliverable)
    .add("GET", "/dependencies", list_dependencies)
    .add("POST", "/dependencies", create_dependency)
    .add("DELETE", "/dependencies", delete_dependency)
    .add("GET", "/allocations", list_allocations)
    .add("POST", "/allocations", create_allocation)
    .add("DELETE", "/allocations/{id}", delete_allocation)
    .add("GET", "/budget", list_budget)
    .add("POST", "/expenses", create_expense)
    .add("GET", "/departments", list_departments)
)


def handler(event=None, context=None):
    return router.dispatch(event or {}, context)


if __name__ == "__main__":
    print(handler({"rawPath": "/health",
                   "requestContext": {"http": {"method": "GET"}}}))