-- ACME Inc. project management and tracking platform
-- Target: PostgreSQL 13+ (local) / Aurora Serverless PostgreSQL (cloud)
--
-- Design notes:
--   * Status and role columns use TEXT + CHECK rather than native ENUM types,
--     because adding a value to a native enum requires ALTER TYPE and cannot
--     run inside some migration transactions. CHECK constraints are cheap to
--     amend and produce clearer error messages.
--   * Role vocabulary matches the workshop guide exactly: admin, manager,
--     contributor, viewer.
--   * Over-allocation is DETECTED, not PREVENTED. Blocking an over-allocating
--     INSERT would hide exactly the condition the business wants surfaced.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Core entities
-- ---------------------------------------------------------------------------

CREATE TABLE departments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email             TEXT NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,
    full_name         TEXT NOT NULL,
    role              TEXT NOT NULL DEFAULT 'viewer'
                      CHECK (role IN ('admin', 'manager', 'contributor', 'viewer')),
    capacity_hours    NUMERIC(5,2) NOT NULL DEFAULT 40.00
                      CHECK (capacity_hours > 0),
    cost_rate         NUMERIC(10,2) CHECK (cost_rate IS NULL OR cost_rate >= 0),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE projects (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code              TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    description       TEXT,
    department_id     UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    manager_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status            TEXT NOT NULL DEFAULT 'planning'
                      CHECK (status IN ('planning', 'active', 'on_hold',
                                        'completed', 'cancelled')),
    start_date        DATE NOT NULL,
    planned_end_date  DATE NOT NULL,
    actual_end_date   DATE,
    planned_budget    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (planned_budget >= 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT projects_dates_ordered CHECK (planned_end_date >= start_date),
    CONSTRAINT projects_actual_end_valid
        CHECK (actual_end_date IS NULL OR actual_end_date >= start_date)
);

CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE deliverables (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    owner_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    name              TEXT NOT NULL,
    description       TEXT,
    status            TEXT NOT NULL DEFAULT 'not_started'
                      CHECK (status IN ('not_started', 'in_progress', 'blocked',
                                        'in_review', 'completed')),
    percent_complete  SMALLINT NOT NULL DEFAULT 0
                      CHECK (percent_complete BETWEEN 0 AND 100),
    due_date          DATE NOT NULL,
    completed_at      DATE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A deliverable marked complete must carry a completion date and 100%.
    CONSTRAINT deliverables_completion_consistent CHECK (
        (status <> 'completed') OR
        (completed_at IS NOT NULL AND percent_complete = 100)
    ),
    -- Enables the composite FK on allocations below.
    CONSTRAINT deliverables_id_project_unique UNIQUE (id, project_id)
);

CREATE TRIGGER deliverables_updated_at BEFORE UPDATE ON deliverables
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Many-to-many: a deliverable may have several predecessors and successors.
CREATE TABLE deliverable_dependencies (
    predecessor_id  UUID NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
    successor_id    UUID NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
    dep_type        TEXT NOT NULL DEFAULT 'finish_to_start'
                    CHECK (dep_type IN ('finish_to_start', 'start_to_start',
                                        'finish_to_finish', 'start_to_finish')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (predecessor_id, successor_id),
    CONSTRAINT no_self_dependency CHECK (predecessor_id <> successor_id)
);

CREATE TABLE allocations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deliverable_id  UUID,
    allocation_pct  SMALLINT NOT NULL CHECK (allocation_pct BETWEEN 1 AND 100),
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT allocations_dates_ordered CHECK (end_date >= start_date),
    -- Composite FK: a deliverable-scoped allocation cannot point at a
    -- deliverable belonging to a different project.
    CONSTRAINT allocations_deliverable_in_project
        FOREIGN KEY (deliverable_id, project_id)
        REFERENCES deliverables(id, project_id) ON DELETE CASCADE
);

CREATE TABLE budget_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    category        TEXT NOT NULL,
    planned_amount  NUMERIC(14,2) NOT NULL CHECK (planned_amount >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, category)
);

CREATE TABLE expenses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_line_id  UUID NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
    amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    incurred_on     DATE NOT NULL,
    description     TEXT,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes supporting the reporting views
