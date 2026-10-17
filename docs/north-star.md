# North star

Why this repo exists and how it earns. Drafted by the orchestrator from the owner's words; the owner edits at will. Quote the owner; mark a paraphrase as "Paraphrased:". See the AI-SDLC skill, `modules/north-star.md`.

## Goal

"rtt, should add too." (James, 17 Oct 2026, adding this repo to the company AI-SDLC.) Paraphrased (the owner's plan for eugnel.com, 17 Oct 2026): real-time speech translation becomes an upcoming EUGNEL translation service.

## Who pays, for what

Nobody yet. The app runs for the owner only, behind Cloudflare Access. Who pays and how is an open owner decision.

## Channels

- Web: rtt.eugnel.com on Cloudflare Workers (Worker `rtt`): live for the owner only.
- The Python desktop app (`translator_app.py`): local use only.

## Priorities, in order

1. Keep the live app working and its keys server-side (Worker secrets, never the browser bundle).
2. The owner's decision on the paid service: customers, price, and the baseline it needs (accounts, legal, support).
3. Everything else.

## Non-goals

- API keys in the client bundle (`scripts/verify-bundle.mjs` checks the build).

## Measures

- Provider spend per session (Azure Speech, Gemini, Anthropic) against the company break-even view.

## Marketing

None until the owner decides on the paid service.

## History

- `2026-10-17`: first draft at AI-SDLC adoption.
