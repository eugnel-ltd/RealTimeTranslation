# Plan: #<issue> <title>

Copy to `docs/plans/<issue>.md`, or paste into the PR body. Write it in plan mode, before any implementation. Implement nothing until the plan is accepted. When the implementation diverges, update this plan in the same commit and log it under Divergences.

- Intent: #<issue>
- Spec: `docs/specs/<issue>.md`, or "None: not a larger feature"
- Task type and level: `<type>` at level <n> (`docs/autonomy-ledger.md`); the loop stops at <merge | release | nothing>
- Accepted by: <"independent review <link>" for risky work; otherwise "orchestrator: not risky work">

## Files that change

- `<path>`: <what changes and why>

## Order of work

1. <step; each step leaves the suite green>

## Risks

- <risk>: <how it fails safe, or how we detect and roll back>

## Proof

- Regression test: `<path::name>` fails on the old code with `<message naming the broken behaviour>`
- Checks: `<command>`, healthy output `<what a pass looks like>`
- Acceptance from the issue, each mapped to the check that proves it
- Verifier: <what the verifier runs in a fresh context>

## Divergences

- <YYYY-MM-DD, commit>: <what changed from the plan, and why>
