"""
HTTP plumbing for AWS Lambda Function URLs.

The workshop scaffold gives us a raw `handler(event, context)` with no web
framework, so this module supplies the small amount of routing and response
shaping we need. Roughly 150 lines replaces a framework we cannot install.

CORS headers are set on every response, including errors. In the cloud the
browser calls the Lambda Function URL directly rather than through CloudFront,
so without these the frontend cannot talk to the backend at all.
"""

import base64
import json
import logging
import re
import uuid
from datetime import date, datetime
from decimal import Decimal

from security import TokenError, can, decode_token

logger = logging.getLogger()
logger.setLevel(logging.INFO)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
}


class ApiError(Exception):
    """An error with an intended HTTP status code."""

    def __init__(self, status, message, details=None):
        self.status = status
        self.message = message
        self.details = details
        super().__init__(message)


def _json_default(value):
    """Make Decimal, date, datetime and UUID JSON-serialisable."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return str(value)


def respond(status: int, body=None):
    """Build a Lambda Function URL response with CORS headers."""
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": "" if body is None else json.dumps(body, default=_json_default),
    }


def error(status: int, message: str, details=None):
    """Every failure returns the same shape, so the frontend has one code path."""
    payload = {"error": message}
    if details:
        payload["details"] = details
    return respond(status, payload)


# --------------------------------------------------------------------------
# Request parsing
# --------------------------------------------------------------------------

def get_method(event) -> str:
    return (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "GET"
    ).upper()


def get_path(event, service_name: str) -> str:
    """
    Return the path with the service prefix removed.

    The dev proxy and the deployed Function URL may or may not include
    `/api/<service-name>`. Stripping both forms means the same code works in
    local and cloud without a conditional.
    """
    raw = event.get("rawPath") or event.get("path") or "/"
    for prefix in (f"/api/{service_name}", f"/{service_name}"):
        if raw.startswith(prefix):
            raw = raw[len(prefix):]
            break
    return raw if raw.startswith("/") else "/" + raw


def get_body(event) -> dict:
    """Parse the JSON body, handling base64 encoding."""
    raw = event.get("body")
    if not raw:
        return {}
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise ApiError(400, "Request body is not valid JSON")
    if not isinstance(parsed, dict):
        raise ApiError(400, "Request body must be a JSON object")
    return parsed


def get_query(event) -> dict:
    return event.get("queryStringParameters") or {}


# --------------------------------------------------------------------------
# Authentication and authorisation
# --------------------------------------------------------------------------

def get_current_user(event) -> dict:
    """Decode the bearer token. Raises 401 if missing or invalid."""
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    auth_header = headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise ApiError(401, "Authentication required")
    try:
        return decode_token(auth_header[7:].strip())
    except TokenError as exc:
        raise ApiError(401, str(exc))


def require(event, action: str) -> dict:
    """
    Authenticate, then authorise. Returns the user claims.

    401 means "we do not know who you are"; 403 means "we know, and you may
    not". Keeping them distinct lets the frontend redirect to login only when
    it should.
    """
    user = get_current_user(event)
    if not can(user.get("role", "viewer"), action):
        raise ApiError(403, f"Role '{user.get('role')}' cannot perform '{action}'")
    return user


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def validate(body: dict, required=(), allowed=None) -> dict:
    """
    Check required fields are present and non-empty.

    Collects every problem before raising, so a form gets all its errors back
    in one response instead of one per round trip.
    """
    problems = []
    for field in required:
        value = body.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            problems.append(f"'{field}' is required")
    if problems:
        raise ApiError(400, "Validation failed", problems)
    if allowed:
        return {k: v for k, v in body.items() if k in allowed}
    return body


# --------------------------------------------------------------------------
# Router
# --------------------------------------------------------------------------

class Router:
    """Minimal path router supporting {placeholder} segments."""

    def __init__(self, service_name):
        self.service_name = service_name
        self.routes = []

    def add(self, method, pattern, handler):
        regex = "^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern) + "/?$"
        self.routes.append((method.upper(), re.compile(regex), handler))
        return self

    def dispatch(self, event, context=None):
        method = get_method(event)
        path = get_path(event, self.service_name)

        # Browsers send a preflight OPTIONS before any cross-origin request.
        if method == "OPTIONS":
            return respond(204)

        matched_path = False
        for route_method, regex, handler in self.routes:
            match = regex.match(path)
            if not match:
                continue
            matched_path = True
            if route_method != method:
                continue
            try:
                return handler(event, match.groupdict())
            except ApiError as exc:
                logger.info("Client error %s on %s %s: %s",
                            exc.status, method, path, exc.message)
                return error(exc.status, exc.message, exc.details)
            except Exception as exc:
                logger.exception("Unhandled error on %s %s", method, path)
                return error(500, "Internal server error", str(exc))

        if matched_path:
            return error(405, f"Method {method} not allowed on {path}")
        return error(404, f"No route for {method} {path}")