"""
PostgreSQL access for Lambda.

Follows the connection-reuse pattern from the workshop's example service: a
module-level connection persists across warm invocations and is reset to None
on failure so the next invocation reconnects.

All queries are parameterised. There is no string interpolation into SQL
anywhere in this codebase.
"""

import logging
import os

import psycopg
from psycopg.rows import dict_row

logger = logging.getLogger()

IS_LOCAL = os.getenv("IS_LOCAL", "false") == "true"

# Aurora requires SSL; local PostgreSQL does not. Branching on IS_LOCAL is the
# documented pattern from the workshop guide.
_SSL = "" if IS_LOCAL else "sslmode=require "

CONNINFO = (
    f"host={os.getenv('POSTGRES_HOST', 'localhost')} "
    f"port={os.getenv('POSTGRES_PORT', '5432')} "
    f"user={os.getenv('POSTGRES_USER') or 'test'} "
    f"password={os.getenv('POSTGRES_PASS') or 'test'} "
    f"dbname={os.getenv('POSTGRES_NAME') or 'test'} "
    f"{_SSL}"
    f"connect_timeout=30"
)

CONNECTION = None


def get_connection():
    """Return a live connection, reconnecting if the pooled one is closed."""
    global CONNECTION
    if CONNECTION is None or CONNECTION.closed:
        CONNECTION = psycopg.connect(CONNINFO, row_factory=dict_row, autocommit=True)
    return CONNECTION


def query(sql: str, params: tuple = ()) -> list:
    """Run a SELECT and return a list of dicts."""
    try:
        with get_connection().cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()
    except Exception:
        _reset()
        raise


def query_one(sql: str, params: tuple = ()):
    """Run a SELECT and return the first row, or None."""
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: tuple = ()):
    """Run an INSERT/UPDATE/DELETE. Returns the RETURNING row when present."""
    try:
        with get_connection().cursor() as cur:
            cur.execute(sql, params)
            if cur.description:
                return cur.fetchone()
            return {"rowcount": cur.rowcount}
    except Exception:
        _reset()
        raise


def _reset():
    """Drop the pooled connection so the next call reconnects cleanly."""
    global CONNECTION
    logger.warning("Resetting PostgreSQL connection after failure")
    try:
        if CONNECTION and not CONNECTION.closed:
            CONNECTION.close()
    except Exception:
        pass
    CONNECTION = None