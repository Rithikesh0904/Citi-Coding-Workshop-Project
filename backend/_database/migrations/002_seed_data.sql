-- Demo data for ACME Inc.
--
-- Deliberately messy. Every one of the seven business questions must return a
-- non-empty, interesting answer, so this data includes overdue deliverables,
-- two over-allocated people, a blocked dependency chain, and an overspent
-- budget line. Clean data would make a working dashboard look broken.
--
-- Idempotent: safe to re-run. All inserts use ON CONFLICT DO NOTHING and
-- fixed UUIDs so relationships stay stable across reloads.
--
-- Demo logins (password shown, hash stored):
--   admin@acme.com       Admin@123      full access
--   manager@acme.com     Manager@123    everything except user management
--   dev@acme.com         Contrib@123    create and update, no delete
--   viewer@acme.com      Viewer@123     read only

BEGIN;

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------

INSERT INTO departments (id, name) VALUES
    ('11111111-0000-0000-0000-000000000001', 'Engineering'),
    ('11111111-0000-0000-0000-000000000002', 'Data & Analytics'),
    ('11111111-0000-0000-0000-000000000003', 'Digital Products'),
    ('11111111-0000-0000-0000-000000000004', 'Risk & Compliance')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Users -- one per role, plus a team to allocate
-- ---------------------------------------------------------------------------

INSERT INTO users (id, email, password_hash, full_name, role, capacity_hours, cost_rate) VALUES
    ('22222222-0000-0000-0000-000000000001', 'admin@acme.com',
     'pbkdf2_sha256$120000$191505ce8e318e781ede720b2a32903d$2f4ea2d6027fbc6c0cc16334b799fb5d6072ad77aa10c88282ca0727d3bee89a',
     'Amara Okafor', 'admin', 40, 95.00),
    ('22222222-0000-0000-0000-000000000002', 'manager@acme.com',
     'pbkdf2_sha256$120000$16e84285422eb1ed8b8056112504f65f$9f84b588a29729f1188fcc7c399751edf687cfa3bda8f027b70a02d21a90ec7a',
     'Ravi Subramanian', 'manager', 40, 88.00),
    ('22222222-0000-0000-0000-000000000003', 'dev@acme.com',
     'pbkdf2_sha256$120000$89e35d58a7d05b6f50d935cdce2fca5b$ff1ec3a990f103ee40daf9dcf0a51401950eaf8538888fa22e6a88e7ceb55f22',
     'Lena Fischer', 'contributor', 40, 72.00),
    ('22222222-0000-0000-0000-000000000004', 'viewer@acme.com',
     'pbkdf2_sha256$120000$c3e1aff058176ac8b99185571283220d$259d106f477bfbafd91e3976314c0875f4dab5bf044535b11c35a4509fe96d30',
     'Tom Bradley', 'viewer', 40, NULL),
    -- Additional contributors. Same password as dev@acme.com.
    ('22222222-0000-0000-0000-000000000005', 'priya.n@acme.com',
     'pbkdf2_sha256$120000$89e35d58a7d05b6f50d935cdce2fca5b$ff1ec3a990f103ee40daf9dcf0a51401950eaf8538888fa22e6a88e7ceb55f22',
     'Priya Nair', 'contributor', 40, 78.00),
    ('22222222-0000-0000-0000-000000000006', 'marco.r@acme.com',
     'pbkdf2_sha256$120000$89e35d58a7d05b6f50d935cdce2fca5b$ff1ec3a990f103ee40daf9dcf0a51401950eaf8538888fa22e6a88e7ceb55f22',
     'Marco Rossi', 'contributor', 40, 81.00),
    ('22222222-0000-0000-0000-000000000007', 'sara.k@acme.com',
     'pbkdf2_sha256$120000$89e35d58a7d05b6f50d935cdce2fca5b$ff1ec3a990f103ee40daf9dcf0a51401950eaf8538888fa22e6a88e7ceb55f22',
     'Sara Kowalski', 'contributor', 32, 76.00),
    ('22222222-0000-0000-0000-000000000008', 'james.o@acme.com',
     'pbkdf2_sha256$120000$16e84285422eb1ed8b8056112504f65f$9f84b588a29729f1188fcc7c399751edf687cfa3bda8f027b70a02d21a90ec7a',
     'James Otieno', 'manager', 40, 90.00)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Projects -- mixed states, two already past their planned end date
