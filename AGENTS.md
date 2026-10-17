# AGENTS.md

AI-SDLC: v3 (2026-10-17)

Routing table only. Each row names the document that governs an area. Rules live in those documents, never here. Read `LESSONS.md` and `docs/autonomy-ledger.md` before every task; read the rest when a row sends you there.

| Area | Governing doc |
|---|---|
| Delivery loop: intent, plan, PR, review, merge, deploy, report | AI-SDLC skill, `SKILL.md` |
| Who writes the code and does the research: hand off to codex or Grok first (`vendor_run.py`) | AI-SDLC skill, `modules/vendors.md` |
| How far each task type runs without the owner | `docs/autonomy-ledger.md` |
| Why this repo exists and how it earns | `docs/north-star.md` |
| What the product is, where it is live, its price and baseline | `product.yaml` (skill `modules/baseline.md`) |
| Decisions PRs must not reverse; approved expenditure | `docs/owner-decisions.md` |
| Commands: test, lint, deploy, rollback, health | `docs/code-standards.md` (Commands) |
| Repo-specific hard rules and acceptance criteria | `docs/code-standards.md` |
| Lessons from recent mistakes | `LESSONS.md`; older ones in `docs/solutions/` |
| What the reviewer checks; reviewer and fall-backs | `REVIEW.md` |
| Intent (issue) fields | `.github/ISSUE_TEMPLATE/intent.md` |
| PR body | `.github/pull_request_template.md` |
| Plans and specs | `docs/plans/`, `docs/specs/` |
| Hooks and checks | `.claude/settings.json`; company checks pending (a public repo cannot call the private skill's workflows, and ai-sdlc `scripts/repo_ci.sh` has no entry for this repo yet) |
| Worker API, secrets, Cloudflare Access, deploy (`worker/`, `wrangler.jsonc`) | `DEPLOY.md` |
| Web client (`client/`), shared logic (`shared/`) | `readme.md`, `client/README.md` |
| Python desktop app (`translator_app.py`) | `readme.md` |
