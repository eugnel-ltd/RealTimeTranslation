---
name: Intent
about: What is wanted and how we will know it is done. The issue is the intent and its single source of truth.
title: ""
labels: intent
---

## Problem

<What is wrong or missing, in the owner's own words (quote them). Include the evidence: current behaviour, logs, links.>

## Outcome

<What is true when this is done, in the owner's terms.>

## Task type and revenue impact

- Task type: `<docs | config | bug-fix | refactor | feature | schema-migration | infra-pipeline | dependency | release | payments-wiring | marketing-publish | skill-change | support | baseline | absorb | expenditure>` (see `docs/autonomy-ledger.md`)
- Source: `<owner | support | gap | absorb>`, with the link or quote it came from (skill `modules/intake.md`)
- Revenue impact: `<direct | enabling | none | negative>`, and the north-star line it serves.
- Expenditure: `<none | what it costs, and the Expenditure decision that approves it>`

## Affected users and systems

<Who notices the change, and which services, data and integrations it touches.>

## Constraints

<Deadlines, budgets, owner decisions that apply, compatibility, performance or compliance limits.>

## Open questions

<Each question, and who answers it. Write "None" only if true. Answer or explicitly defer each before work starts. The agent looks up facts and settles decisions (the wayfinder map for an idea); only a spend goes to the owner (`modules/autonomy.md`).>

## Acceptance

<Observable checks someone else could run. Measure where possible: "p95 under 300 ms on /search", not "faster".>

- [ ] <check>

<Owner taste remark ("this is too ugly", "feels slow"): quote it, then turn it into checks someone else can run. If two readings lead to different checks, take the one closer to his words and the north star, and put the other under Open questions. Example: "the pricing page looks cheap" (owner, 3 Nov) becomes "- [ ] body text is 16 px or larger at 375 px width", "- [ ] one accent colour, from the brand tokens", "- [ ] screenshots at 375 px and 1280 px are in the PR, and the reviewer checks them against the two checks above".>

## Size

<Trivial (no plan) | Non-trivial (plan) | Larger feature (spec, then plan). Say why. Risky work (migration, data deletion, auth, secrets, irreversible external effect, human-review paths) has its plan approved by the reviewer first.>