-- ---------------------------------------------------------------------------

INSERT INTO projects (id, code, name, description, department_id, manager_id,
                      status, start_date, planned_end_date, planned_budget) VALUES
    ('33333333-0000-0000-0000-000000000001', 'ACM-101', 'Customer Portal Rebuild',
     'Replace the legacy customer portal with a responsive self-service application.',
     '11111111-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000002',
     'active', CURRENT_DATE - 90, CURRENT_DATE + 30, 450000.00),

    ('33333333-0000-0000-0000-000000000002', 'ACM-102', 'Payments Migration',
     'Move payment processing onto the new settlement platform.',
     '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000008',
     'active', CURRENT_DATE - 120, CURRENT_DATE - 10, 780000.00),

    ('33333333-0000-0000-0000-000000000003', 'ACM-103', 'Data Lake Foundation',
     'Establish the medallion architecture for enterprise reporting.',
     '11111111-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002',
     'active', CURRENT_DATE - 45, CURRENT_DATE + 75, 320000.00),

    ('33333333-0000-0000-0000-000000000004', 'ACM-104', 'Regulatory Reporting Uplift',
     'Automate quarterly regulatory submissions.',
     '11111111-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000008',
     'on_hold', CURRENT_DATE - 60, CURRENT_DATE + 15, 210000.00),

    ('33333333-0000-0000-0000-000000000005', 'ACM-105', 'Mobile App Phase 2',
     'Offline mode and push notifications.',
     '11111111-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000002',
     'planning', CURRENT_DATE + 14, CURRENT_DATE + 160, 275000.00),

    ('33333333-0000-0000-0000-000000000006', 'ACM-106', 'Legacy Decommission',
     'Retire the mainframe batch reporting suite.',
     '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000008',
     'completed', CURRENT_DATE - 200, CURRENT_DATE - 30, 140000.00)
ON CONFLICT (id) DO NOTHING;

UPDATE projects SET actual_end_date = CURRENT_DATE - 35
WHERE id = '33333333-0000-0000-0000-000000000006' AND actual_end_date IS NULL;

-- ---------------------------------------------------------------------------
-- Deliverables
--   ACM-101: healthy, mostly progressing
--   ACM-102: in trouble -- overdue and blocked items
--   ACM-103: early stage
-- ---------------------------------------------------------------------------

INSERT INTO deliverables (id, project_id, owner_id, name, status,
                          percent_complete, due_date, completed_at) VALUES
    -- Customer Portal Rebuild
    ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001',
     '22222222-0000-0000-0000-000000000003', 'Discovery & requirements',
     'completed', 100, CURRENT_DATE - 70, CURRENT_DATE - 72),
    ('44444444-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000001',
     '22222222-0000-0000-0000-000000000005', 'Design system & component library',
     'completed', 100, CURRENT_DATE - 45, CURRENT_DATE - 44),
    ('44444444-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000001',
     '22222222-0000-0000-0000-000000000003', 'Authentication module',
     'in_progress', 70, CURRENT_DATE + 5, NULL),
    ('44444444-0000-0000-0000-000000000004', '33333333-0000-0000-0000-000000000001',
     '22222222-0000-0000-0000-000000000006', 'Account dashboard',
     'in_progress', 40, CURRENT_DATE + 20, NULL),
    ('44444444-0000-0000-0000-000000000005', '33333333-0000-0000-0000-000000000001',
     '22222222-0000-0000-0000-000000000007', 'Accessibility audit',
     'not_started', 0, CURRENT_DATE + 28, NULL),

    -- Payments Migration -- the project in trouble
    ('44444444-0000-0000-0000-000000000006', '33333333-0000-0000-0000-000000000002',
     '22222222-0000-0000-0000-000000000006', 'Settlement API contract',
     'completed', 100, CURRENT_DATE - 95, CURRENT_DATE - 90),
    ('44444444-0000-0000-0000-000000000007', '33333333-0000-0000-0000-000000000002',
     '22222222-0000-0000-0000-000000000003', 'Ledger reconciliation engine',
     'blocked', 55, CURRENT_DATE - 20, NULL),          -- overdue AND blocked
    ('44444444-0000-0000-0000-000000000008', '33333333-0000-0000-0000-000000000002',
     '22222222-0000-0000-0000-000000000005', 'Fraud rules migration',
     'in_progress', 30, CURRENT_DATE - 5, NULL),        -- overdue
    ('44444444-0000-0000-0000-000000000009', '33333333-0000-0000-0000-000000000002',
     '22222222-0000-0000-0000-000000000006', 'Cutover rehearsal',
     'not_started', 0, CURRENT_DATE + 25, NULL),        -- past project end date

    -- Data Lake Foundation
    ('44444444-0000-0000-0000-000000000010', '33333333-0000-0000-0000-000000000003',
     '22222222-0000-0000-0000-000000000007', 'Bronze ingestion jobs',
     'in_progress', 60, CURRENT_DATE + 10, NULL),
    ('44444444-0000-0000-0000-000000000011', '33333333-0000-0000-0000-000000000003',
     '22222222-0000-0000-0000-000000000005', 'Silver conformance layer',
     'not_started', 0, CURRENT_DATE + 35, NULL),
    ('44444444-0000-0000-0000-000000000012', '33333333-0000-0000-0000-000000000003',
     '22222222-0000-0000-0000-000000000007', 'Gold aggregates & BI feed',
     'not_started', 0, CURRENT_DATE + 60, NULL)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Dependency chains
