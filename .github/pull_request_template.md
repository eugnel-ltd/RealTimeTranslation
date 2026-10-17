Closes #<issue>

## Plan

<Link `docs/plans/<issue>.md`, or the plan below in this body, or "Trivial: <why no plan is needed>", or "Doc-only fast lane". Spec: `docs/specs/<issue>.md` or "None". Divergences from the plan: none, or each with its commit.>

## What product behaviour changes

<One or two sentences in the owner's terms. For docs or pure refactors: "No behaviour change", and why.>

## Which test proves it

- `<path/to/test::name>`: fails on the old code with `<failure message naming the broken behaviour>`

## Checks run

- Full test suite: `<command>`, exit <code>
- Verifier report: <pass | fail>, <evidence>
- Real-world check of external integrations: <what was exercised, or "none touched">

## Checks not run

<Each check not run, and why. Write "None" only if every relevant check ran.>

## Deploy-window safety

<Migrations or configuration changes, and why the old release still works between migrate and restart. Or "No migrations or configuration changes".>

## Docs updated

<Files changed, or "None needed because ...">

## Review and autonomy

- Written by: <vendor from `vendor_run.py` (codex, grok) | Claude: design work | Claude: vendor lane exited 1>
- Reviewer: <agent and vendor; fall-back reason if not the primary>. Verdict: <APPROVE | REQUEST CHANGES>. Reviewed head: <sha>
- ACCEPTED limits: <finding, why it fails safe, follow-up issue>, or "None"
- Task type and level: `<type>` at level <n>. This PR stops at: <merge | release | nothing>
- Expenditure: <none | Expenditure decision YYYY-MM-DD>
- Human review paths touched: <none | path, owner>
