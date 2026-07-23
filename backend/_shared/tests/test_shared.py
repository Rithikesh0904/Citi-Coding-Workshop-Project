"""
Unit tests for the shared backend modules.

Run from inside any service directory (the shared modules are synced flat
alongside function.py, so imports resolve the same way they do in Lambda):

    cd backend/project-service
    python3 -m pytest tests/ -v
    python3 -m pytest tests/ --cov=. --cov-report=term-missing

These target the code paths a reviewer would probe: signature tampering,
expired tokens, privilege boundaries, malformed input, and the difference
between 401, 403, 404 and 405.
"""

import base64
import json
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import security                                              # noqa: E402
from http_utils import (ApiError, Router, get_body, get_path,  # noqa: E402
                        get_query, require, respond, validate)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def make_event(method="GET", path="/projects", body=None, token=None,
               query=None, base64_encoded=False):
    """Build a Lambda Function URL event."""
    event = {
        "rawPath": path,
        "requestContext": {"http": {"method": method}},
        "headers": {},
        "queryStringParameters": query,
    }
    if token:
        event["headers"]["authorization"] = f"Bearer {token}"
    if body is not None:
        raw = body if isinstance(body, str) else json.dumps(body)
        if base64_encoded:
            event["body"] = base64.b64encode(raw.encode()).decode()
            event["isBase64Encoded"] = True
        else:
            event["body"] = raw
    return event


def token_for(role="admin"):
    return security.create_token({"sub": "user-1", "email": "t@acme.com", "role": role})


# --------------------------------------------------------------------------
# Password hashing
# --------------------------------------------------------------------------

class TestPasswords:

    def test_correct_password_verifies(self):
        stored = security.hash_password("Admin@123")
        assert security.verify_password("Admin@123", stored)

    def test_wrong_password_rejected(self):
        stored = security.hash_password("Admin@123")
        assert not security.verify_password("Admin@124", stored)

    def test_same_password_produces_different_hashes(self):
        # Random salt per hash: two users with the same password must not
        # share a hash, or a single rainbow table breaks both.
        assert security.hash_password("same") != security.hash_password("same")

    def test_malformed_stored_hash_returns_false(self):
        assert not security.verify_password("anything", "not-a-valid-hash")
        assert not security.verify_password("anything", "")


# --------------------------------------------------------------------------
# JWT
# --------------------------------------------------------------------------

class TestTokens:

    def test_round_trip_preserves_claims(self):
        claims = security.decode_token(security.create_token({"sub": "u1", "role": "admin"}))
        assert claims["sub"] == "u1"
        assert claims["role"] == "admin"

    def test_tampered_payload_rejected(self):
        header, payload, signature = security.create_token({"role": "viewer"}).split(".")
        forged = security._b64url_encode(
            json.dumps({"role": "admin", "exp": int(time.time()) + 999}).encode()
        )
        with pytest.raises(security.TokenError):
            security.decode_token(f"{header}.{forged}.{signature}")

    def test_expired_token_rejected(self):
        with pytest.raises(security.TokenError):
            security.decode_token(security.create_token({"sub": "u1"}, ttl=-10))

    def test_malformed_token_rejected(self):
        for bad in ("", "abc", "a.b", "a.b.c.d"):
            with pytest.raises(security.TokenError):
                security.decode_token(bad)


# --------------------------------------------------------------------------
# Role permissions
# --------------------------------------------------------------------------

class TestPermissions:

    @pytest.mark.parametrize("role,action,allowed", [
        ("admin", "delete", True),
        ("admin", "manage_users", True),
        ("manager", "delete", True),
        ("manager", "manage_users", False),
        ("contributor", "update", True),
        ("contributor", "delete", False),
        ("viewer", "read", True),
        ("viewer", "create", False),
        ("viewer", "delete", False),
        ("nonsense-role", "read", False),
    ])
    def test_role_matrix(self, role, action, allowed):
        assert security.can(role, action) is allowed


# --------------------------------------------------------------------------
# Request parsing
# --------------------------------------------------------------------------

class TestParsing:

    @pytest.mark.parametrize("raw,expected", [
        ("/api/project-service/projects", "/projects"),
        ("/project-service/projects", "/projects"),
        ("/projects", "/projects"),
        ("/api/project-service", "/"),
    ])
    def test_service_prefix_stripped(self, raw, expected):
        # The dev proxy and the deployed Function URL disagree about whether
        # the prefix is present. Both forms must resolve identically.
        assert get_path({"rawPath": raw}, "project-service") == expected

    def test_base64_body_decoded(self):
        event = make_event("POST", body={"name": "Test"}, base64_encoded=True)
        assert get_body(event)["name"] == "Test"

    def test_missing_body_is_empty_dict(self):
        assert get_body(make_event("GET")) == {}

    def test_invalid_json_raises_400(self):
        with pytest.raises(ApiError) as exc:
            get_body(make_event("POST", body="{not json"))
        assert exc.value.status == 400

    def test_json_array_body_rejected(self):
        with pytest.raises(ApiError) as exc:
            get_body(make_event("POST", body="[1, 2, 3]"))
        assert exc.value.status == 400

    def test_missing_query_params_is_empty_dict(self):
        assert get_query(make_event("GET")) == {}


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

