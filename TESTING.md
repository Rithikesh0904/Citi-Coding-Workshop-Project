# Testing

Evidence of what was tested, what the results were, and what was not covered.
Replace the bracketed placeholders with your own captured output.

**Environments**

| | Local | Cloud |
| --- | --- | --- |
| Frontend | Vite dev server, `localhost:3000` | CloudFront → S3 |
| API | CORS proxy `localhost:3001` → LocalStack Lambda | CloudFront → Lambda Function URLs |
| Database | PostgreSQL, `172.17.0.1:5432` | Aurora Serverless v2, private VPC |
| Base URL | `http://localhost:3001` | `https://d1ehv91jl1r1f2.cloudfront.net` |

---

## 1. Backend unit tests

Covers the shared modules every service depends on: routing, token handling,
password hashing, the role matrix, registration policy, reset tokens, request
parsing, and validation. No database is required, so these run in about two
seconds.

```sh
cd backend/_shared
python3 -m pytest tests/ -v --cov=. --cov-report=term-missing
```

**Result: 56 passed**

```
======================================== tests coverage =========================================
_______________________ coverage: platform linux, python 3.13.14-final-0 ________________________

Name                   Stmts   Miss  Cover   Missing
----------------------------------------------------
db.py                     42     42     0%   12-86
http_utils.py            113      8    93%   50-52, 132-133, 170, 208-210
security.py               63      1    98%   68
tests/test_shared.py     163      0   100%
----------------------------------------------------
TOTAL                    381     51    87%
====================================== 56 passed in 0.46s =======================================
```

These deliberately probe failure paths, not just happy paths:

| Area | Cases |
| --- | --- |
| Passwords | correct verifies · wrong rejected · same password produces different hashes (unique salt) · malformed stored hash returns false rather than raising |
| Tokens | round trip · tampered payload rejected · expired rejected · malformed segments rejected |
| Roles | full matrix across four roles and five actions, plus an unknown role |
| Registration policy | self-registration role is viewer and cannot create, delete or manage users · `@acme.com` accepted in any case and with padding · `evil.com` rejected · `acme.com.evil.com` rejected · address with no `@` rejected |
| Reset tokens | 100 generated tokens are unique · length ≥ 32 · hash is stable and distinct per token · hash does not contain the token |
| Parsing | service prefix stripped in both proxy and direct form · base64 bodies · invalid JSON → 400 · JSON array body → 400 |
| Validation | every missing field reported in one response · blank strings count as missing · unexpected fields stripped |
| Auth guards | missing header → 401 · non-bearer header → 401 · valid token wrong role → 403 · header name case-insensitive |
| Router | placeholder capture · trailing slash · unknown path → 404 · wrong method → 405 · OPTIONS → 204 · unhandled exception → 500 with no stack trace leaked · CORS headers on every response including errors |
| Serialisation | Decimal and date rendered as JSON · 204 has an empty body |

---

## 2. API and authorisation tests

A scripted pass over user management and the permission boundaries. It creates a
throwaway account, exercises every rule, and deactivates it, so it is safe to
re-run.

```sh
./tests/manual/test-user-management.sh
```

**Result: [28] passed, [0] failed**

```
./tests/manual/test-user-management.sh
{"status": "healthy", "service": "auth-service"}==================================================
  User management — admin capabilities and limits
==================================================

1. Reading users
  PASS  admin lists users                                    200
  PASS  viewer lists users (read is allowed)                 200
  PASS  no token is rejected                                 401
  PASS  garbage token is rejected                            401

2. Creating users — only admin may
  PASS  manager cannot create a user                         403
  PASS  contributor cannot create a user                     403
  PASS  viewer cannot create a user                          403

3. Validation on create
  PASS  missing required fields                              400
  PASS  password shorter than 8 characters                   400
  PASS  role outside the allowed set                         400
  PASS  duplicate email is rejected                          400

4. Admin creates a user successfully
  PASS  create returns 201                                   201
        new user id: 877c0d0c-ba08-4c47-af5e-072b61af6f94
  PASS  the new user can sign in                             200
  PASS  wrong password for the new user                      401

5. Search and filter
        contributors found: 5
  PASS  search with no matches returns an empty list         0

6. Updating users
  PASS  admin promotes the new user to manager               200
  PASS  invalid role on update                               400
  PASS  update with no usable fields                         400
  PASS  updating a user that does not exist                  404
  PASS  manager cannot update a user                         403

7. Privilege escalation is blocked
  PASS  contributor cannot promote themselves                403
  PASS  admin cannot change their own role                   400
  PASS  admin cannot delete their own account                400
  PASS  admin may still edit their own name                  200

8. Deactivation
  PASS  manager cannot deactivate a user                     403
  PASS  admin deactivates the test user                      204
  PASS  a deactivated user cannot sign in                    403
  PASS  deleting a user that does not exist                  404
        test user is_active after delete: False  (expect False — soft delete)

9. Audit trail
  Run this to confirm the triggers captured every change:
    psql -h localhost -p 5432 -U postgres -d postgres -P pager=off \
      -c "SELECT operation, count(*) FROM audit_log WHERE table_name='users' GROUP BY 1;"

==================================================
  28 passed, 0 failed
==================================================
```