-- ---------------------------------------------------------------------------

CREATE INDEX idx_projects_status         ON projects (status);
CREATE INDEX idx_projects_planned_end    ON projects (planned_end_date);
CREATE INDEX idx_projects_department     ON projects (department_id);
CREATE INDEX idx_deliverables_project    ON deliverables (project_id);
CREATE INDEX idx_deliverables_status     ON deliverables (status);
CREATE INDEX idx_deliverables_due_date   ON deliverables (due_date);
CREATE INDEX idx_deliverables_owner      ON deliverables (owner_id);
CREATE INDEX idx_dependencies_successor  ON deliverable_dependencies (successor_id);
CREATE INDEX idx_allocations_user        ON allocations (user_id);
CREATE INDEX idx_allocations_project     ON allocations (project_id);
CREATE INDEX idx_allocations_window      ON allocations (start_date, end_date);
CREATE INDEX idx_budget_lines_project    ON budget_lines (project_id);
CREATE INDEX idx_expenses_budget_line    ON expenses (budget_line_id);
CREATE INDEX idx_expenses_incurred_on    ON expenses (incurred_on);

-- ---------------------------------------------------------------------------
-- Q1 + Q4: current status of each project, with deliverable rollup
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
    COALESCE(ROUND(AVG(dl.percent_complete), 1), 0)     AS avg_percent_complete
FROM projects p
JOIN departments d  ON d.id = p.department_id
JOIN users u        ON u.id = p.manager_id
LEFT JOIN deliverables dl ON dl.project_id = p.id
GROUP BY p.id, p.code, p.name, p.status, d.name, u.full_name,
         p.start_date, p.planned_end_date, p.actual_end_date;

-- ---------------------------------------------------------------------------
-- Q2: projects at risk of missing their deadline
--
-- Three independent risk signals, surfaced separately so the UI can explain
-- WHY a project is flagged rather than showing an opaque boolean.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_project_risk AS
SELECT
    p.id,
    p.code,
    p.name,
    p.planned_end_date,
    (p.planned_end_date - CURRENT_DATE)                     AS days_remaining,
    COUNT(dl.id) FILTER (
        WHERE dl.status <> 'completed' AND dl.due_date < CURRENT_DATE
    )                                                       AS overdue_deliverables,
    COUNT(dl.id) FILTER (
        WHERE dl.status <> 'completed' AND dl.due_date > p.planned_end_date
    )                                                       AS deliverables_past_project_end,
    COUNT(dl.id) FILTER (WHERE dl.status = 'blocked')       AS blocked_deliverables
FROM projects p
LEFT JOIN deliverables dl ON dl.project_id = p.id
WHERE p.status IN ('planning', 'active', 'on_hold')
GROUP BY p.id, p.code, p.name, p.planned_end_date;

-- ---------------------------------------------------------------------------
-- Q3: how resources are allocated across projects
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_resource_allocation AS
SELECT
    p.id            AS project_id,
    p.code          AS project_code,
    u.id            AS user_id,
    u.full_name,
    u.role,
    a.allocation_pct,
    a.start_date,
    a.end_date,
    ROUND(u.capacity_hours * a.allocation_pct / 100.0, 2) AS allocated_hours_per_week
FROM allocations a
JOIN projects p ON p.id = a.project_id
JOIN users u    ON u.id = a.user_id;

-- ---------------------------------------------------------------------------
-- Q5: over-allocated team members
--
-- The total allocation for a person is a step function over time. It can only
-- INCREASE at the start_date of some allocation, so the maximum is always
-- attained at one of those boundaries. Probing every allocation start_date is
-- therefore exact -- no calendar table or day-by-day expansion needed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_allocation_load AS
SELECT
    probe.user_id,
    probe.probe_date,
    SUM(a.allocation_pct)::INT AS total_pct,
    COUNT(*)::INT              AS concurrent_projects
FROM (SELECT DISTINCT user_id, start_date AS probe_date FROM allocations) probe
JOIN allocations a
  ON a.user_id = probe.user_id
 AND probe.probe_date BETWEEN a.start_date AND a.end_date
