"""
Auth service: authentication, token issuance, and user administration.

Routes (mounted under /api/auth-service):
    GET    /health
    POST   /login
    POST   /refresh
    GET    /me
    GET    /users            (read)
    POST   /users            (manage_users)
    PUT    /users/{id}       (manage_users)
    DELETE /users/{id}       (manage_users)
"""

import db
from http_utils import (ApiError, Router, error, get_body, get_query, require,
                        respond, validate)
from security import (ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL, RESET_TOKEN_TTL_MINUTES,
                      ROLES, SELF_REGISTRATION_ROLE, create_token,
                      email_domain_allowed, generate_reset_token,
                      hash_password, hash_reset_token, verify_password)

SERVICE = "auth-service"

USER_FIELDS = ("id", "email", "full_name", "role", "capacity_hours",
               "cost_rate", "is_active", "created_at")
USER_COLUMNS = ", ".join(USER_FIELDS)


# --------------------------------------------------------------------------
# Public routes
# --------------------------------------------------------------------------

def health(event, params):
    db.query_one("SELECT 1 AS ok")
    return respond(200, {"status": "healthy", "service": SERVICE})


def login(event, params):
    body = validate(get_body(event), required=("email", "password"))

    user = db.query_one(
        "SELECT id, email, full_name, role, password_hash, is_active "
        "FROM users WHERE lower(email) = lower(%s)",
        (body["email"],),
    )

    # Same message and same code path whether the email is unknown or the
    # password is wrong, so the endpoint cannot be used to enumerate accounts.
    if not user or not verify_password(body["password"], user["password_hash"]):
        raise ApiError(401, "Invalid email or password")
    if not user["is_active"]:
        raise ApiError(403, "This account has been deactivated")

    claims = {
        "sub": str(user["id"]),
        "email": user["email"],
        "name": user["full_name"],
        "role": user["role"],
    }
    return respond(200, {
        "access_token": create_token(claims, ACCESS_TOKEN_TTL),
        "refresh_token": create_token({**claims, "typ": "refresh"}, REFRESH_TOKEN_TTL),
        "expires_in": ACCESS_TOKEN_TTL,
        "user": {k: v for k, v in user.items() if k != "password_hash"},
    })


def refresh(event, params):
    """Exchange a valid refresh token for a new access token."""
    from http_utils import get_current_user
    claims = get_current_user(event)
    if claims.get("typ") != "refresh":
        raise ApiError(401, "A refresh token is required for this endpoint")

    # Re-read the user so a deactivated or demoted account cannot keep
    # refreshing its way to a valid token.
    user = db.query_one(
        "SELECT id, email, full_name, role, is_active FROM users WHERE id = %s",
        (claims["sub"],),
    )
    if not user or not user["is_active"]:
        raise ApiError(401, "Account is no longer active")

    return respond(200, {
        "access_token": create_token({
            "sub": str(user["id"]), "email": user["email"],
            "name": user["full_name"], "role": user["role"],
        }),
        "expires_in": ACCESS_TOKEN_TTL,
    })


def me(event, params):
    from http_utils import get_current_user
    claims = get_current_user(event)
    user = db.query_one(
        f"SELECT {USER_COLUMNS} FROM users WHERE id = %s", (claims["sub"],)
    )
    if not user:
        raise ApiError(404, "User not found")
    return respond(200, user)


# --------------------------------------------------------------------------
# Self-service account creation and recovery
# --------------------------------------------------------------------------

def register(event, params):
    """
    Public sign-up.

    The role is hardcoded, never read from the request body. Self-registration
    can therefore only ever produce a read-only account; an admin promotes from
    there. This is what keeps the endpoint from becoming a privilege
    escalation route.
    """
    body = validate(get_body(event), required=("email", "password", "full_name"))
    email = body["email"].strip().lower()

    if not email_domain_allowed(email):
        raise ApiError(400, "Sign-up is limited to acme.com email addresses")
    if len(body["password"]) < 8:
        raise ApiError(400, "Validation failed", ["Password must be at least 8 characters"])
    if db.query_one("SELECT 1 FROM users WHERE lower(email) = %s", (email,)):
        raise ApiError(400, "An account with that email already exists")

    created = db.execute(
        f"INSERT INTO users (email, password_hash, full_name, role) "
        f"VALUES (%s, %s, %s, %s) RETURNING {USER_COLUMNS}",
        (email, hash_password(body["password"]), body["full_name"].strip(),
         SELF_REGISTRATION_ROLE),
    )
    return respond(201, {
        **created,
        "message": "Account created with read-only access. "
                   "An administrator can grant further permissions.",
    })


def forgot_password(event, params):
    """
    Issue a single-use reset token.

    With no mail service available the token is returned in the response. In
    production it would be emailed and never appear in an API body -- see the
    note in the README. Everything else about the flow is production-shaped:
    the token is random, stored only as a hash, expires, and can be used once.
    """
    body = validate(get_body(event), required=("email",))
    email = body["email"].strip().lower()

    user = db.query_one(
        "SELECT id, full_name FROM users WHERE lower(email) = %s AND is_active", (email,)
    )

    payload = {"message": "If that account exists, a reset token has been issued."}

    if user:
        token = generate_reset_token()
        db.execute(
            "INSERT INTO password_resets (user_id, token_hash, expires_at) "
            "VALUES (%s, %s, now() + make_interval(mins => %s))",
            (user["id"], hash_reset_token(token), RESET_TOKEN_TTL_MINUTES),
        )
        payload["reset_token"] = token
        payload["expires_in_minutes"] = RESET_TOKEN_TTL_MINUTES
        payload["delivery_note"] = (
            "No mail service is provisioned, so the token is returned here. "
            "In production it would be sent by email only."
        )

    return respond(200, payload)


