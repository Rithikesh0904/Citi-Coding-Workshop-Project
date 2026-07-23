-- Analytics, audit, and forecasting layer.
--
-- Adds three capabilities the transactional schema does not cover:
--   1. Audit logging  -- who changed what, written automatically by triggers
--   2. Forecasting    -- projected completion dates from observed velocity
--   3. Materialised dashboard -- precomputed summary for fast page loads
--
-- Apply after 001_initial_schema.sql and 002_seed_data.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Audit log
--
-- Implemented as database triggers rather than application code. A trigger
-- cannot be forgotten when someone adds a new endpoint, and it captures
-- changes made directly in psql during a demo. The trade-off is that the
-- actor is only recorded when the application sets it, so the column is
-- nullable rather than NOT NULL.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    table_name  TEXT        NOT NULL,
    record_id   UUID,
    operation   TEXT        NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    actor_id    UUID,
    actor_email TEXT,
    changed     JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_occurred  ON audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_table     ON audit_log (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor     ON audit_log (actor_id);

CREATE OR REPLACE FUNCTION write_audit_log() RETURNS TRIGGER AS $$
DECLARE
    v_record_id UUID;
    v_changed   JSONB;
BEGIN
    -- current_setting with missing_ok = true returns NULL rather than raising
    -- when the application has not set the session variable.
    IF TG_OP = 'DELETE' THEN
        v_record_id := OLD.id;
        v_changed   := to_jsonb(OLD);
    ELSIF TG_OP = 'UPDATE' THEN
        v_record_id := NEW.id;
        -- Store only the fields that actually changed, not the whole row.
        SELECT jsonb_object_agg(key, jsonb_build_object('from', OLD_J.value, 'to', NEW_J.value))
          INTO v_changed
          FROM jsonb_each(to_jsonb(OLD)) AS OLD_J(key, value)
          JOIN jsonb_each(to_jsonb(NEW)) AS NEW_J(key, value) USING (key)
         WHERE OLD_J.value IS DISTINCT FROM NEW_J.value;
    ELSE
        v_record_id := NEW.id;
        v_changed   := to_jsonb(NEW);
    END IF;

    -- Never log password hashes into the audit trail.
    v_changed := v_changed - 'password_hash';

    INSERT INTO audit_log (table_name, record_id, operation, actor_id, actor_email, changed)
    VALUES (
        TG_TABLE_NAME,
        v_record_id,
        TG_OP,
        NULLIF(current_setting('app.actor_id', true), '')::UUID,
        NULLIF(current_setting('app.actor_email', true), ''),
        v_changed
    );

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_projects     ON projects;
DROP TRIGGER IF EXISTS audit_deliverables ON deliverables;
DROP TRIGGER IF EXISTS audit_allocations  ON allocations;
DROP TRIGGER IF EXISTS audit_expenses     ON expenses;
DROP TRIGGER IF EXISTS audit_users        ON users;

CREATE TRIGGER audit_projects     AFTER INSERT OR UPDATE OR DELETE ON projects
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER audit_deliverables AFTER INSERT OR UPDATE OR DELETE ON deliverables
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER audit_allocations  AFTER INSERT OR UPDATE OR DELETE ON allocations
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER audit_expenses     AFTER INSERT OR UPDATE OR DELETE ON expenses
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();
CREATE TRIGGER audit_users        AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();


-- ---------------------------------------------------------------------------
-- 2. Delivery forecasting
--
-- Answers the brief's "difficulty in forecasting project completion dates".
--
-- Model: linear velocity. If a project is 40% complete after 60 days, the full
-- 100% is projected to take 150 days, so the forecast end date is start_date
-- plus 150 days. Deliberately simple and explainable -- a project manager can
-- verify the arithmetic by hand, which matters more here than sophistication.
--
-- Limitation documented in README: assumes constant velocity, so it over-
-- estimates for projects that front-load easy work. Projects with 0% progress
-- return NULL rather than infinity.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_project_forecast AS
WITH progress AS (
    SELECT
        p.id,
        p.code,
        p.name,
        p.status,
        p.start_date,
        p.planned_end_date,
        GREATEST(CURRENT_DATE - p.start_date, 1)      AS days_elapsed,
        (p.planned_end_date - p.start_date)           AS planned_duration,
        COALESCE(AVG(d.percent_complete), 0)          AS pct_complete,
        COUNT(d.id)                                   AS deliverable_count
    FROM projects p
    LEFT JOIN deliverables d ON d.project_id = p.id
    WHERE p.status IN ('planning', 'active', 'on_hold')
    GROUP BY p.id, p.code, p.name, p.status, p.start_date, p.planned_end_date
)
SELECT
    id,
    code,
    name,
    status,
    start_date,
    planned_end_date,
    planned_duration,
    days_elapsed,
    ROUND(pct_complete, 1) AS pct_complete,
    deliverable_count,

    -- Projected total duration = elapsed / fraction complete
    CASE WHEN pct_complete > 0
         THEN ROUND(days_elapsed / (pct_complete / 100.0))::INT
    END AS forecast_duration_days,

    CASE WHEN pct_complete > 0
         THEN start_date + ROUND(days_elapsed / (pct_complete / 100.0))::INT
    END AS forecast_end_date,

    -- Positive = predicted to finish late, negative = early
    CASE WHEN pct_complete > 0
         THEN (start_date + ROUND(days_elapsed / (pct_complete / 100.0))::INT)
              - planned_end_date
    END AS forecast_variance_days,

    -- Progress we should have made by now if velocity were on plan
    CASE WHEN planned_duration > 0
         THEN LEAST(ROUND(100.0 * days_elapsed / planned_duration, 1), 100)
    END AS expected_pct_complete
FROM progress;


-- ---------------------------------------------------------------------------
-- 3. Materialised dashboard summary
--
-- The dashboard aggregates across five views on every page load. Materialising
-- it turns that into a single indexed read. Refreshed on demand through the
-- analytics service rather than on a schedule, because a workshop demo needs
-- the refresh to be visible and explainable.
-- ---------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS mv_portfolio_summary;

CREATE MATERIALIZED VIEW mv_portfolio_summary AS
SELECT
    ps.id                   AS project_id,
    ps.code,
    ps.name,
    ps.status,
    ps.department,
    ps.manager,
    ps.planned_end_date,
    ps.deliverable_count,
    ps.completed_count,
    ps.blocked_count,
    ps.avg_percent_complete,
    COALESCE(pr.overdue_deliverables, 0)            AS overdue_deliverables,
    COALESCE(pr.deliverables_past_project_end, 0)   AS deliverables_past_project_end,
    pr.days_remaining,
    bc.planned_budget,
    bc.consumed,
    bc.consumed_pct,
    f.forecast_end_date,
    f.forecast_variance_days,
    f.expected_pct_complete,
    now()                                           AS refreshed_at
FROM v_project_status ps
LEFT JOIN v_project_risk        pr ON pr.id = ps.id
LEFT JOIN v_budget_consumption  bc ON bc.project_id = ps.id
LEFT JOIN v_project_forecast    f  ON f.id = ps.id;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY, which lets the refresh
-- run without blocking readers.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_portfolio_project
    ON mv_portfolio_summary (project_id);

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
--   SELECT code, pct_complete, expected_pct_complete, forecast_variance_days
--     FROM v_project_forecast ORDER BY forecast_variance_days DESC NULLS LAST;
--   SELECT table_name, operation, count(*) FROM audit_log GROUP BY 1, 2;
--   REFRESH MATERIALIZED VIEW CONCURRENTLY mv_portfolio_summary;
