#!/usr/bin/env bash
# Manual verification of admin user management and its guard rails.
#
# Usage:  ./tests/manual/test-user-management.sh
# Requires: ./bin/start-dev.sh running (proxy on port 3001)
#
# Every check prints an HTTP status and PASS/FAIL. Capture the output for
# TESTING.md as evidence of manual validation.

BASE="${BASE:-http://localhost:3001}"
AUTH="$BASE/api/auth-service"

pass=0
fail=0

# Compare an actual status code against the expected one.
check() {
    local label="$1" expected="$2" actual="$3"
    if [ "$actual" = "$expected" ]; then
        printf '  PASS  %-52s %s\n' "$label" "$actual"
        pass=$((pass + 1))
    else
        printf '  FAIL  %-52s got %s, expected %s\n' "$label" "$actual" "$expected"
        fail=$((fail + 1))
    fi
}

login() {
    curl -s -X POST "$AUTH/login" -H "Content-Type: application/json" \
        -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null
}

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "=================================================="
echo "  User management — admin capabilities and limits"
echo "=================================================="

ADMIN=$(login admin@acme.com 'Admin@123')
MANAGER=$(login manager@acme.com 'Manager@123')
CONTRIB=$(login dev@acme.com 'Contrib@123')
VIEWER=$(login viewer@acme.com 'Viewer@123')

if [ -z "$ADMIN" ]; then
    echo "ERROR: could not sign in as admin. Is ./bin/start-dev.sh running?"
    exit 1
fi

TEST_EMAIL="qa.tester.$$@acme.com"

echo ""
echo "1. Reading users"
check "admin lists users" 200 \
    "$(status "$AUTH/users" -H "Authorization: Bearer $ADMIN")"
check "viewer lists users (read is allowed)" 200 \
    "$(status "$AUTH/users" -H "Authorization: Bearer $VIEWER")"
check "no token is rejected" 401 "$(status "$AUTH/users")"
check "garbage token is rejected" 401 \
    "$(status "$AUTH/users" -H "Authorization: Bearer not.a.token")"

echo ""
echo "2. Creating users — only admin may"
check "manager cannot create a user" 403 \
    "$(status -X POST "$AUTH/users" -H "Authorization: Bearer $MANAGER" \
       -H "Content-Type: application/json" \
       -d '{"email":"x1@acme.com","password":"Passw0rd1","full_name":"X","role":"viewer"}')"
check "contributor cannot create a user" 403 \
    "$(status -X POST "$AUTH/users" -H "Authorization: Bearer $CONTRIB" \
       -H "Content-Type: application/json" \
       -d '{"email":"x2@acme.com","password":"Passw0rd1","full_name":"X","role":"viewer"}')"
check "viewer cannot create a user" 403 \
    "$(status -X POST "$AUTH/users" -H "Authorization: Bearer $VIEWER" \
       -H "Content-Type: application/json" \
       -d '{"email":"x3@acme.com","password":"Passw0rd1","full_name":"X","role":"viewer"}')"

echo ""
echo "3. Validation on create"
check "missing required fields" 400 \
    "$(status -X POST "$AUTH/users" -H "Authorization: Bearer $ADMIN" \
       -H "Content-Type: application/json" -d '{"email":"incomplete@acme.com"}')"
check "password shorter than 8 characters" 400 \
    "$(status -X POST "$AUTH/users" -H "Authorization: Bearer $ADMIN" \
       -H "Content-Type: application/json" \
       -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"short\",\"full_name\":\"QA\",\"role\":\"viewer\"}")"
check "role outside the allowed set" 400 \
    "$(status -X POST "$AUTH/users" -H "Authorization: Bearer $ADMIN" \
       -H "Content-Type: application/json" \
       -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"Passw0rd1\",\"full_name\":\"QA\",\"role\":\"superuser\"}")"
check "duplicate email is rejected" 400 \
    "$(status -X POST "$AUTH/users" -H "Authorization: Bearer $ADMIN" \
       -H "Content-Type: application/json" \
       -d '{"email":"admin@acme.com","password":"Passw0rd1","full_name":"Clone","role":"viewer"}')"

echo ""
echo "4. Admin creates a user successfully"
check "create returns 201" 201 \
    "$(status -X POST "$AUTH/users" -H "Authorization: Bearer $ADMIN" \
       -H "Content-Type: application/json" \
       -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"Passw0rd1\",\"full_name\":\"QA Tester\",\"role\":\"contributor\",\"capacity_hours\":35,\"cost_rate\":65}")"

NEW_ID=$(curl -s "$AUTH/users?q=$TEST_EMAIL" -H "Authorization: Bearer $ADMIN" \
    | python3 -c "import sys,json; items=json.load(sys.stdin)['items']; print(items[0]['id'] if items else '')")
echo "        new user id: ${NEW_ID:-<not found>}"

check "the new user can sign in" 200 \
    "$(status -X POST "$AUTH/login" -H "Content-Type: application/json" \
       -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"Passw0rd1\"}")"
