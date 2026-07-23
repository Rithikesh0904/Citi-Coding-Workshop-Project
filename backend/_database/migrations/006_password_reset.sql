-- Password reset tokens.
--
-- Tokens are stored hashed, never in plaintext: a leaked database must not
-- hand an attacker the ability to reset every account. SHA-256 is sufficient
-- here without PBKDF2 stretching, because the token carries 256 bits of
-- entropy from a CSPRNG -- stretching exists to defend low-entropy human
-- passwords against brute force, which does not apply to a random token.
--
-- Apply after 005_project_closure.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS password_resets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The lookup path is always "find an unused, unexpired token by its hash".
CREATE INDEX IF NOT EXISTS idx_password_resets_token
    ON password_resets (token_hash) WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_password_resets_user
    ON password_resets (user_id);

-- Audit the table like every other write path. The trigger function already
-- strips password_hash; token_hash is recorded because knowing that a reset
-- was requested is useful, and the hash alone cannot be used to reset.
DROP TRIGGER IF EXISTS audit_password_resets ON password_resets;
CREATE TRIGGER audit_password_resets
    AFTER INSERT OR UPDATE OR DELETE ON password_resets
    FOR EACH ROW EXECUTE FUNCTION write_audit_log();

COMMIT;

-- Verification
--   SELECT count(*) FROM password_resets WHERE used_at IS NULL AND expires_at > now();
