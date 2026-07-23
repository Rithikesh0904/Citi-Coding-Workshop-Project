# ACME Delivery Console

A project management and delivery-tracking platform for ACME Inc. Gives project
managers real-time visibility into project health, resource utilisation, budget
consumption, and forecast completion dates.

**Live application:** https://d1ehv91jl1r1f2.cloudfront.net

| Role | Email | Password | Can do |
| --- | --- | --- | --- |
| Admin | `admin@acme.com` | `Admin@123` | Everything, including managing users |
| Manager | `manager@acme.com` | `Manager@123` | Everything except managing users |
| Contributor | `dev@acme.com` | `Contrib@123` | Create and update, never delete |
| Viewer | `viewer@acme.com` | `Viewer@123` | Read only |

Anyone with an `@acme.com` address can also sign up from the login page. Self
registration always produces a read-only account; only an administrator can
grant further permissions.

---

## The business problem

ACME runs projects across several departments with no single view of progress.
Managers cannot tell which projects are slipping, who is over-committed, or how
much budget has actually been spent, and they have no way to forecast completion
dates. This platform answers seven questions directly, plus the forecasting gap.

| # | Question | Answered by |
| --- | --- | --- |
| 1 | What is the status of each active project? | `v_project_status` → `GET /dashboard` |
| 2 | Which projects will miss their deadline? | `v_project_risk` + `v_project_forecast` |
| 3 | How are resources allocated across projects? | `v_resource_allocation` → `GET /allocations` |
| 4 | What are the deliverables and their status? | `v_project_status` → `GET /deliverables` |
| 5 | Who is over-allocated? | `v_over_allocated_users` |
| 6 | What is the dependency chain? | `v_deliverable_dependency_chain` |
| 7 | Budget consumed versus planned? | `v_budget_consumption` → `GET /budget` |
| + | When will each project actually finish? | `v_project_forecast` → `GET /forecast` |

Every question is answered by a database view rather than application code. The
aggregation runs where the data lives, the logic is inspectable in SQL without
running anything, and the views are reusable across services.

---

## Architecture

```
Browser
   │
   ├── CloudFront ──> S3            React single-page application
   │
   └── CloudFront ──> Lambda Function URLs
         ├── auth-service        authentication, registration, recovery, users
         ├── project-service     projects, deliverables, dependencies,
         │                       allocations, budget   (transactional writes)
         └── analytics-service   forecasting, health scores, insights, audit
                                 (derived reads)
                    │
              Aurora Serverless v2 PostgreSQL   (private VPC, no public route)
```

Three Lambdas split by bounded context rather than by entity. `auth-service` is
isolated because a security boundary should have the smallest possible surface.
`project-service` owns writes. `analytics-service` owns derived reads, so a slow
analytical query can never block someone saving a deliverable.

Shared code lives in `backend/_shared/` and is copied into each service by
`bin/sync-shared.sh` before every deploy. Terraform packages each service
directory independently and the runtime uses flat same-directory imports, so
shared modules must physically ship inside each zip. Folders prefixed with `_`
are excluded from Terraform's service discovery, which is why `_shared` and
`_database` are never deployed as Lambdas.

---

## Running it

### Local

```sh
./bin/setup-environment.sh -d          # one time only

# Create the application database and extension
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres123';"
sudo -u postgres psql -d postgres -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# Allow the Lambda containers to reach PostgreSQL over the Docker bridge
PG_CONF=$(sudo -u postgres psql -tAc "SHOW config_file;")
PG_HBA=$(sudo -u postgres psql -tAc "SHOW hba_file;")
sudo sed -i "s/^#\?listen_addresses.*/listen_addresses = '*'/" "$PG_CONF"
echo "host all all 172.17.0.0/16 scram-sha-256" | sudo tee -a "$PG_HBA"
sudo systemctl restart postgresql

# Apply the schema
export PGPASSWORD=postgres123
for f in backend/_database/migrations/*.sql; do
  psql -h localhost -p 5432 -U postgres -d postgres -f "$f"
done

# Install dependencies and run
./bin/sync-shared.sh
./bin/start-dev.sh                     # frontend :3000, API proxy :3001
```

Verify:

