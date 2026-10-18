# LESSONS.md

Short live log of repeatable mistakes. Read it before every task. At most fifteen entries; older ones live in `docs/solutions/`, searched when a task touches their area.

- Add an entry as soon as a review finding, revert, follow-up fix, failed CI run, rework or incident shows a repeatable mistake. Add one at once when an agent makes the same mistake twice.
- The nightly audit bumps `Seen` (one count per day), merges duplicates, deletes obsolete entries and moves overflow to `docs/solutions/`.
- A lesson seen on three different days moves by PR into `docs/code-standards.md` as a hard rule and leaves this file.

Entry format (newest first):

```markdown
### <one-line rule, imperative>
- Cause: <what went wrong and why>
- Fix: <commit sha or PR #>
- Done right: <what the correct approach looks like>
- Seen: 1× (YYYY-MM-DD)
```

## Entries

### Verify the intended failure before freezing a regression
- Cause: a legal-history UI test followed an undefined child back to its root. Its red run failed with a stack overflow, not the expected missing save-error message.
- Fix: RTT #9 uses a fresh test-first branch, keeps the failed artifact, and adds only the missing null-child guard before locking the same assertions.
- Done right: read the full red failure, confirm the assertion names the target behaviour, and check the harness before the test commit. A nonzero exit alone is not proof.
- Seen: 1× (2026-10-18)

### Verify automation ownership before managing issues
- Cause: uptime incident matching trusted a public title and marker, allowing a human issue to suppress an outage incident and be closed on recovery.
- Fix: issue #35 requires the expected GitHub Actions login and Bot type before deduplication, comments or closure.
- Done right: treat title/body markers as identifiers only after verified REST author metadata establishes ownership; test humans, missing authors and mixed lists.
- Seen: 1× (2026-10-18)

### Refresh verification commands after syncing main
- Cause: issue #18 used the earlier command list after #15 added test typechecking, so runtime-green mock tests still contained a TypeScript error.
- Fix: issue #18 replacement branch preserves the original history, locks correctly typed tests before applying the unchanged source repair, and passes all four checks.
- Done right: reread docs/code-standards.md after integration and run test, typecheck, lint and build on the actual integrated source before reporting readiness.
- Seen: 1× (2026-10-18)

### Resume a completed worker with followup_task
- Cause: sending a message to a completed worker did not start a new turn, delaying API verification.
- Fix: issue #13 delivery coordination.
- Done right: use `followup_task` for completed workers; use `send_message` only while the worker is running.
- Seen: 1× (2026-10-18)

### Keep failure callbacks owned by the operation that failed
- Cause: a scheduled Gemini recycle rejected after its microphone wait completed; its unguarded catch reported an old error into a newer live session.
- Fix: issue #13; the recycle catch checks the failed start's disposal generation and that no replacement session is active.
- Done right: test both a failed recycle superseded by a successful start and a current recycle failure that still reports once.
- Seen: 1× (2026-10-18)