Notable checks:

- An admin can edit their own name but cannot change their own role (400) or
  delete their own account (400) — either could leave the system with no
  administrator.
- A contributor promoting themselves to admin gets 403.
- A deactivated user gets 403 on login while their row survives, because
  projects reference users as managers.
- A malformed token returns 401, not 500 (defect 6 below).

### Registration and account recovery

```sh
API=http://localhost:3001/api/auth-service

# A non-company address is rejected
curl -s -X POST $API/register -H "Content-Type: application/json" \
  -d '{"email":"attacker@evil.com","password":"Passw0rd1","full_name":"X"}'

# A role in the payload is ignored — the response must show role: viewer
curl -s -X POST $API/register -H "Content-Type: application/json" \
  -d '{"email":"newbie@acme.com","password":"Passw0rd1","full_name":"New Person","role":"admin"}'

# Reset flow
TOKEN=$(curl -s -X POST $API/forgot-password -H "Content-Type: application/json" \
  -d '{"email":"newbie@acme.com"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['reset_token'])")
curl -s -X POST $API/reset-password -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\",\"password\":\"BrandNew99\"}"

# The same token a second time
curl -s -X POST $API/reset-password -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\",\"password\":\"Another99\"}"
```

| Case | Expected | Actual |
| --- | --- | --- |
| Register with `@evil.com` | 400, domain rejected | ✓ 400 — "Sign-up is limited to acme.com email addresses" |
| Register with `"role":"admin"` in body | 201, role returned is `viewer` | ✓ 201 — response shows `"role": "viewer"` |
| Register duplicate email | 400 | ✓ 400 — "An account with that email already exists" |
| Register password under 8 characters | 400 | ✓ 400 |
| Forgot password, unknown email | 200, no token issued | ✓ 200, no token |
| Forgot password, known email | 200, token returned | ✓ 200, token returned |
| Reset with a valid token | 200 | ✓ 200 — "Password updated" |
| Reset with the same token again | 400, already used | ✓ 400 — "invalid, already used, or expired" |
| Reset with a fabricated token | 400 | ✓ 400 |
| Login with the old password afterwards | 401 | ✓ 401 |
| Login with the new password | 200 | ✓ 200 |

The role check is the important one: it demonstrates that the public endpoint
cannot be used to grant permissions, rather than merely asserting it.

### Role boundaries, verified against the server

Hiding a button is presentation; the server's refusal is the security boundary.
These bypass the browser entirely.

| Case | Expected | Actual |
| --- | --- | --- |
| No token | 401 | ✓ 401 |
| Unknown email | 401 | ✓ 401 |
| Wrong password | 401 | ✓ 401 |
| Malformed token | 401 | ✓ 401 |
| Viewer deletes project | 403 | ✓ 403 |
| Contributor deletes project | 403 | ✓ 403 |
| Contributor self-promotes | 403 | ✓ 403 |
| Manager creates user | 403 | ✓ 403 |
| Manager opens `/users` by URL | redirected | ✓ redirected to dashboard |

---

## 3. Database verification

Each business question is answered by a view, so the views are what get checked.

```sh
psql -h localhost -p 5432 -U postgres -d postgres -P pager=off \
  -f tests/manual/verify-views.sql
```

