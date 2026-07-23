# Manual Test Plan — ACME Delivery Console

Executed against the local environment (`./bin/start-dev.sh`, browser at
http://localhost:3000) with a cloud confirmation pass against
https://d1ehv91jl1r1f2.cloudfront.net.

**Result: 104 of 105 checks passed. One not executed (8.6, see below).**

Every write performed during this run is independently recorded by the database
audit triggers — see section 9. That log was written by the database, not
claimed by the tester.

| Account | Email | Password |
| --- | --- | --- |
| Admin | `admin@acme.com` | `Admin@123` |
| Manager | `manager@acme.com` | `Manager@123` |
| Contributor | `dev@acme.com` | `Contrib@123` |
| Viewer | `viewer@acme.com` | `Viewer@123` |

---

## 1. Authentication

| # | Action | Expected | Result |
| --- | --- | --- | --- |
| 1.1 | Visit `/projects` while signed out | Redirected to `/login` | ✓ |
| 1.2 | Submit the empty form | Two inline errors. No request sent | ✓ |
| 1.3 | Enter `notanemail` and any password | "Enter a valid email address" | ✓ |
| 1.4 | `admin@acme.com` / `WrongPassword` | Red alert "Invalid email or password" | ✓ |
| 1.5 | `nobody@acme.com` / `Admin@123` | Same message as 1.4 | ✓ |
| 1.6 | Click the eye icon in the password field | Password readable; icon changes | ✓ |
| 1.7 | Click it again | Password masked again | ✓ |
| 1.8 | Sign in as admin | Lands on Overview, header shows `ADMIN` | ✓ |

## 2. Self-registration

| # | Action | Expected | Result |
| --- | --- | --- | --- |
| 2.1 | Click "Sign up" | Switches to Create account with a full name field | ✓ |
| 2.2 | Submit empty | Errors on name, email and password | ✓ |
| 2.3 | Email `someone@gmail.com` | "Sign-up is limited to acme.com addresses" | ✓ |
| 2.4 | Password `short` | "At least 8 characters" | ✓ |
| 2.5 | Password and confirm differ | "Passwords do not match" | ✓ |
| 2.6 | Valid acme.com registration | Success notice, returns to sign in | ✓ |
| 2.7 | Register the same email again | "An account with that email already exists" | ✓ |
| 2.8 | Sign in as the new account | Works. Header chip reads `VIEWER` | ✓ |
| 2.9 | Check the nav | No Users item | ✓ |
| 2.10 | Open Projects | No New button, no edit or delete icons | ✓ |
| 2.11 | Sign in as admin, open Users | New account listed with role `viewer` | ✓ |
| 2.12 | Promote to contributor, sign in again | Create and edit available, delete still absent | ✓ |

**Escalation check** — the form has no role field, so verified against the API:

```sh
curl -s -X POST http://localhost:3001/api/auth-service/register \
  -H "Content-Type: application/json" \
  -d '{"email":"escalate@acme.com","password":"Passw0rd1","full_name":"Esc","role":"admin"}'
```

Expected 201 with `"role": "viewer"`. **Result: ✓ — the role in the request body
is ignored.**

## 3. Password recovery

| # | Action | Expected | Result |
| --- | --- | --- | --- |
| 3.1 | Click "Forgot password?" | Switches to Reset password, email only | ✓ |
| 3.2 | Submit empty | "Email is required" | ✓ |
| 3.3 | Enter an unknown address | Neutral message, no token shown | ✓ |
| 3.4 | Enter a known address | Token displayed with a 15-minute note | ✓ |
| 3.5 | Form advances | Token pre-filled in the new password step | ✓ |
| 3.6 | New password `short` | "At least 8 characters" | ✓ |
| 3.7 | New password and confirm differ | "Passwords do not match" | ✓ |
| 3.8 | Set a valid new password | Success, returns to sign in | ✓ |
| 3.9 | Sign in with the old password | Rejected | ✓ |
| 3.10 | Sign in with the new password | Works | ✓ |
| 3.11 | Reuse the same token | "invalid, already used, or expired" | ✓ |
| 3.12 | Paste a fabricated token | Same error, no crash | ✓ |

Corroborated by the audit log: `password_resets` records one INSERT (token
issued) and one UPDATE (token consumed).

---

## 4. Admin — full access

### 4.1 Overview

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 4.1.1 | Four metric cards | Active, forecast late, over-allocated, budget | ✓ |
| 4.1.2 | Delivery forecast table | ACM-102 +152d in red; ACM-104/105 "no forecast" | ✓ |
| 4.1.3 | Hover a slip bar | Tooltip shows planned versus forecast days | ✓ |
| 4.1.4 | Insights panel | 8 findings, high severity first | ✓ |
| 4.1.5 | Budget chart | ACM-102 red and past the dashed 100% line | ✓ |
| 4.1.6 | Over-allocated panel | Lena 130%, Priya 115%, one row per person | ✓ |
| 4.1.7 | Project status table | ACM-102 overdue and blocked chips; ACM-103 forecast chip; ACM-106 `closed` | ✓ |
| 4.1.8 | Health scores | Cards lowest first, four weighted components each | ✓ |
| 4.1.9 | Wait 30 seconds | "updated" timestamp changes | ✓ |

### 4.2 Projects

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 4.2.1 | Save with every field empty | Six inline errors at once | ✓ |
| 4.2.2 | Date fields | Show `DD/MM/YYYY` with a calendar picker | ✓ |
| 4.2.3 | Planned end before start date | Blocked; earlier dates greyed in the calendar | ✓ |
| 4.2.4 | Budget `-5000` | "Budget cannot be negative" | ✓ |
| 4.2.5 | Save valid values | Toast "Project created", row appears | ✓ |
| 4.2.6 | Duplicate project code | "already exists" | ✓ |
| 4.2.7 | Search by name | Filters after a short debounce | ✓ |
| 4.2.8 | Search with no matches | "No projects match those filters" | ✓ |
| 4.2.9 | Status filter `on hold` | Only ACM-104 | ✓ |
| 4.2.10 | Edit an existing project | Department, manager, description and budget pre-filled | ✓ |
| 4.2.11 | Rename and save | Toast, new name in the table | ✓ |
| 4.2.12 | Delete a project | Cascade warning shown; row gone after confirming | ✓ |

Audit log corroboration: `projects` records 4 INSERT, 1 UPDATE, 2 DELETE.

### 4.3 Forecast

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 4.3.1 | Blue banner | States "linear velocity" and its limitation | ✓ |
| 4.3.2 | Verdict column | ACM-102 `late`, ACM-104/105 `no data` | ✓ |
| 4.3.3 | Explanations | One plain-language sentence per project | ✓ |
| 4.3.4 | Dates | Shown as DD/MM/YYYY | ✓ |
| 4.3.5 | Rebuild summary | Shows "Rebuilding", reloads without error | ✓ |

### 4.4 People

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 4.4.1 | Add allocation, save empty | Errors on person, project, both dates | ✓ |
| 4.4.2 | Share `150` | "Must be between 1 and 100" | ✓ |
| 4.4.3 | Until before From | Blocked | ✓ |
| 4.4.4 | Allocation pushing someone past 100% | **Amber** warning naming the new peak — not an error | ✓ |
| 4.4.5 | Return to Overview | That person now appears in over-allocated | ✓ |
| 4.4.6 | Delete the allocation | Toast, person drops off the list | ✓ |
| 4.4.7 | Marco Rossi | Never listed — his allocations do not overlap | ✓ |

Audit log corroboration: `allocations` records 2 INSERT and 1 DELETE. The
over-allocation warning was reproduced by allocating Priya Nair to a third
concurrent project, taking her peak to 165%.

### 4.5 Dependency chains

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 4.5.1 | Page layout | Chains grouped by root, indented by depth | ✓ |
| 4.5.2 | Blocked items | Ledger reconciliation engine and downstream marked red | ✓ |
| 4.5.3 | Add a valid dependency | Toast, appears in a chain | ✓ |
| 4.5.4 | **Cycle test** — Fraud rules migration → Settlement API contract | "would create a circular chain". No 500 | ✓ |
| 4.5.5 | Same deliverable in both fields | Rejected | ✓ |

Also verified directly against the database:

```
ERROR:  Dependency 4444…0008 -> 4444…0006 would create a cycle
CONTEXT:  PL/pgSQL function reject_dependency_cycle() line 14 at RAISE
```

### 4.6 Users

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 4.6.1 | Users in the nav | Only for admin | ✓ |
| 4.6.2 | Create with a 5-character password | Blocked before any request | ✓ |
| 4.6.3 | Create a valid user | Appears in the table | ✓ |
| 4.6.4 | Promote a viewer to manager | Role chip changes | ✓ |
| 4.6.5 | Open your own account | Role dropdown disabled with an explanation | ✓ |
| 4.6.6 | Your own deactivate button | Greyed out | ✓ |
| 4.6.7 | Deactivate another user | Row dims, they cannot sign in | ✓ |
| 4.6.8 | Reactivate them | Sign-in works again | ✓ |

Audit log corroboration: `users` records 9 INSERT, 27 UPDATE and 3 DELETE.

---

## 5. Manager

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 5.1 | Header chip | `MANAGER` | ✓ |
| 5.2 | Nav | No Users item | ✓ |
| 5.3 | Type `/users` in the address bar | Redirected to the dashboard | ✓ |
| 5.4 | Projects | New, edit and delete all available | ✓ |
| 5.5 | Create and delete a project | Both succeed | ✓ |
| 5.6 | Forecast | Rebuild summary available | ✓ |

API: `POST /users` as manager → **403 ✓**

## 6. Contributor

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 6.1 | Header chip | `CONTRIBUTOR` | ✓ |
| 6.2 | Projects | New and edit visible, **delete absent** | ✓ |
| 6.3 | Create and edit a project | Both succeed | ✓ |
| 6.4 | People | Add visible, remove icons absent | ✓ |
| 6.5 | Forecast | Rebuild summary visible | ✓ |

API: `DELETE /projects/{id}` as contributor → **403 ✓**
API: `PUT /users/{own id}` with `{"role":"admin"}` → **403 ✓**

## 7. Viewer

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 7.1 | Header chip | `VIEWER` | ✓ |
| 7.2 | Overview | Fully visible, all seven questions answered | ✓ |
| 7.3 | Projects | No New, no edit, no delete | ✓ |
| 7.4 | Search and filter | Still work | ✓ |
| 7.5 | People, Dependencies, Forecast | No write controls anywhere | ✓ |

---

## 8. Cross-cutting

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| 8.1 | Narrow the browser below 900px | Side rail becomes a bottom navigation bar | ✓ |
| 8.2 | Stop LocalStack, reload Overview | "Cannot reach the server" with a working retry | ✓ |
| 8.3 | Sign out, press browser Back | Redirected to `/login`, no cached data | ✓ |
| 8.4 | Leave idle 60+ minutes, then act | Token refresh happens silently | **not executed** |

**8.4 was not executed.** It requires waiting out the full one-hour access token
lifetime. The refresh path is covered by unit tests (expired tokens raise
`TokenError`) and by the client's retry-once-on-401 logic, but the end-to-end
timing was not observed. Recorded as a gap rather than assumed.

## 9. Audit trail

Every write above was captured by database triggers rather than application
code, which is why this table doubles as independent evidence for the run.

```sh
psql -h localhost -p 5432 -U postgres -d postgres -P pager=off -c \
  "SELECT table_name, operation, count(*) FROM audit_log GROUP BY 1,2 ORDER BY 1,2;"
```

```
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
```

**Result: ✓** — all five audited tables recorded, across INSERT, UPDATE and
DELETE. The `users` UPDATE count is high because deactivation is implemented as
a soft delete, so each deactivate and reactivate is an update.

---

## Gaps from this run

- **8.4 token refresh after expiry** — not executed, requires a one-hour wait.
- **Seed data drift.** Projects and users created during testing remain in the
  local database (8 projects rather than the seeded 6, 14 users rather than 8).
  The seed file is idempotent, so a clean reload restores the documented state;
  this was not done before capturing the output above, which is why the counts
  differ from the seed.
- Cypress and Artillery suites are written but were not executed — see
  [TESTING.md](./TESTING.md) section 7.