GROUP BY probe.user_id, probe.probe_date;

CREATE OR REPLACE VIEW v_over_allocated_users AS
SELECT
    u.id            AS user_id,
    u.full_name,
    u.email,
    l.probe_date    AS from_date,
    l.total_pct,
    l.concurrent_projects,
    (l.total_pct - 100) AS excess_pct
FROM v_allocation_load l
JOIN users u ON u.id = l.user_id
WHERE l.total_pct > 100;

-- ---------------------------------------------------------------------------
-- Q6: dependency chain between deliverables
--
-- The path array guards against infinite recursion if a cycle is ever
-- introduced, so the view stays queryable even against dirty data.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_deliverable_dependency_chain AS
WITH RECURSIVE chain AS (
    SELECT
        dd.predecessor_id                          AS root_id,
        dd.successor_id                            AS descendant_id,
        1                                          AS depth,
        ARRAY[dd.predecessor_id, dd.successor_id]  AS path
    FROM deliverable_dependencies dd

    UNION ALL

    SELECT
        c.root_id,
        dd.successor_id,
        c.depth + 1,
        c.path || dd.successor_id
    FROM chain c
    JOIN deliverable_dependencies dd ON dd.predecessor_id = c.descendant_id
    WHERE NOT dd.successor_id = ANY(c.path)
)
SELECT
    c.root_id,
    r.name  AS root_name,
    c.descendant_id,
    d.name  AS descendant_name,
    d.status AS descendant_status,
    c.depth,
    c.path
FROM chain c
JOIN deliverables r ON r.id = c.root_id
JOIN deliverables d ON d.id = c.descendant_id;

-- Reject cycles at write time. Without this a user can create A -> B -> A
-- through two perfectly valid individual inserts.
CREATE OR REPLACE FUNCTION reject_dependency_cycle() RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        WITH RECURSIVE reachable AS (
            SELECT NEW.predecessor_id AS node, ARRAY[NEW.predecessor_id] AS seen
            UNION ALL
            SELECT dd.predecessor_id, r.seen || dd.predecessor_id
            FROM reachable r
            JOIN deliverable_dependencies dd ON dd.successor_id = r.node
            WHERE NOT dd.predecessor_id = ANY(r.seen)
        )
        SELECT 1 FROM reachable WHERE node = NEW.successor_id
    ) THEN
        RAISE EXCEPTION
            'Dependency % -> % would create a cycle',
            NEW.predecessor_id, NEW.successor_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deliverable_dependencies_no_cycle
    BEFORE INSERT OR UPDATE ON deliverable_dependencies
    FOR EACH ROW EXECUTE FUNCTION reject_dependency_cycle();

-- ---------------------------------------------------------------------------
-- Q7: budget consumed versus planned
--
-- Aggregates expenses per budget line FIRST, then joins. Summing across a
-- budget_lines JOIN expenses result directly would multiply planned_amount by
-- the number of expense rows -- a fan-out trap worth calling out in the README.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_budget_consumption AS
WITH line_spend AS (
    SELECT
        bl.id                       AS budget_line_id,
        bl.project_id,
        bl.category,
        bl.planned_amount,
        COALESCE(SUM(e.amount), 0)  AS actual_amount
    FROM budget_lines bl
    LEFT JOIN expenses e ON e.budget_line_id = bl.id
    GROUP BY bl.id, bl.project_id, bl.category, bl.planned_amount
)
SELECT
    p.id    AS project_id,
    p.code  AS project_code,
    p.name  AS project_name,
    p.planned_budget,
    SUM(ls.planned_amount)  AS allocated_to_lines,
    SUM(ls.actual_amount)   AS consumed,
    SUM(ls.planned_amount) - SUM(ls.actual_amount) AS remaining,
    CASE
        WHEN SUM(ls.planned_amount) = 0 THEN NULL
        ELSE ROUND(100.0 * SUM(ls.actual_amount) / SUM(ls.planned_amount), 1)
    END AS consumed_pct
FROM projects p
LEFT JOIN line_spend ls ON ls.project_id = p.id
GROUP BY p.id, p.code, p.name, p.planned_budget;