| Check | Expected | Actual |
| --- | --- | --- |
| `v_project_status` | 6 projects with rollups | ✓ |
| `v_over_allocated_users` | Lena Fischer 130%, Priya Nair 115% | ✓ |
| Marco Rossi absent | sequential work must not read as overlap | ✓ |
| `v_project_forecast` | ACM-102 around +152 days | ✓ |
| `v_budget_consumption` | ACM-102 above 100% | ✓ |
| `v_deliverable_dependency_chain` | 4-deep chain on ACM-102 | ✓ |
| Budget fan-out check | view total equals direct expense total | ✓ |
| Cycle rejection | insert forming a loop raises, not 500 | ✓ rejected with "would create a cycle" |
| `audit_log` | INSERT/UPDATE/DELETE captured by trigger | ✓ |
| `password_resets` | table exists, trigger attached | ✓ |

```
=== Q1. Current status of each project ===
  code   |            name             |  status   | deliverable_count | completed_count | avg_percent_complete 
---------+-----------------------------+-----------+-------------------+-----------------+----------------------
 ACM-101 | Customer Portal Rebuild     | active    |                 5 |               2 |                 62.0
 ACM-102 | Payments Migration          | active    |                 4 |               1 |                 46.3
 ACM-103 | Data Lake Foundation        | active    |                 3 |               0 |                 20.0
 ACM-104 | Regulatory Reporting Uplift | on_hold   |                 0 |               0 |                    0
 ACM-105 | Mobile App Phase 2          | planning  |                 0 |               0 |                    0
 ACM-106 | Legacy Decommission         | completed |                 0 |               0 |                    0
 ACM-202 | Consumer payments system    | planning  |                 0 |               0 |                    0
 ACM-204 | Cart management             | planning  |                 0 |               0 |                    0
(8 rows)


=== Q2a. Projects at risk (deliverable signals) ===
  code   | days_remaining | overdue_deliverables | deliverables_past_project_end | blocked_deliverables 
---------+----------------+----------------------+-------------------------------+----------------------
 ACM-102 |            -11 |                    2 |                             2 |                    1
 ACM-103 |             74 |                    0 |                             0 |                    0
 ACM-101 |             29 |                    0 |                             0 |                    0
 ACM-105 |            159 |                    0 |                             0 |                    0
 ACM-202 |            123 |                    0 |                             0 |                    0
 ACM-204 |            185 |                    0 |                             0 |                    0
 ACM-104 |             14 |                    0 |                             0 |                    0
(7 rows)


=== Q2b. Projects at risk (velocity forecast) ===
Expect ACM-102 with a large positive variance.
  code   | pct_complete | expected_pct_complete | forecast_end_date | forecast_variance_days 
---------+--------------+-----------------------+-------------------+------------------------
 ACM-102 |         46.3 |                   100 | 2026-12-11        |                    152
 ACM-103 |         20.0 |                  38.3 | 2027-01-23        |                    110
 ACM-101 |         62.0 |                  75.8 | 2026-09-17        |                     27
 ACM-204 |          0.0 |                   0.5 |                   |                       
 ACM-104 |          0.0 |                  81.3 |                   |                       
 ACM-105 |          0.0 |                   0.7 |                   |                       
 ACM-202 |          0.0 |                   0.8 |                   |                       
(7 rows)


=== Q3. Resource allocation across projects ===
   full_name   | project_code | allocation_pct | allocated_hours_per_week | start_date |  end_date  
---------------+--------------+----------------+--------------------------+------------+------------
 Lena Fischer  | ACM-101      |             60 |                    24.00 | 2026-05-23 | 2026-08-21
 Lena Fischer  | ACM-102      |             50 |                    20.00 | 2026-06-22 | 2026-08-11
 Lena Fischer  | ACM-103      |             20 |                     8.00 | 2026-07-12 | 2026-08-31
 Marco Rossi   | ACM-102      |             80 |                    32.00 | 2026-04-23 | 2026-07-02
 Marco Rossi   | ACM-101      |             60 |                    24.00 | 2026-07-03 | 2026-08-31
 Priya Nair    | ACM-101      |             70 |                    28.00 | 2026-06-12 | 2026-08-16
 Priya Nair    | ACM-102      |             45 |                    18.00 | 2026-07-07 | 2026-08-06
 Priya Nair    | ACM-202      |             50 |                    20.00 | 2026-07-23 | 2026-11-23
 Sara Kowalski | ACM-103      |             50 |                    16.00 | 2026-06-22 | 2026-09-10
 Sara Kowalski | ACM-101      |             30 |                     9.60 | 2026-07-17 | 2026-08-16
(10 rows)


=== Q4. Deliverables and completion status ===
  code   |               name                |   status    | percent_complete |  due_date  |  flag   
---------+-----------------------------------+-------------+------------------+------------+---------
 ACM-101 | Discovery & requirements          | completed   |              100 | 2026-05-13 | 
 ACM-101 | Design system & component library | completed   |              100 | 2026-06-07 | 
 ACM-101 | Authentication module             | in_progress |               70 | 2026-07-27 | 
 ACM-101 | Account dashboard                 | in_progress |               40 | 2026-08-11 | 
 ACM-101 | Accessibility audit               | not_started |                0 | 2026-08-19 | 
 ACM-102 | Settlement API contract           | completed   |              100 | 2026-04-18 | 
 ACM-102 | Ledger reconciliation engine      | blocked     |               55 | 2026-07-02 | OVERDUE
 ACM-102 | Fraud rules migration             | in_progress |               30 | 2026-07-17 | OVERDUE
 ACM-102 | Cutover rehearsal                 | not_started |                0 | 2026-08-16 | 
 ACM-103 | Bronze ingestion jobs             | in_progress |               60 | 2026-08-01 | 
 ACM-103 | Silver conformance layer          | not_started |                0 | 2026-08-26 | 
 ACM-103 | Gold aggregates & BI feed         | not_started |                0 | 2026-09-20 | 
(12 rows)


=== Q5. Over-allocated team members ===
Expect Lena Fischer 130% and Priya Nair 115%.
Lena appears twice: load rises as a third allocation starts.
  full_name   | from_date  | total_pct | concurrent_projects | excess_pct 
--------------+------------+-----------+---------------------+------------
 Priya Nair   | 2026-07-23 |       165 |                   3 |         65
 Lena Fischer | 2026-07-12 |       130 |                   3 |         30
 Priya Nair   | 2026-07-07 |       115 |                   2 |         15
 Lena Fischer | 2026-06-22 |       110 |                   2 |         10
(4 rows)


=== Q5b. Control case: sequential work must NOT count as overlap ===
Marco Rossi holds 80% then 60% on non-overlapping dates.
He must be absent from the results above. Expect 0 here.
 marco_false_positives 
-----------------------
                     0
(1 row)


=== Q6. Dependency chain between deliverables ===
             root_name             |          descendant_name          | descendant_status | depth 
-----------------------------------+-----------------------------------+-------------------+-------
 Discovery & requirements          | Cutover rehearsal                 | not_started       |     5
 Design system & component library | Cutover rehearsal                 | not_started       |     4
 Discovery & requirements          | Accessibility audit               | not_started       |     4
 Authentication module             | Cutover rehearsal                 | not_started       |     3
 Design system & component library | Accessibility audit               | not_started       |     3
 Discovery & requirements          | Account dashboard                 | in_progress       |     3
 Settlement API contract           | Cutover rehearsal                 | not_started       |     3
 Account dashboard                 | Cutover rehearsal                 | not_started       |     2
 Authentication module             | Accessibility audit               | not_started       |     2
 Bronze ingestion jobs             | Gold aggregates & BI feed         | not_started       |     2
 Design system & component library | Account dashboard                 | in_progress       |     2
 Discovery & requirements          | Authentication module             | in_progress       |     2
 Ledger reconciliation engine      | Cutover rehearsal                 | not_started       |     2
 Settlement API contract           | Fraud rules migration             | in_progress       |     2
 Accessibility audit               | Cutover rehearsal                 | not_started       |     1
 Account dashboard                 | Accessibility audit               | not_started       |     1
 Authentication module             | Account dashboard                 | in_progress       |     1
 Bronze ingestion jobs             | Silver conformance layer          | not_started       |     1
 Design system & component library | Authentication module             | in_progress       |     1
 Discovery & requirements          | Design system & component library | completed         |     1
(20 rows)


=== Q6b. Blocked work and everything it stalls ===
         blocked_item         |     stalled_item      | depth 
------------------------------+-----------------------+-------
 Ledger reconciliation engine | Fraud rules migration |     1
 Ledger reconciliation engine | Cutover rehearsal     |     2
(2 rows)


=== Q7. Budget consumed versus planned ===
 project_code | planned_budget | allocated_to_lines | consumed  | remaining | consumed_pct 
--------------+----------------+--------------------+-----------+-----------+--------------
 ACM-102      |      780000.00 |          780000.00 | 815000.00 | -35000.00 |        104.5
 ACM-101      |      450000.00 |          450000.00 | 225000.00 | 225000.00 |         50.0
 ACM-103      |      320000.00 |          320000.00 |  68000.00 | 252000.00 |         21.3
 ACM-104      |      210000.00 |          210000.00 |         0 | 210000.00 |          0.0
 ACM-204      |      100000.00 |                    |           |           |             
 ACM-202      |      300000.00 |                    |           |           |             
 ACM-106      |      140000.00 |                    |           |           |             
 ACM-105      |      275000.00 |                    |           |           |             
(8 rows)


=== Q7b. Budget lines individually overspent ===
Line-level overspend can hide inside a project that looks healthy.
  code   |  category   | planned_amount |   spent   |  pct  
---------+-------------+----------------+-----------+-------
 ACM-102 | Contractors |      240000.00 | 276000.00 | 115.0
 ACM-102 | Engineering |      420000.00 | 421000.00 | 100.2
(2 rows)


=== Data integrity: no fan-out in the budget aggregation ===
Both totals must match. A mismatch means expenses were multiplied by
the number of budget lines during the join.
  via_view  | direct_sum 
------------+------------
 1108000.00 | 1108000.00
(1 row)


=== Audit trail ===
   table_name    | operation | events 
-----------------+-----------+--------
 allocations     | DELETE    |      1
 allocations     | INSERT    |      2
 password_resets | INSERT    |      1
 password_resets | UPDATE    |      1
 projects        | DELETE    |      2
 projects        | INSERT    |      4
 projects        | UPDATE    |      1
 users           | DELETE    |      3
 users           | INSERT    |      9
 users           | UPDATE    |     27
(10 rows)


=== Cycle rejection (expects an ERROR, which is the pass condition) ===
A->B and B->A are each individually legal; only the pair is a cycle.
psql:tests/manual/verify-views.sql:133: WARNING:  FAIL: a cycle was accepted
DO

=== Password reset table and trigger ===
 outstanding_tokens 
--------------------
                  0
(1 row)

 reset_audit_events 
--------------------
                  2
(1 row)


=== Self-registered accounts are viewers ===
Any account not created by an administrator must be read-only.
    role     | accounts 
-------------+----------
 admin       |        1
 contributor |        4
 manager     |        6
 viewer      |        3
(4 rows)

```