check "wrong password for the new user" 401 \
    "$(status -X POST "$AUTH/login" -H "Content-Type: application/json" \
       -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"WrongPass1\"}")"

echo ""
echo "5. Search and filter"
ROLE_COUNT=$(curl -s "$AUTH/users?role=contributor" -H "Authorization: Bearer $ADMIN" \
    | python3 -c "import sys,json; print(len(json.load(sys.stdin)['items']))")
echo "        contributors found: $ROLE_COUNT"
SEARCH_COUNT=$(curl -s "$AUTH/users?q=nobody-by-this-name" -H "Authorization: Bearer $ADMIN" \
    | python3 -c "import sys,json; print(len(json.load(sys.stdin)['items']))")
check "search with no matches returns an empty list" 0 "$SEARCH_COUNT"

echo ""
echo "6. Updating users"
check "admin promotes the new user to manager" 200 \
    "$(status -X PUT "$AUTH/users/$NEW_ID" -H "Authorization: Bearer $ADMIN" \
       -H "Content-Type: application/json" -d '{"role":"manager"}')"
check "invalid role on update" 400 \
    "$(status -X PUT "$AUTH/users/$NEW_ID" -H "Authorization: Bearer $ADMIN" \
       -H "Content-Type: application/json" -d '{"role":"wizard"}')"
check "update with no usable fields" 400 \
    "$(status -X PUT "$AUTH/users/$NEW_ID" -H "Authorization: Bearer $ADMIN" \
       -H "Content-Type: application/json" -d '{}')"
check "updating a user that does not exist" 404 \
    "$(status -X PUT "$AUTH/users/22222222-0000-0000-0000-999999999999" \
       -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
       -d '{"full_name":"Ghost"}')"
check "manager cannot update a user" 403 \
    "$(status -X PUT "$AUTH/users/$NEW_ID" -H "Authorization: Bearer $MANAGER" \
       -H "Content-Type: application/json" -d '{"full_name":"Hijacked"}')"

echo ""
echo "7. Privilege escalation is blocked"
CONTRIB_ID=$(curl -s "$AUTH/me" -H "Authorization: Bearer $CONTRIB" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
check "contributor cannot promote themselves" 403 \
    "$(status -X PUT "$AUTH/users/$CONTRIB_ID" -H "Authorization: Bearer $CONTRIB" \
       -H "Content-Type: application/json" -d '{"role":"admin"}')"

ADMIN_ID=$(curl -s "$AUTH/me" -H "Authorization: Bearer $ADMIN" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
# An admin demoting themselves could leave the system with no administrator.
check "admin cannot change their own role" 400 \
    "$(status -X PUT "$AUTH/users/$ADMIN_ID" -H "Authorization: Bearer $ADMIN" \
       -H "Content-Type: application/json" -d '{"role":"viewer"}')"
check "admin cannot delete their own account" 400 \
    "$(status -X DELETE "$AUTH/users/$ADMIN_ID" -H "Authorization: Bearer $ADMIN")"
check "admin may still edit their own name" 200 \
    "$(status -X PUT "$AUTH/users/$ADMIN_ID" -H "Authorization: Bearer $ADMIN" \
       -H "Content-Type: application/json" -d '{"full_name":"Amara Okafor"}')"

echo ""
echo "8. Deactivation"
check "manager cannot deactivate a user" 403 \
    "$(status -X DELETE "$AUTH/users/$NEW_ID" -H "Authorization: Bearer $MANAGER")"
check "admin deactivates the test user" 204 \
    "$(status -X DELETE "$AUTH/users/$NEW_ID" -H "Authorization: Bearer $ADMIN")"
# Soft delete: the row survives so projects that reference it stay intact.
check "a deactivated user cannot sign in" 403 \
    "$(status -X POST "$AUTH/login" -H "Content-Type: application/json" \
       -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"Passw0rd1\"}")"
check "deleting a user that does not exist" 404 \
    "$(status -X DELETE "$AUTH/users/22222222-0000-0000-0000-999999999999" \
       -H "Authorization: Bearer $ADMIN")"

STILL_THERE=$(curl -s "$AUTH/users?q=$TEST_EMAIL" -H "Authorization: Bearer $ADMIN" \
    | python3 -c "import sys,json; items=json.load(sys.stdin)['items']; print(items[0]['is_active'] if items else 'gone')")
echo "        test user is_active after delete: $STILL_THERE  (expect False — soft delete)"

echo ""
echo "9. Audit trail"
echo "  Run this to confirm the triggers captured every change:"
echo "    psql -h localhost -p 5432 -U postgres -d postgres -P pager=off \\"
echo "      -c \"SELECT operation, count(*) FROM audit_log WHERE table_name='users' GROUP BY 1;\""

echo ""
echo "=================================================="
printf '  %d passed, %d failed\n' "$pass" "$fail"
echo "=================================================="

[ "$fail" -eq 0 ]
