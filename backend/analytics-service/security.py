"""
Authentication primitives: JWT signing and password hashing.

Deliberately uses the Python standard library only. The Lambda packaging step
installs requirements.txt, but adding dependencies is the single most common
cause of a deploy that works locally and fails in the cloud. HMAC-SHA256 and
PBKDF2 are both in the stdlib and are the same primitives PyJWT and bcrypt-style
hashers use underneath, so we lose nothing but the dependency risk.

Trade-off documented in README: a production system would use bcrypt or argon2
for their memory-hardness. PBKDF2 with a high iteration count is the strongest
option available without adding a dependency.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time

# No JWT_SECRET is injected by the infrastructure, so the key is derived from
# values that are already per-deployment secrets: the database password
# (generated per participant by Terraform) and the app id. Deriving beats a
# hardcoded constant, which would be published with this repository and would
# let anyone forge a token for the deployed environment.
_SECRET_SOURCE = os.getenv("JWT_SECRET") or (
    os.getenv("POSTGRES_PASS", "") + os.getenv("APP_ID", "")
)
JWT_SECRET = hashlib.sha256(
    (_SECRET_SOURCE or "local-development-only").encode()
).hexdigest()
ACCESS_TOKEN_TTL = int(os.getenv("ACCESS_TOKEN_TTL", "3600"))       # 1 hour
REFRESH_TOKEN_TTL = int(os.getenv("REFRESH_TOKEN_TTL", "86400"))    # 24 hours

PBKDF2_ITERATIONS = 120_000

ROLES = ("admin", "manager", "contributor", "viewer")

# Role -> permitted actions. Centralised so a permission change is one edit.
PERMISSIONS = {
    "admin":       {"read", "create", "update", "delete", "manage_users"},
    "manager":     {"read", "create", "update", "delete"},
    "contributor": {"read", "create", "update"},
    "viewer":      {"read"},
}


# --------------------------------------------------------------------------
# Password hashing
# --------------------------------------------------------------------------

def hash_password(password: str) -> str:
    """Return a self-describing hash: pbkdf2_sha256$iterations$salt$hash."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time verification against a stored hash."""
    try:
        algorithm, iterations, salt, expected = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, AttributeError):
        return False


# --------------------------------------------------------------------------
# JWT (HS256)
# --------------------------------------------------------------------------

def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _b64url_decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def create_token(payload: dict, ttl: int = ACCESS_TOKEN_TTL) -> str:
    """Sign a JWT with HS256."""
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    body = {**payload, "iat": now, "exp": now + ttl}

    signing_input = ".".join([
        _b64url_encode(json.dumps(header, separators=(",", ":")).encode()),
        _b64url_encode(json.dumps(body, separators=(",", ":")).encode()),
    ])
    signature = hmac.new(
        JWT_SECRET.encode(), signing_input.encode(), hashlib.sha256
    ).digest()
    return f"{signing_input}.{_b64url_encode(signature)}"


class TokenError(Exception):
    """Raised when a token is malformed, tampered with, or expired."""


def decode_token(token: str) -> dict:
    """Verify signature and expiry, then return the claims."""
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except (ValueError, AttributeError):
        raise TokenError("Malformed token")

    signing_input = f"{header_b64}.{payload_b64}"
    expected = hmac.new(
        JWT_SECRET.encode(), signing_input.encode(), hashlib.sha256
    ).digest()

    # A malformed segment raises binascii.Error, which is not a TokenError and
    # would escape the caller's guard as an unhandled 500.
    try:
        signature = _b64url_decode(signature_b64)
    except Exception:
        raise TokenError("Malformed token")

    # Constant-time comparison prevents timing attacks on the signature.
    if not hmac.compare_digest(expected, signature):
        raise TokenError("Invalid signature")

    # Parsed only after the signature verifies, so an unverified payload is
    # never interpreted.
    try:
        claims = json.loads(_b64url_decode(payload_b64))
    except Exception:
        raise TokenError("Malformed token")

    if not isinstance(claims, dict):
        raise TokenError("Malformed token")
    if claims.get("exp", 0) < int(time.time()):
        raise TokenError("Token expired")
    return claims


# --------------------------------------------------------------------------
# Authorisation
# --------------------------------------------------------------------------

def can(role: str, action: str) -> bool:
    """Check whether a role may perform an action."""
    return action in PERMISSIONS.get(role, set())


# --------------------------------------------------------------------------
# Password reset tokens
# --------------------------------------------------------------------------

RESET_TOKEN_TTL_MINUTES = 15

# Self-registration may only ever create this role. An admin promotes from
# here; the registration endpoint never reads a role from the request.
SELF_REGISTRATION_ROLE = "viewer"

# Registration is limited to company addresses. This console exposes budgets,
# cost rates and staffing, so open sign-up would publish them.
ALLOWED_EMAIL_DOMAINS = ("acme.com",)


def generate_reset_token() -> str:
    """A URL-safe token with 256 bits of entropy from the system CSPRNG."""
    return secrets.token_urlsafe(32)


def hash_reset_token(token: str) -> str:
    """
    Hash a reset token for storage.

    Plain SHA-256 rather than PBKDF2: stretching defends low-entropy human
    passwords against brute force. A 256-bit random token cannot be brute
    forced, so the iteration cost would buy nothing.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def email_domain_allowed(email: str) -> bool:
    return any(email.lower().strip().endswith("@" + d) for d in ALLOWED_EMAIL_DOMAINS)