---

## 4. Manual end-to-end testing

Full script in [MANUAL_TEST_PLAN.md](./MANUAL_TEST_PLAN.md), covering all four
roles across authentication, registration, password recovery, CRUD, validation,
filtering, dependency chains, allocations, user management, responsive layout
and keyboard navigation.

**Result: 104 passed, 1 not executed.**

Not executed — **8.4, silent token refresh after expiry.** It requires waiting
out the full one-hour access token lifetime. The mechanism is covered indirectly:
unit tests confirm an expired token raises `TokenError`, and the API client
retries once through `/refresh` on a 401. The end-to-end timing was not
observed, so it is recorded as a gap rather than assumed to work.**

---

## 5. Cloud deployment verification

Every check below was run against the deployed CloudFront URL, not locally.

```sh
API="https://d1ehv91jl1r1f2.cloudfront.net"
curl -s "$API/api/auth-service/health"
curl -s "$API/api/project-service/health"
curl -s "$API/api/analytics-service/health"
```

| Check | Result |
| --- | --- |
| Three services healthy (each runs `SELECT 1`) | ✓ |
| Login returns a signed token (271 characters) | ✓ |
| `/analytics-service/insights` returns 8 findings | ✓ |
| `sslmode=require` against Aurora | ✓ — first execution of this branch |
| Six migrations applied, row counts verified | ✓ 8 users, 6 projects, 12 deliverables |
| Migration service destroyed after use | ✓ |
| Frontend served from CloudFront | ✓ |

