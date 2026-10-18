# RTT account data boundary

This implements the server portion of [the accepted identity contract](specs/8-identity.md). Account mode is **off by default**, and the production account baseline remains missing. No database, credential, registry entry or migration is provisioned by this source change. Proof flows and browser controls use the separate shared identity service and account integration; RTT does not copy its auth core.

## Request behavior

Existing Cloudflare Access remains the first check on every `/api/*` request. Only exact `ACCOUNTS_ENABLED=1` selects customer behavior. Any other value retains the current owner-only KV deployment. In customer mode, profiles and every paid API require a shared scoped verified session before profile/provider operations. Config, health and the separately integrated sign-in paths stay available behind Access.

The Worker sends only the one opaque `__Host-eugnel_session` cookie value to the signed shared client. Request bodies, account headers and desired scope never establish an account. Trusted configuration captures product `rtt`, environment, canonical HTTPS origin, binding and caller credential before the await. The shared response must match all three scope dimensions and contain a valid, unexpired session. The resulting principal and profile repository capture immutable account values.

Personal requests can add the optional `Eugnel-Expected-Account` consistency precondition, using `account:<canonicalId>` or literal `signed-out`. Native WebSocket GET `/api/gemini-live` uses the same URL-encoded value in `expectedAccount`. A mismatch with the verified cookie returns static `401 {"error":"ACCOUNT_CHANGED"}` before any product database/profile/provider operation. The expectation is captured before the verification await and never selects an account. Malformed/duplicate values or simultaneous header/query metadata return 400; query metadata is supported only on that WebSocket route. Existing direct clients may omit it, and disabled owner mode ignores it. The account-aware browser always sends its captured verified account and invalidates stale activity on refusal. Query strings and identities are not added to logs.

- `401`: signed out, expired or fenced. Stop current account activity and reverify before mounting a cache. An unrecognised well-shaped token cannot select an account.
- `503`: enabled configuration, shared service or product database is unavailable/invalid. No owner KV fallback or cached-account assumption is allowed.
- `400`: ambiguous/malformed session cookies or malformed input.
- `403`: Access denial or a missing/mismatched exact Origin on a customer mutation. Every customer state-changing request requires the configured Origin; normal same-origin browser fetch supplies it.

Profile IDs and JSON shapes remain `james`/`wing`. Customer names have a 256-byte UTF-8 cap; profile markdown retains the 200 KiB cap. Oversized updates return 413 before writes. Owner KV name behavior is unchanged. Customer profile responses and answers use `Cache-Control: no-store`. The answer route receives the request's account-scoped loader explicitly and cannot select the default owner loader.

## Product D1 and erasure

`worker/migrations/0001_account_profiles.sql` is for a **separate RTT product D1**, never the shared identity database. It creates two bounded profile rows per canonical account, a permanent deletion fence and caller-scoped nonce hashes. Every profile read includes the account predicate and fence in the SQL. A write is one conditional upsert: both insert and conflict-update refuse a fence inside the commit statement.

The fixed reverse service action is `POST /_internal/identity/erase`. Its distinct configured eraser caller/credential is authenticated by the shared HMAC, scope and replay implementation before accepting exactly `{accountId,jobId}`. A product sign-in caller, unsigned account header, extra desired scope or repeated nonce cannot erase. The endpoint has no browser account-ID authority and does not bypass an `/api/*` Access check.

Erasure uses one D1 batch transaction: insert the permanent fence, delete only that account's bounded profile rows, and read back the fence/zero remaining count in the same transaction. Success requires the expected result count, successful statements, bounded mutation counts and a valid receipt. Unknown results refuse acknowledgement. Fresh signed retries are idempotent; a delayed conditional write cannot resurrect content after the fence wins. Existing owner KV and every other account remain untouched.

The shared coordinator fences sessions/identity first and deletes identity only after every product eraser acknowledges. Product erasure does not remove another browser/device copy or independent provider retention. The minimal account ID/job/time fence remains indefinitely to reject stale work; canonical account IDs must never be recycled. Nonce hashes expire after five minutes and shared transport cleanup is bounded per accepted request. No plaintext session token is stored here.

## Configuration and activation facts

All fields remain optional until activation. Required customer fields are `IDENTITY_SERVICE`, `IDENTITY_CALLER_ID`, `IDENTITY_CALLER_SECRET`, `ACCOUNT_DB`, `ACCOUNT_ENVIRONMENT` (`production` or `preview`) and canonical `ACCOUNT_ORIGIN`. The eraser has separate `IDENTITY_ERASER_CALLER` / `IDENTITY_ERASER_SECRET` values; they must differ from the product caller. Configure credentials only through the normal secure environment, not a manifest, client variable, repository or command argument.

When actual bindings are known, the `ACCOUNT_DB` binding must declare `migrations_dir: worker/migrations`. Apply the additive migration to a local/preview product database first, record its actual ID and receipt, and run the reviewed two-account proof before production activation. This repository contains no invented live binding or database ID. The only routing addition makes the fixed signed internal action reach the Worker before SPA assets.

Required live facts still include reviewed shared-service pin/deployment, identity/product/quota database and migration receipts, fixed caller/eraser registry and credentials, callback/Access compatibility, provider/mail quota setup, deletion maintenance and two-account/device sign-in/sign-out/delete/retry evidence. Keep `baseline.accounts: missing` until the full flow passes; this server slice is not a completed account launch.

Rollback must preserve isolation. For an existing owner-only Access deployment, leaving account mode off retains its legacy behavior. Once Access admits customers, do not turn the flag off and expose the owner KV path to those callers. Keep enabled mode unavailable during repair, or restore and verify the owner-only Access boundary before a legacy rollback. Retain additive tables/fences and legacy data; do not assign old profiles or browser history to the first account.