def reset_password(event, params):
    """Consume a reset token and set a new password."""
    body = validate(get_body(event), required=("token", "password"))

    if len(body["password"]) < 8:
        raise ApiError(400, "Validation failed", ["Password must be at least 8 characters"])

    row = db.query_one(
        "SELECT id, user_id FROM password_resets "
        "WHERE token_hash = %s AND used_at IS NULL AND expires_at > now()",
        (hash_reset_token(body["token"]),),
    )
    if not row:
        raise ApiError(400, "This reset token is invalid, already used, or expired")

    db.execute(
        "UPDATE users SET password_hash = %s WHERE id = %s",
        (hash_password(body["password"]), row["user_id"]),
    )
    # Burn every outstanding token for this user, not just the one presented:
    # a password change should invalidate any other pending reset request.
    db.execute(
        "UPDATE password_resets SET used_at = now() "
        "WHERE user_id = %s AND used_at IS NULL",
        (row["user_id"],),
    )
    return respond(200, {"message": "Password updated. You can sign in with it now."})


# --------------------------------------------------------------------------
# User administration
# --------------------------------------------------------------------------

def list_users(event, params):
    require(event, "read")
    filters = get_query(event)

    sql = f"SELECT {USER_COLUMNS} FROM users WHERE 1 = 1"
    args = []
    if filters.get("role"):
        sql += " AND role = %s"
        args.append(filters["role"])
    if filters.get("q"):
        sql += " AND (full_name ILIKE %s OR email ILIKE %s)"
        args += [f"%{filters['q']}%"] * 2
    sql += " ORDER BY full_name"

    return respond(200, {"items": db.query(sql, tuple(args))})


def create_user(event, params):
    require(event, "manage_users")
    body = validate(get_body(event), required=("email", "password", "full_name", "role"))

    if body["role"] not in ROLES:
        raise ApiError(400, "Invalid role", [f"role must be one of {', '.join(ROLES)}"])
    if len(body["password"]) < 8:
        raise ApiError(400, "Validation failed", ["password must be at least 8 characters"])
    if db.query_one("SELECT 1 FROM users WHERE lower(email) = lower(%s)", (body["email"],)):
        raise ApiError(400, "A user with that email already exists")

    created = db.execute(
        f"INSERT INTO users (email, password_hash, full_name, role, capacity_hours, cost_rate) "
        f"VALUES (%s, %s, %s, %s, %s, %s) RETURNING {USER_COLUMNS}",
        (body["email"], hash_password(body["password"]), body["full_name"],
         body["role"], body.get("capacity_hours", 40), body.get("cost_rate")),
    )
    return respond(201, created)


def update_user(event, params):
    actor = require(event, "manage_users")
    body = get_body(event)
    user_id = params["id"]

    if not db.query_one("SELECT 1 FROM users WHERE id = %s", (user_id,)):
        raise ApiError(404, "User not found")

    # An admin demoting themselves could leave the system with no admin at all.
    if str(actor["sub"]) == user_id and body.get("role") not in (None, actor["role"]):
        raise ApiError(400, "You cannot change your own role")

    updates, args = [], []
    for field in ("email", "full_name", "capacity_hours", "cost_rate", "is_active"):
        if field in body:
            updates.append(f"{field} = %s")
            args.append(body[field])
    if "role" in body:
        if body["role"] not in ROLES:
            raise ApiError(400, "Invalid role")
        updates.append("role = %s")
        args.append(body["role"])
    if "password" in body:
        updates.append("password_hash = %s")
        args.append(hash_password(body["password"]))

    if not updates:
        raise ApiError(400, "No updatable fields supplied")

    args.append(user_id)
    updated = db.execute(
        f"UPDATE users SET {', '.join(updates)} WHERE id = %s RETURNING {USER_COLUMNS}",
        tuple(args),
    )
    return respond(200, updated)


def delete_user(event, params):
    actor = require(event, "manage_users")
    if str(actor["sub"]) == params["id"]:
        raise ApiError(400, "You cannot delete your own account")
    if not db.query_one("SELECT 1 FROM users WHERE id = %s", (params["id"],)):
        raise ApiError(404, "User not found")

    # Soft delete: projects reference users as managers, so a hard delete would
    # either cascade away real work or fail on the foreign key.
    db.execute("UPDATE users SET is_active = FALSE WHERE id = %s", (params["id"],))
    return respond(204)


# --------------------------------------------------------------------------
# Wiring
# --------------------------------------------------------------------------

router = (
    Router(SERVICE)
    .add("GET", "/health", health)
    .add("GET", "/", health)
    .add("POST", "/login", login)
    .add("POST", "/register", register)
    .add("POST", "/forgot-password", forgot_password)
    .add("POST", "/reset-password", reset_password)
    .add("POST", "/refresh", refresh)
    .add("GET", "/me", me)
    .add("GET", "/users", list_users)
    .add("POST", "/users", create_user)
    .add("PUT", "/users/{id}", update_user)
    .add("DELETE", "/users/{id}", delete_user)
)


def handler(event=None, context=None):
    return router.dispatch(event or {}, context)


if __name__ == "__main__":
    print(handler({"rawPath": "/health",
                   "requestContext": {"http": {"method": "GET"}}}))