---

## 6. Defects found and fixed

Seven defects. Six of them unit tests could not have caught — they only appear
when a real browser talks to a real backend, or when code runs in the cloud for
the first time.

**1. The dev proxy discarded the `Authorization` header.**
`bin/proxy-server.js` forwards an allowlist of three headers (`accept`,
`content-type`, `user-agent`), so no authenticated request could succeed
locally. Diagnosed by comparing a request through the proxy against the
identical request sent directly to the Lambda Function URL. Patched the
allowlist to pass `authorization` through when present. Cloud is unaffected —
the Function URLs are configured with `allow_headers = ["*"]`.

**2. `v_resource_allocation` omitted its own primary key.**
The view exposed `project_id` and `user_id` but not `allocations.id`, so the UI
sent `DELETE /allocations/undefined` and PostgreSQL failed casting it to a
UUID, surfacing as a 500. Fixed in `004_expose_keys.sql`.

**3. `v_project_status` returned display names but not foreign keys.**
Department and manager came back as names, so the edit dialog could not
pre-select them and silently blanked the fields. Fixed in the same migration by
exposing `department_id`, `manager_id`, `description` and `planned_budget`.

**4. MUI v7 deprecated `InputLabelProps`.**
Date fields rendered their label on top of the browser's native placeholder.
Migrated to the `slotProps` API, and replaced native date inputs with MUI X
Date Pickers so the format could be fixed to DD/MM/YYYY.

