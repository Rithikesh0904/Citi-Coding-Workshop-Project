-- Expose the identifiers the application needs.
--
-- Found during manual end-to-end testing:
--
--   1. v_resource_allocation returned project_id and user_id but not the
--      allocation's own id, so DELETE /allocations/{id} received "undefined"
--      and PostgreSQL rejected it as a malformed UUID.
--
--   2. v_project_status returned department and manager as display names only.
--      The edit form could not pre-select those dropdowns, so editing any
--      field appeared to require re-entering the department and manager.
--
-- Lesson worth recording: a reporting view designed purely for display is not
-- automatically sufficient for editing. Views that back an editable surface
-- must carry their keys.
--
-- Apply after 003_analytics.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. v_project_status
--
-- mv_portfolio_summary depends on this view, so it must be replaced rather
-- than dropped. CREATE OR REPLACE VIEW only permits appending columns, never
-- reordering or removing them, so the new columns go at the end.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_project_status AS
SELECT
    p.id,
    p.code,
    p.name,
    p.status,
    d.name                                              AS department,
    u.full_name                                         AS manager,
    p.start_date,
    p.planned_end_date,
    p.actual_end_date,
    COUNT(dl.id)                                        AS deliverable_count,
    COUNT(dl.id) FILTER (WHERE dl.status = 'completed') AS completed_count,
    COUNT(dl.id) FILTER (WHERE dl.status = 'blocked')   AS blocked_count,
    COALESCE(ROUND(AVG(dl.percent_complete), 1), 0)     AS avg_percent_complete,
    -- Appended so the edit form can round-trip a project without data loss.
    p.department_id,
    p.manager_id,
    p.description,
    p.planned_budget
FROM projects p
JOIN departments d  ON d.id = p.department_id
JOIN users u        ON u.id = p.manager_id
LEFT JOIN deliverables dl ON dl.project_id = p.id
GROUP BY p.id, p.code, p.name, p.status, d.name, u.full_name,
         p.start_date, p.planned_end_date, p.actual_end_date,
         p.department_id, p.manager_id, p.description, p.planned_budget;

-- ---------------------------------------------------------------------------
-- 2. v_resource_allocation
--
-- Nothing depends on this view, so it can be dropped and rebuilt with the
-- primary key in its natural leading position.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_resource_allocation;

CREATE VIEW v_resource_allocation AS
SELECT
    a.id,
    p.id            AS project_id,
    p.code          AS project_code,
    p.name          AS project_name,
    u.id            AS user_id,
    u.full_name,
    u.role,
    a.deliverable_id,
    a.allocation_pct,
    a.start_date,
    a.end_date,
    ROUND(u.capacity_hours * a.allocation_pct / 100.0, 2) AS allocated_hours_per_week
FROM allocations a
JOIN projects p ON p.id = a.project_id
JOIN users u    ON u.id = a.user_id;

COMMIT;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_portfolio_summary;

-- ---------------------------------------------------------------------------
-- Verification -- both queries must return the new columns
-- ---------------------------------------------------------------------------
--   SELECT code, department_id, manager_id FROM v_project_status LIMIT 3;
--   SELECT id, full_name, project_code FROM v_resource_allocation LIMIT 3;