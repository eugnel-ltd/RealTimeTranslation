-- Additive, separate RTT customer D1 only. Never apply this to identity D1 or owner KV.
CREATE TABLE IF NOT EXISTS account_profiles (
  account_id TEXT NOT NULL,
  profile_id TEXT NOT NULL CHECK(profile_id IN ('james', 'wing')),
  name TEXT NOT NULL CHECK(length(CAST(name AS BLOB)) <= 256),
  markdown TEXT NOT NULL CHECK(length(CAST(markdown AS BLOB)) <= 204800),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(account_id, profile_id)
);

-- Permanent security receipt: stale requests cannot recreate erased account data.
CREATE TABLE IF NOT EXISTS account_profile_fences (
  account_id TEXT PRIMARY KEY,
  deletion_job TEXT NOT NULL,
  fenced_at TEXT NOT NULL
);

-- Caller-scoped hashes only; the shared transport authenticates reverse erasure.
CREATE TABLE IF NOT EXISTS auth_service_nonces (
  caller_id TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(caller_id, nonce_hash)
);
CREATE INDEX IF NOT EXISTS auth_service_nonce_expiry ON auth_service_nonces(expires_at);