-- Payments Migration has a 4-deep chain -- the blocked ledger engine at depth 2
-- stalls everything downstream, which is exactly the insight the chain view
-- is meant to surface.
-- ---------------------------------------------------------------------------

INSERT INTO deliverable_dependencies (predecessor_id, successor_id, dep_type) VALUES
    ('44444444-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', 'finish_to_start'),
    ('44444444-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000003', 'finish_to_start'),
    ('44444444-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000004', 'finish_to_start'),
    ('44444444-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000005', 'finish_to_start'),
    ('44444444-0000-0000-0000-000000000006', '44444444-0000-0000-0000-000000000007', 'finish_to_start'),
    ('44444444-0000-0000-0000-000000000007', '44444444-0000-0000-0000-000000000008', 'finish_to_start'),
    ('44444444-0000-0000-0000-000000000008', '44444444-0000-0000-0000-000000000009', 'finish_to_start'),
    ('44444444-0000-0000-0000-000000000010', '44444444-0000-0000-0000-000000000011', 'finish_to_start'),
    ('44444444-0000-0000-0000-000000000011', '44444444-0000-0000-0000-000000000012', 'finish_to_start')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Allocations
-- Lena Fischer and Priya Nair are deliberately over 100% on overlapping dates.
-- Marco and Sara stay within capacity as a control group.
-- ---------------------------------------------------------------------------

INSERT INTO allocations (id, project_id, user_id, allocation_pct, start_date, end_date) VALUES
    -- Lena: 60 + 50 + 20 = 130% at peak
    ('55555555-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001',
     '22222222-0000-0000-0000-000000000003', 60, CURRENT_DATE - 60, CURRENT_DATE + 30),
    ('55555555-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000002',
     '22222222-0000-0000-0000-000000000003', 50, CURRENT_DATE - 30, CURRENT_DATE + 20),
    ('55555555-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000003',
     '22222222-0000-0000-0000-000000000003', 20, CURRENT_DATE - 10, CURRENT_DATE + 40),

    -- Priya: 70 + 45 = 115% at peak
    ('55555555-0000-0000-0000-000000000004', '33333333-0000-0000-0000-000000000001',
     '22222222-0000-0000-0000-000000000005', 70, CURRENT_DATE - 40, CURRENT_DATE + 25),
    ('55555555-0000-0000-0000-000000000005', '33333333-0000-0000-0000-000000000002',
     '22222222-0000-0000-0000-000000000005', 45, CURRENT_DATE - 15, CURRENT_DATE + 15),

    -- Marco: 80% then 60%, never overlapping -- proves the view does not
    -- produce false positives on sequential work
    ('55555555-0000-0000-0000-000000000006', '33333333-0000-0000-0000-000000000002',
     '22222222-0000-0000-0000-000000000006', 80, CURRENT_DATE - 90, CURRENT_DATE - 20),
    ('55555555-0000-0000-0000-000000000007', '33333333-0000-0000-0000-000000000001',
     '22222222-0000-0000-0000-000000000006', 60, CURRENT_DATE - 19, CURRENT_DATE + 40),

    -- Sara: comfortably within capacity
    ('55555555-0000-0000-0000-000000000008', '33333333-0000-0000-0000-000000000003',
     '22222222-0000-0000-0000-000000000007', 50, CURRENT_DATE - 30, CURRENT_DATE + 50),
    ('55555555-0000-0000-0000-000000000009', '33333333-0000-0000-0000-000000000001',
     '22222222-0000-0000-0000-000000000007', 30, CURRENT_DATE - 5, CURRENT_DATE + 25)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Budget lines and expenses
