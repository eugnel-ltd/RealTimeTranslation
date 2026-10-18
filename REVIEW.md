# REVIEW.md

What the independent reviewer checks on every PR. The reviewer reads this file first, then uses the AI-SDLC review prompt (`references/review-prompt.md`). Changed by PR.

## Reviewer

- Primary: codex (its default model), read-only: no file edits, no state-changing git commands, no network writes.
- Fall-backs when the primary's quota is spent or it cannot sign in, in order: Grok Build, Antigravity CLI when it runs headless.
- Last resort: a Claude subagent in a fresh context. The PR says so, and the task type cannot merge above level 2 on that review.

Findings P0–P3, each with `file:line`, posted on the PR as a comment with `VERDICT:` and `Reviewed head: <sha>` lines. Re-reviews cover only the fix diff.

## Passes

Run all three, in order, against the PR's diff:

1. **Bugs and logic:** correctness on real inputs (empty and missing values, languages and auto-detect, interim and final results, token expiry and refresh, WebSocket proxy close codes, retries and time-outs), failure behaviour when Azure, Gemini or Typesafe is down or slow, silent failures, and whether the regression test really fails on the old code.
2. **Security:** provider keys stay Worker secrets and never reach the client bundle; every `/api/*` route keeps the Cloudflare Access check; token endpoints return short-lived tokens only; untrusted input in prompts and KV profile writes; new dependencies.
3. **Compliance:** the diff against the issue, `docs/code-standards.md`, `docs/owner-decisions.md` when it exists and `docs/north-star.md`. A diff that spends money without an `Expenditure:` decision fails this pass.

## Severity

- **Important** (blocks): P0 data loss, security hole, outage or irreversible damage; P1 wrong behaviour on a real path, or an acceptance criterion fails; P2 edge-case bug, weak or missing test, undisclosed unrun check, missing docs.
- **Nit** (never blocks): P3. Report at most **5** per review; drop the rest.
- **Pre-existing** (never blocks): a fault the base already has, on a path this PR does not change, whatever its severity. A fault the PR newly exposes is its own finding. It becomes a follow-up intent.

## What failure looks like

- Keys: a provider key in the browser, or an `/api/*` route that answers without Access.
- Cost: a route that calls a paid model in a loop or without a limit; a `wrangler.jsonc` change that adds a binding, cron or paid product without the cost guard.
- Speech: it builds but recognition or translation stops, or the transcript loses text.
- Docs: it lies.

## Exclusions

Do not review:

- generated files and lockfiles: `client/dist/`, `package-lock.json`, `client/package-lock.json`.

AI-SDLC `scripts/repo_ci.sh` has an RTT cloud CI case that runs `npm test` and the build. The reviewer checks that the report names the current head and that the PR supplies relevant typecheck, lint and Python desktop results, which the current case omits. See `docs/code-standards.md` for coverage and `docs/autonomy-ledger.md` for the separate release enforcement status.

## Doc-only fast lane

A diff takes the doc-only fast lane when it changes nothing that runs, is copied, or is read as an instruction. In: `README.md`, `LESSONS.md`, `docs/solutions/`, and prose under `docs/` that no agent or tool acts on. Out, always the full lane: `AGENTS.md`, `CLAUDE.md`, `REVIEW.md`, `docs/owner-decisions.md`, `docs/code-standards.md`, `docs/autonomy-ledger.md`, `docs/north-star.md`, `docs/plans/TEMPLATE.md`, `product.yaml`, skills, prompts, agent definitions, hooks, workflows, scripts, templates of any kind, configuration, code and tests. The lane gets the compliance pass and the writing check (`modules/writing.md`). No regression test is required.

## Human review required

Paths that get the full review lane and extra care. A PR that touches them merges at its type's level and the digest names it; it does not wait for the owner (AI-SDLC `modules/autonomy.md`).

- `docs/owner-decisions.md`: the owner (append-only; CI checks it). The owner's first entry creates it.

## Separation of duties

- The agent that wrote the change never reviews or approves it.
- A security fix is never approved by the agent that wrote it.

## Feedback

A kind of finding seen on two PRs becomes a `LESSONS.md` entry. A promoted lesson that a machine can check becomes a hook, lint or CI check, not another review pass.
