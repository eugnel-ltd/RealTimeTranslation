# Preserve the initiating deletion cache across verification hints

Intent: existing RTT #8. Base: combined consumer `daf22665ed5a4bbc80247d58efb440fe0384b21f`. This is a bounded browser correctness repair, with no server, shared identity, dependency, visual, deployment or expenditure change.

## Reproduced failure

Independent real Chromium proof at approved browser `22028bf` starts deletion for verified account A, dispatches focus while its response is pending, then receives the successful pending job and advances that same job to completion. Focus increments the verification generation while the personal application correctly remains quarantined. `deleteAccount` consequently discards its captured storage/job association; completion leaves all three A cache keys and incorrectly reports a reload limitation although no reload occurred. Original evidence remains in `/workspace/work/account-policy-independent/deletion-focus.{mjs,json,log}`.

## Bounded correction

Keep the initiating verified immutable storage scope, expected account and trusted product/environment/origin scope as a memory-only candidate when our own delete request returns a validated pending receipt. A benign verification generation change alone must not destroy that continuation. The candidate is not account authority, cannot mount an App, and cannot update identity or private presentation from a stale response.

All existing control quarantine remains: no personal runtime before our response fully settles, followed by fresh server bootstrap. Discard the candidate if that fresh bootstrap verifies another account, another scope or disabled owner mode. Explicit signout also discards it. An unavailable bootstrap cannot erase anything. A different deletion job cannot erase anything. Remove only the initiating scope's three known cache keys after a fresh server status confirms that exact job completed; preserve other accounts, legacy keys, unrelated keys and all pending/failed deletion data. A new browser manager after actual reload has no candidate and retains the truthful existing limitation.

## Proof before source

Add one new typed regression file. Execute the actual AccountBrowser and real immutable storage implementation with synthetic localStorage and deferred same-origin fetch responses. Capture semantic old-source failures for focus/storage-hint during pending delete, then matching-job completion removing exactly A's three known keys. Preserve controls for unfinished deletion, account/scope change, wrong-job completion, malformed or failed initiating response, unavailable verification and reload without a candidate. Existing stale A-to-B/control barrier and all prior frozen tests remain unchanged.

Run typecheck, lint, trusted candidate-tree secret scan and the test harness before freezing the new file; inspect assertion failures rather than accepting a nonzero import/harness error. Commit the first-red tests before the narrow source correction. Use one bounded vendor test handoff (at most30seconds), then direct fallback if it exits1 without changes.

## Final acceptance

Run the new and existing account suites, full tests/typecheck/lint/build and relevant Python checks on the exact head, plus trusted secret/frozen-test/diff checks. Preserve generated CSS bytes. The independent transcription reviewer reruns its original real-browser focus proof and A-to-B safety checks; root independently reviews the final diff. No GitHub writes, provider calls, real user storage, resource/configuration activation or self-approval.