-- ACM-102 is deliberately overspent on Contractors.
-- ---------------------------------------------------------------------------

INSERT INTO budget_lines (id, project_id, category, planned_amount) VALUES
    ('66666666-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 'Engineering', 260000),
    ('66666666-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000001', 'Design',       80000),
    ('66666666-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000001', 'Infrastructure', 110000),
    ('66666666-0000-0000-0000-000000000004', '33333333-0000-0000-0000-000000000002', 'Engineering', 420000),
    ('66666666-0000-0000-0000-000000000005', '33333333-0000-0000-0000-000000000002', 'Contractors', 240000),
    ('66666666-0000-0000-0000-000000000006', '33333333-0000-0000-0000-000000000002', 'Licensing',   120000),
    ('66666666-0000-0000-0000-000000000007', '33333333-0000-0000-0000-000000000003', 'Engineering', 200000),
    ('66666666-0000-0000-0000-000000000008', '33333333-0000-0000-0000-000000000003', 'Cloud',       120000),
    ('66666666-0000-0000-0000-000000000009', '33333333-0000-0000-0000-000000000004', 'Consulting',  210000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO expenses (id, budget_line_id, amount, incurred_on, description) VALUES
    ('77777777-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000001', 78000,  CURRENT_DATE - 75, 'Sprint 1-3 engineering'),
    ('77777777-0000-0000-0000-000000000002', '66666666-0000-0000-0000-000000000001', 64000,  CURRENT_DATE - 45, 'Sprint 4-6 engineering'),
    ('77777777-0000-0000-0000-000000000003', '66666666-0000-0000-0000-000000000002', 52000,  CURRENT_DATE - 50, 'Design system build'),
    ('77777777-0000-0000-0000-000000000004', '66666666-0000-0000-0000-000000000003', 31000,  CURRENT_DATE - 30, 'Environment provisioning'),

    -- Payments Migration: contractors blow past the 240k line
    ('77777777-0000-0000-0000-000000000005', '66666666-0000-0000-0000-000000000004', 210000, CURRENT_DATE - 100, 'Core migration team'),
    ('77777777-0000-0000-0000-000000000006', '66666666-0000-0000-0000-000000000004', 145000, CURRENT_DATE - 40,  'Extended delivery phase'),
    ('77777777-0000-0000-0000-000000000007', '66666666-0000-0000-0000-000000000005', 180000, CURRENT_DATE - 70,  'Specialist contractors'),
    ('77777777-0000-0000-0000-000000000008', '66666666-0000-0000-0000-000000000005', 96000,  CURRENT_DATE - 25,  'Contract extension (unplanned)'),
    ('77777777-0000-0000-0000-000000000009', '66666666-0000-0000-0000-000000000006', 118000, CURRENT_DATE - 80,  'Platform licences'),

    ('77777777-0000-0000-0000-000000000010', '66666666-0000-0000-0000-000000000007', 46000,  CURRENT_DATE - 30, 'Pipeline development'),
    ('77777777-0000-0000-0000-000000000011', '66666666-0000-0000-0000-000000000008', 22000,  CURRENT_DATE - 20, 'Cloud storage and compute'),
    ('77777777-0000-0000-0000-000000000012', '66666666-0000-0000-0000-000000000004', 66000,  CURRENT_DATE - 8,  'Emergency engineering surge for cutover')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification -- every one of these should return rows
-- ---------------------------------------------------------------------------
--   SELECT * FROM v_project_status;
--   SELECT * FROM v_project_risk WHERE overdue_deliverables > 0;
--   SELECT * FROM v_over_allocated_users;              -- expect Lena and Priya
--   SELECT * FROM v_budget_consumption WHERE consumed_pct > 100;
--   SELECT * FROM v_deliverable_dependency_chain WHERE depth >= 3;