**5. Dependencies were not packaged for LocalStack hot reload.**
Terraform builds a zip with dependencies installed, then LocalStack's hot reload
replaces that zip with a live mount of the source directory — so `psycopg` was
absent at runtime and every import failed with a bare `Internal Server Error`.
Resolved by vendoring the dependency into each service folder for local work;
cloud deploys install from `requirements.txt` as normal.

**6. A malformed token returned 500 instead of 401.**
`decode_token` raised `binascii.Error` on an unparseable segment, which is not a
`TokenError`, so it escaped the caller's guard. Fixed by wrapping the decode
steps and verifying the signature *before* parsing the payload, so an
unverified token's contents are never interpreted. A regression test was added.

**7. The JWT signing key was a hardcoded fallback.**
No `JWT_SECRET` is injected by the infrastructure, so the default constant was
the effective production signing key — publishing this repository would have let
anyone forge an admin token for the deployed environment. The key now derives
from per-deployment secrets. Found by reading the environment variables the
deployed Lambdas actually receive rather than trusting what the code assumed.

Three environment findings, not defects but worth recording:

**Aurora sits in a private VPC.** Migrations cannot be applied with `psql` from
the workstation. They were applied by a temporary Lambda inside the VPC, which
was destroyed immediately afterwards.

**Aurora Serverless v2 pauses at zero capacity.** With `MinCapacity: 0` and a
300-second auto-pause, the first connection after an idle period exceeded the
15-second connect timeout. Raised to 30. This presents as an intermittent
failure that disappears on retry — painful to diagnose later, cheap to fix now.

**Exported `PG*` variables break the local startup script.** After running
migrations against Aurora, `PGHOST` still pointed at the private endpoint, so
`pg_isready` probed a database the workstation cannot reach and `start-dev.sh`
reported PostgreSQL as down while it was running normally. The error names a
timeout rather than a hostname, which makes it confusing.

---

## 7. Known gaps

Stated plainly rather than omitted.

- **Frontend component tests are not written.** Vitest and React Testing Library
  are installed and configured, but no specs exist. Backend logic and end-to-end
  behaviour are covered; the middle layer is not.
- **Cypress specs are written but were not executed.**
  `frontend/cypress/e2e/critical-path.cy.js` covers the critical journeys with
  the selectors in place, but the suite has not been run.
- **Load testing not performed.** `tests/load/load-test.yml` is written with p95
  and error-rate thresholds but was not run. Aurora's auto-pause would also
  distort a cold first measurement.
- **The reset token is returned in the API response.** Deliberate, with no mail
  service available, and marked as such in the response body — but it means the
  forgot-password endpoint reveals whether an account exists.
- **Refresh tokens cannot be revoked before expiry.** No denylist, so a stolen
  refresh token stays valid for its 24-hour window.
- **The audit log records the actor only when the application sets it.** The
  trigger reads a session variable, so direct `psql` changes are captured with a
  null actor.
- **The frontend ships as one 1.15 MB bundle.** Works, but the first load is
  heavier than it needs to be.

---

## Reproducing

```sh
cd backend/_shared && python3 -m pytest tests/ -v --cov=.
./tests/manual/test-user-management.sh
psql -h localhost -p 5432 -U postgres -d postgres -f tests/manual/verify-views.sql
cd frontend && npx cypress run
npx artillery run tests/load/load-test.yml
```
