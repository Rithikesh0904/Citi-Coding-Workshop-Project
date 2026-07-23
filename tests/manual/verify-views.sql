-- Verification of the seven business questions.
--
-- Each query below answers one question from the brief. Run against either
-- environment and paste the output into TESTING.md.
--
--   psql -h localhost -p 5432 -U postgres -d postgres -P pager=off \
--        -f tests/manual/verify-views.sql

\echo '=== Q1. Current status of each project ==='
SELECT code, name, status, deliverable_count, completed_count, avg_percent_complete
FROM v_project_status
ORDER BY code;

\echo ''
\echo '=== Q2a. Projects at risk (deliverable signals) ==='
SELECT code, days_remaining, overdue_deliverables,
       deliverables_past_project_end, blocked_deliverables
FROM v_project_risk
ORDER BY overdue_deliverables DESC, blocked_deliverables DESC;

\echo ''
\echo '=== Q2b. Projects at risk (velocity forecast) ==='
\echo 'Expect ACM-102 with a large positive variance.'
SELECT code, pct_complete, expected_pct_complete,
       forecast_end_date, forecast_variance_days
FROM v_project_forecast
ORDER BY forecast_variance_days DESC NULLS LAST;

\echo ''
\echo '=== Q3. Resource allocation across projects ==='
SELECT full_name, project_code, allocation_pct,
       allocated_hours_per_week, start_date, end_date
FROM v_resource_allocation
ORDER BY full_name, start_date;

\echo ''
\echo '=== Q4. Deliverables and completion status ==='
SELECT p.code, d.name, d.status, d.percent_complete, d.due_date,
       CASE WHEN d.status <> 'completed' AND d.due_date < CURRENT_DATE
            THEN 'OVERDUE' ELSE '' END AS flag
FROM deliverables d
JOIN projects p ON p.id = d.project_id
ORDER BY p.code, d.due_date;

\echo ''
\echo '=== Q5. Over-allocated team members ==='
\echo 'Expect Lena Fischer 130% and Priya Nair 115%.'
\echo 'Lena appears twice: load rises as a third allocation starts.'
SELECT full_name, from_date, total_pct, concurrent_projects, excess_pct
FROM v_over_allocated_users
ORDER BY total_pct DESC;

\echo ''
\echo '=== Q5b. Control case: sequential work must NOT count as overlap ==='
\echo 'Marco Rossi holds 80% then 60% on non-overlapping dates.'
\echo 'He must be absent from the results above. Expect 0 here.'
SELECT count(*) AS marco_false_positives
FROM v_over_allocated_users
WHERE full_name = 'Marco Rossi';

\echo ''
\echo '=== Q6. Dependency chain between deliverables ==='
SELECT root_name, descendant_name, descendant_status, depth
FROM v_deliverable_dependency_chain
ORDER BY depth DESC, root_name
LIMIT 20;

\echo ''
\echo '=== Q6b. Blocked work and everything it stalls ==='
SELECT c.root_name AS blocked_item, c.descendant_name AS stalled_item, c.depth
FROM v_deliverable_dependency_chain c
JOIN deliverables d ON d.id = c.root_id
WHERE d.status = 'blocked'
ORDER BY c.depth;

\echo ''
\echo '=== Q7. Budget consumed versus planned ==='
SELECT project_code, planned_budget, allocated_to_lines, consumed,
       remaining, consumed_pct
FROM v_budget_consumption
ORDER BY consumed_pct DESC NULLS LAST;

\echo ''
\echo '=== Q7b. Budget lines individually overspent ==='
\echo 'Line-level overspend can hide inside a project that looks healthy.'
SELECT p.code, bl.category, bl.planned_amount, SUM(e.amount) AS spent,
       ROUND(100.0 * SUM(e.amount) / bl.planned_amount, 1) AS pct
FROM budget_lines bl
JOIN projects p ON p.id = bl.project_id
LEFT JOIN expenses e ON e.budget_line_id = bl.id
GROUP BY p.code, bl.category, bl.planned_amount
HAVING SUM(e.amount) > bl.planned_amount;

\echo ''
\echo '=== Data integrity: no fan-out in the budget aggregation ==='
\echo 'Both totals must match. A mismatch means expenses were multiplied by'
\echo 'the number of budget lines during the join.'
SELECT
    (SELECT SUM(consumed) FROM v_budget_consumption)  AS via_view,
    (SELECT SUM(amount) FROM expenses)                AS direct_sum;

\echo ''
\echo '=== Audit trail ==='
SELECT table_name, operation, count(*) AS events
FROM audit_log
GROUP BY table_name, operation
ORDER BY table_name, operation;

\echo ''
\echo '

\echo ''
\echo '=== Cycle rejection (a NOTICE saying PASS is the success condition) ==='
\echo 'A->B and B->A are each individually legal; only the pair forms a loop.'
DO $$
DECLARE
    v_root       UUID;
    v_descendant UUID;
BEGIN
    -- Pick a pair that is genuinely connected: a descendant reachable from a
    -- root. Inserting descendant -> root must therefore close a loop. Picking
    -- two arbitrary deliverables would not, since connecting unrelated work is
    -- perfectly legal and the insert would rightly succeed.
    SELECT root_id, descendant_id INTO v_root, v_descendant
      FROM v_deliverable_dependency_chain
     ORDER BY depth DESC, root_id, descendant_id
     LIMIT 1;

    IF v_root IS NULL THEN
        RAISE NOTICE 'SKIP: no dependency chains exist to test against';
        RETURN;
    END IF;

    BEGIN
        INSERT INTO deliverable_dependencies (predecessor_id, successor_id)
        VALUES (v_descendant, v_root);
        RAISE WARNING 'FAIL: a cycle was accepted';
        DELETE FROM deliverable_dependencies
         WHERE predecessor_id = v_descendant AND successor_id = v_root;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'PASS: cycle rejected -- %', SQLERRM;
    END;
END $$;