class TestValidation:

    def test_all_missing_fields_reported_at_once(self):
        # One round trip should surface every problem, not just the first.
        with pytest.raises(ApiError) as exc:
            validate({"name": "X"}, required=("name", "code", "start_date"))
        assert exc.value.status == 400
        assert len(exc.value.details) == 2

    def test_blank_string_counts_as_missing(self):
        with pytest.raises(ApiError):
            validate({"name": "   "}, required=("name",))

    def test_allowed_list_strips_unexpected_fields(self):
        result = validate({"name": "X", "is_admin": True}, required=("name",),
                          allowed=("name",))
        assert result == {"name": "X"}


# --------------------------------------------------------------------------
# Authentication and authorisation
# --------------------------------------------------------------------------

class TestAuthGuards:

    def test_missing_header_is_401(self):
        with pytest.raises(ApiError) as exc:
            require(make_event(), "read")
        assert exc.value.status == 401

    def test_non_bearer_header_is_401(self):
        event = make_event()
        event["headers"]["authorization"] = "Basic abc123"
        with pytest.raises(ApiError) as exc:
            require(event, "read")
        assert exc.value.status == 401

    def test_valid_token_wrong_role_is_403(self):
        # 401 and 403 must stay distinct: the frontend redirects to login on
        # 401 but shows "not permitted" on 403.
        with pytest.raises(ApiError) as exc:
            require(make_event(token=token_for("viewer")), "delete")
        assert exc.value.status == 403

    def test_valid_token_right_role_passes(self):
        assert require(make_event(token=token_for("admin")), "delete")["role"] == "admin"

    def test_header_case_insensitive(self):
        event = make_event()
        event["headers"]["Authorization"] = f"Bearer {token_for('admin')}"
        assert require(event, "read")


# --------------------------------------------------------------------------
# Router
# --------------------------------------------------------------------------

class TestRouter:

    @pytest.fixture
    def router(self):
        return (
            Router("project-service")
            .add("GET", "/projects", lambda e, p: respond(200, {"items": []}))
            .add("GET", "/projects/{id}", lambda e, p: respond(200, {"id": p["id"]}))
            .add("POST", "/projects", lambda e, p: respond(201, {"created": True}))
            .add("GET", "/boom", lambda e, p: (_ for _ in ()).throw(RuntimeError("kaboom")))
        )

    def test_static_route_matches(self, router):
        assert router.dispatch(make_event("GET", "/projects"))["statusCode"] == 200

    def test_placeholder_captured(self, router):
        response = router.dispatch(make_event("GET", "/projects/abc-123"))
        assert json.loads(response["body"])["id"] == "abc-123"

    def test_trailing_slash_tolerated(self, router):
        assert router.dispatch(make_event("GET", "/projects/"))["statusCode"] == 200

    def test_unknown_path_is_404(self, router):
        assert router.dispatch(make_event("GET", "/nope"))["statusCode"] == 404

    def test_known_path_wrong_method_is_405(self, router):
        assert router.dispatch(make_event("DELETE", "/projects"))["statusCode"] == 405

    def test_options_preflight_is_204(self, router):
        assert router.dispatch(make_event("OPTIONS", "/projects"))["statusCode"] == 204

    def test_unhandled_exception_becomes_500(self, router):
        # An unexpected error must never leak a stack trace to the client.
        response = router.dispatch(make_event("GET", "/boom"))
        assert response["statusCode"] == 500
        assert "error" in json.loads(response["body"])

    def test_cors_headers_on_every_response(self, router):
        for path in ("/projects", "/nope"):
            headers = router.dispatch(make_event("GET", path))["headers"]
            assert headers["Access-Control-Allow-Origin"] == "*"


# --------------------------------------------------------------------------
# Response serialisation
# --------------------------------------------------------------------------

class TestResponses:

    def test_decimal_and_date_serialised(self):
        from datetime import date
        from decimal import Decimal
        body = json.loads(respond(200, {
            "amount": Decimal("1234.56"),
            "due": date(2026, 3, 1),
        })["body"])
        assert body["amount"] == 1234.56
        assert body["due"] == "2026-03-01"

    def test_204_has_empty_body(self):
        assert respond(204)["body"] == ""


# --------------------------------------------------------------------------
# Registration policy and reset tokens
# --------------------------------------------------------------------------

class TestRegistrationPolicy:

    def test_self_registration_role_is_viewer(self):
        # The one property that keeps sign-up from being a privilege
        # escalation route: it can never produce anything but a viewer.
        assert security.SELF_REGISTRATION_ROLE == "viewer"
        assert not security.can(security.SELF_REGISTRATION_ROLE, "create")
        assert not security.can(security.SELF_REGISTRATION_ROLE, "delete")
        assert not security.can(security.SELF_REGISTRATION_ROLE, "manage_users")

    @pytest.mark.parametrize("email,allowed", [
        ("someone@acme.com", True),
        ("Someone@ACME.com", True),
        ("  padded@acme.com  ", True),
        ("attacker@evil.com", False),
        ("spoof@acme.com.evil.com", False),
        ("noatsign", False),
    ])
    def test_email_domain_restriction(self, email, allowed):
        assert security.email_domain_allowed(email) is allowed


class TestResetTokens:

    def test_tokens_are_unique(self):
        tokens = {security.generate_reset_token() for _ in range(100)}
        assert len(tokens) == 100

    def test_token_has_meaningful_entropy(self):
        assert len(security.generate_reset_token()) >= 32

    def test_hash_is_stable_and_distinct(self):
        token = security.generate_reset_token()
        assert security.hash_reset_token(token) == security.hash_reset_token(token)
        assert security.hash_reset_token(token) != security.hash_reset_token(
            security.generate_reset_token())

    def test_hash_does_not_leak_the_token(self):
        token = security.generate_reset_token()
        assert token not in security.hash_reset_token(token)
