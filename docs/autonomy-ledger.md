# Autonomy ledger

How far each task type runs by itself. The orchestrator reads this before every step. At the level's limit it holds and reports the hold. What needs the owner: `modules/autonomy.md`. The weekly audit proposes movements from evidence; the owner may set any level at any time. See the AI-SDLC skill, `modules/autonomy.md`.

Levels: 0 Propose · 1 Draft (open the PR) · 2 Merge · 3 Release (deploy, production and store submissions included, verify, roll back) · 4 Initiate (start work from the north star or a monitor).

Enforcement status: `not yet green` (cloud CI is available through AI-SDLC `scripts/repo_ci.sh` for this repo; the complete PR-check, reviewed-merge and release-evidence chain has not yet been demonstrated. See `docs/code-standards.md`, Enforcement in this repo). Levels 3 and 4 need green.

| Task type | Level | Clean streak | Last change | Evidence |
|---|---|---|---|---|
| docs | 2 | 0 | 2026-10-17 | adoption |
| config | 2 | 0 | 2026-10-17 | adoption |
| bug-fix | 2 | 0 | 2026-10-17 | adoption |
| refactor | 2 | 0 | 2026-10-17 | adoption |
| feature | 2 | 0 | 2026-10-17 | adoption |
| schema-migration | 2 | 0 | 2026-10-17 | adoption |
| infra-pipeline | 2 | 0 | 2026-10-17 | adoption |
| dependency | 2 | 0 | 2026-10-17 | adoption |
| release | 3 | 0 | 2026-10-17 | adoption |
| payments-wiring | 2 | 0 | 2026-10-17 | adoption |
| marketing-publish | 2 | 0 | 2026-10-17 | adoption |
| skill-change | 2 | 0 | 2026-10-17 | adoption |
| support | 2 | 0 | 2026-10-17 | adoption |
| baseline | 2 | 0 | 2026-10-17 | adoption |
| absorb | 2 | 0 | 2026-10-17 | adoption |
| expenditure | 0 | n/a | fixed | the owner approves every spend |

## Owner settings

Entries the owner made by hand, newest first. The audit never undoes one.

- `2026-10-17` (company default, every adopted eugnel-ltd repo): agents act fully autonomously, production included. Only expenditure needs the owner. A level limit is a hold, not an ask. `expenditure` stays at 0. Why: "yes only expenditure needs me" and "I need fully autonomous" (James, 17 Oct 2026, relayed by Grok Bot). The rule: `modules/autonomy.md`.
- `2026-10-16` (company default): `release` starts at level 3 (deploy, verify, roll back; store submissions included); it acts once the enforcement status above is green, and stays at level 2 until then. Why: "yes set to lv3" (James, 16 Oct 2026, answering "你想 agent 連 release 都自己做嘅話，同我講一聲，我就將佢改做 level 3"). Recorded in eugnel-hq `company/decisions.md`, "2026-10-16: Release at level 3".
- `2026-10-16` (company default, every adopted eugnel-ltd repo): all types except `release` and `expenditure` start at level 2 and `expenditure` at 0 (`release` was then at 1; the entry above raises it to 3). Why: "ks2-spelling 嘅 ledger 跟 ai-sdlc，除咗 release 同 expenditure，全部 level 2 ... can we default this please." (James, 16 Oct 2026). Recorded in eugnel-hq `company/decisions.md`, "2026-10-16: Default autonomy". A narrower entry for this repo, in the owner's words, wins over this default.

## Movement log

One line per movement, newest first, written by the weekly audit with its evidence.

- `YYYY-MM-DD`: <type> <from> → <to>. <streak of 5 | revert #n | hot-fix #n | incident #n>.