```sh
curl -s http://localhost:3001/api/project-service/health
curl -s -X POST http://localhost:3001/api/auth-service/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@acme.com","password":"Admin@123"}'
```

### Cloud

```sh
./bin/sync-shared.sh
./bin/deploy-backend.sh                # no argument = AWS
./bin/generate-env.sh
cd frontend && npm run build && cd ..
./bin/deploy-frontend.sh
```

Aurora is inside the VPC with no public route, so migrations cannot be applied
with `psql` from the workstation. They are applied by a temporary Lambda placed
inside the same VPC, which is deleted immediately afterwards — see
[Trade-offs](#trade-offs-and-assumptions).

### Tear down

```sh
./bin/cleanup-environment.sh
```

---

## API reference

Errors always use the shape `{"error": "...", "details": [...]}` so the frontend
has one handling path.

### Authentication and accounts

| Method | Endpoint | Access |
| --- | --- | --- |
| POST | `/api/auth-service/login` | public |
| POST | `/api/auth-service/register` | public — always creates a viewer |
| POST | `/api/auth-service/forgot-password` | public |
| POST | `/api/auth-service/reset-password` | public, with a valid token |
| POST | `/api/auth-service/refresh` | valid refresh token |
| GET | `/api/auth-service/me` | authenticated |
| GET | `/api/auth-service/users` | read |
| POST | `/api/auth-service/users` | manage_users |
| PUT | `/api/auth-service/users/{id}` | manage_users |
| DELETE | `/api/auth-service/users/{id}` | manage_users |

### Projects and delivery

| Method | Endpoint | Access |
| --- | --- | --- |
| GET | `/api/project-service/dashboard` | read |
| GET · POST | `/api/project-service/projects` | read · create |
| GET · PUT · DELETE | `/api/project-service/projects/{id}` | read · update · delete |
| GET · POST | `/api/project-service/deliverables` | read · create |
| PUT · DELETE | `/api/project-service/deliverables/{id}` | update · delete |
| GET · POST · DELETE | `/api/project-service/dependencies` | read · create · delete |
| GET · POST | `/api/project-service/allocations` | read · create |
| DELETE | `/api/project-service/allocations/{id}` | delete |
| GET | `/api/project-service/budget` | read |
| POST | `/api/project-service/expenses` | create |
| GET | `/api/project-service/departments` | read |

### Analytics

| Method | Endpoint | Access |
| --- | --- | --- |
| GET | `/api/analytics-service/portfolio` | read |
| GET | `/api/analytics-service/forecast` | read |
| GET | `/api/analytics-service/scores` | read |
| GET | `/api/analytics-service/insights` | read |
| GET | `/api/analytics-service/audit` | read |
| POST | `/api/analytics-service/refresh` | update |

**Filtering.** `GET /projects` accepts `status`, `manager`, `department`, `q`.
`GET /deliverables` accepts `project_id`, `status`, `overdue`, `q`.
`GET /users` accepts `role`, `q`. `GET /audit` accepts `table`, `record_id`,
`operation`, `limit`.

**Status codes.** 200 read/update · 201 create · 204 delete · 400 validation ·
401 unauthenticated · 403 forbidden · 404 not found · 405 wrong method ·
500 server error.

### Role permissions

| Role | read | create | update | delete | manage_users |
| --- | --- | --- | --- | --- | --- |
| Admin | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manager | ✓ | ✓ | ✓ | ✓ | |
| Contributor | ✓ | ✓ | ✓ | | |
| Viewer | ✓ | | | | |

Permissions are defined once in `security.PERMISSIONS` and enforced by a single
`require(event, action)` guard. The frontend hides controls a role cannot use,
but that is a usability aid — the server re-checks every write independently.

---

## Security

- Passwords hashed with PBKDF2-HMAC-SHA256, 120,000 iterations, unique random
  salt per password. Plaintext is never stored or logged.
- JWT signed with HMAC-SHA256, verified with a constant-time comparison so a
  timing attack cannot recover the key. The signature is checked *before* the
  payload is parsed, so an unverified token's contents are never interpreted.
- The signing key derives from per-deployment secrets rather than a constant,
  because no `JWT_SECRET` is injected by the infrastructure and a hardcoded
  fallback would be published with this repository.
- Access tokens expire after 1 hour, refresh tokens after 24. Refresh re-reads
  the user, so a deactivated or demoted account cannot renew its way back in.
- Every SQL statement is parameterised. There is no string interpolation into
  SQL anywhere in the codebase.
- Login returns the same error for an unknown email and a wrong password, so it
  cannot be used to discover which accounts exist.
- Self-registration hardcodes the role and ignores any role in the request body,
  so the public endpoint can never grant permissions.
- Registration is limited to `@acme.com` addresses, because this console exposes
  budgets, cost rates and staffing.
- Admins cannot change their own role or delete their own account, either of
  which could leave the system with no administrator.
- Reset tokens carry 256 bits of entropy, are stored only as a hash, expire
  after 15 minutes, and are single-use. Completing a reset burns every
  outstanding token for that user.
- `password_hash` is stripped from every audit log entry.

---

## Testing

See [TESTING.md](./TESTING.md) for results and [MANUAL_TEST_PLAN.md](./MANUAL_TEST_PLAN.md)
for the step-by-step script.

```sh
cd backend/_shared && python3 -m pytest tests/ -v --cov=.   # 56 tests
./tests/manual/test-user-management.sh                      # 28 API checks
psql ... -f tests/manual/verify-views.sql                   # database views
cd frontend && npx cypress run                              # end-to-end
npx artillery run tests/load/load-test.yml                  # load
```

---

## Trade-offs and assumptions

**Business questions answered by SQL views, not Python.** The database is better
at aggregation than application code, the logic is inspectable without running
anything, and the views are reusable across services.

**Over-allocation is detected, never prevented.** The business asked to *find*
over-committed people. A constraint blocking the insert would suppress exactly
the signal the dashboard exists to surface, so the API returns a warning on the
created allocation instead.

**Over-allocation is computed by probing allocation start dates only.**
Concurrent load is a step function that can only rise at the start of an
allocation, so its maximum always occurs at one of those boundaries. This is
exact and avoids expanding a row per person per day. The view returns one row
per date on which a person exceeds capacity, so the UI groups by person and
shows the peak.

**The budget view aggregates expenses before joining.** Joining budget lines to
expenses and summing both in one pass multiplies planned amounts by the expense
row count. That bug produces plausible-looking wrong numbers rather than an
error, so it is worth naming.

**Dependency cycles are rejected by a database trigger.** A→B and B→A are each
valid on their own; only the pair is illegal, so nothing short of a write-time
reachability check catches it. The check lives in the database rather than
application code so it cannot be bypassed by a new endpoint or a direct SQL
session. The recursive view carries a path guard anyway, so it stays queryable
even against dirty data.

**Audit logging by trigger, not application code.** A trigger cannot be
forgotten when a new endpoint is added, and it captures changes made directly in
`psql`. The cost is that the actor is only recorded when the application sets
the session variable, so the column is nullable.

**Forecasting uses a linear velocity model.** A project 40% complete after 60
days is projected to need 150 days in total. Deliberately simple — a manager can
check the arithmetic by hand, which matters more here than sophistication. It
over-estimates for projects that front-load easy work, and returns no forecast
for projects with zero progress. The UI states that assumption on screen rather
than presenting the number as certain.

**Health scores are rule-based, not machine-learned.** Every score ships with
its four weighted components. A manager can argue with a weighted score; they
cannot argue with a black box. That is the right trade for a tool whose output
drives staffing decisions.

**Standard-library JWT and PBKDF2 instead of PyJWT and bcrypt.** Every added
dependency is a way for a deploy that works locally to fail in the cloud. These
are the same primitives those libraries use underneath. A production system
would prefer argon2id for its memory-hardness; that is the one thing given up.

**Reset tokens are hashed with plain SHA-256, not PBKDF2.** Stretching exists to
defend low-entropy human passwords against brute force. A 256-bit random token
cannot be brute forced, so the iteration cost would buy nothing.

**The reset token is returned in the API response.** No mail service is
provisioned. Everything else about the flow is production-shaped — random,
hashed at rest, expiring, single-use — and the one change needed for production
is emailing the token instead of returning it. This is the single deliberate
security compromise in the project, made for demonstrability and marked as such
in the response body itself.

**Self-registration and admin user management do different jobs.** Registration
is how you get in; admin management is how you get permissions. The registration
endpoint hardcodes the role, so sign-up can never be an escalation route. A
production system would add email verification, or hold new accounts inactive
pending admin approval.

**Three services, not seven.** The endpoint reference in the workshop guide
implies one entity per Lambda. Splitting that far would multiply deploy cycles
and cold starts without a matching benefit at this scale.

**Migrations applied by a temporary Lambda.** Aurora sits in a private VPC with
no public route, so `psql` from the workstation cannot reach it. A throwaway
service inside the VPC applied the SQL and was destroyed immediately afterwards.
It required a confirmation token matching the participant id, because Lambda
Function URLs are created with no authorizer.

**Aurora Serverless v2 connect timeout raised to 30 seconds.** With
`MinCapacity: 0` the cluster pauses after five minutes idle, and the first
connection after a pause exceeded a 15-second timeout tuned for a warm database.
It presents as an intermittent failure that vanishes on retry.

**Real-time updates use polling, not WebSockets.** Lambda Function URLs cannot
hold a persistent connection; true push would need API Gateway's WebSocket API
and a connection store. The dashboard polls every 30 seconds and pauses when the
tab is hidden.

**Vitest instead of Jest.** The guide names Jest, but this is a Vite project.
Vitest has the same API and needs no separate build configuration.

**MUI X Date Pickers with an explicit DD/MM/YYYY format.** A native
`<input type="date">` renders in the browser's locale with no way to override
it. State is kept in ISO throughout and converted only at the display edge,
which keeps the API contract unchanged and keeps date comparisons working —
`'2026-01-15' < '2026-06-30'` holds for ISO strings and fails for DD/MM.

**Users are soft-deleted.** Projects reference users as managers, so a hard
delete would either cascade away real work or fail on a foreign key.
`is_active = false` preserves history and can be reversed.

**MongoDB and DocumentDB were not used.** They are opt-in and not provisioned in
the cloud by default. The domain is highly relational — dependency chains,
overlapping allocations, budget rollups — and PostgreSQL's recursive CTEs and
constraints do real work here that a document store would push into application
code.

---

## Known limitations

- Frontend component tests are not written. Vitest and React Testing Library are
  configured but no specs exist; backend logic and end-to-end behaviour are
  covered, the middle layer is not.
- The frontend ships as a single 1.15 MB bundle (353 kB gzipped). The fix is
  `manualChunks` for vendor splitting, or lazy-loading the Forecast and Users
  routes.
- Refresh tokens cannot be revoked before expiry — there is no denylist.
- Forecasting assumes constant velocity and needs at least one deliverable with
  non-zero progress.
- The materialised portfolio view is refreshed on demand rather than on a
  schedule; production would use an EventBridge rule.
- Local and cloud Terraform state share one directory. `start-dev.sh` re-points
  the backend at LocalStack, so switching to AWS requires running
  `deploy-backend.sh` first.
- Exported `PG*` environment variables from cloud work redirect every local
  `psql` and `pg_isready` call, which makes `start-dev.sh` report PostgreSQL as
  down when it is running. Unset them or use a fresh terminal.

---

## Repository layout

```
backend/
  _database/migrations/    001 schema · 002 seed · 003 analytics
                           004 expose keys · 005 closure · 006 password reset
  _shared/                 single source of truth for shared modules
    tests/                 56 pytest cases
  auth-service/            authentication, registration, recovery, users
  project-service/         transactional CRUD
  analytics-service/       forecasting, scoring, insights, audit
bin/
  sync-shared.sh           copies _shared into each service before deploy
frontend/
  src/api/                 single fetch client with token refresh
  src/components/          layout and shared UI
  src/context/             auth state and permission helper
  src/pages/               login, dashboard, projects, forecast, people,
                           dependencies, users
  cypress/e2e/             end-to-end journeys
tests/
  manual/                  API authorisation script and view verification SQL
  load/                    Artillery configuration
infra/                     Terraform (provided by the workshop)
```
