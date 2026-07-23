-- A closed project must record when it closed. Mirrors the equivalent
-- constraint on deliverables, which was already enforced.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_closure_consistent;

UPDATE projects
   SET actual_end_date = LEAST(planned_end_date, CURRENT_DATE)
 WHERE status IN ('completed', 'cancelled')
   AND actual_end_date IS NULL;

ALTER TABLE projects ADD CONSTRAINT projects_closure_consistent CHECK (
    status NOT IN ('completed', 'cancelled') OR actual_end_date IS NOT NULL
);