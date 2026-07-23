-- A closed project must record when it closed. Mirrors the equivalent
-- constraint on deliverables, which was already enforced.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_closure_consistent;
aws_s3_bucket.this: Still creating... [02m00s elapsed]
aws_s3_bucket.hot_reload[0]: Still creating... [02m10s elapsed]
aws_s3_bucket.this: Still creating... [02m10s elapsed]
aws_s3_bucket.hot_reload[0]: Still creating... [02m20s elapsed]
aws_s3_bucket.this: Still creating... [02m20s elapsed]
aws_s3_bucket.hot_reload[0]: Still creating... [02m30s elapsed]
aws_s3_bucket.this: Still creating... [02m30s elapsed]
UPDATE projects
   SET actual_end_date = LEAST(planned_end_date, CURRENT_DATE)
 WHERE status IN ('completed', 'cancelled')
   AND actual_end_date IS NULL;

ALTER TABLE projects ADD CONSTRAINT projects_closure_consistent CHECK (
    status NOT IN ('completed', 'cancelled') OR actual_end_date IS NOT NULL
);