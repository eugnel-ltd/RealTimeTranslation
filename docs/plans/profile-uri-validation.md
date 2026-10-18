# Reject malformed profile path encoding

Owner-authorised focused follow-up from the nonvisual sweep. GitHub intent creation was attempted once at 2026-10-18 08:56:46 UTC but returned a secondary content-creation limit (403); publish/link the preserved intent after cooldown. No issue was created. This must not be represented as a completed external write.

## Problem and scope

Authenticated GET/PUT `/api/profiles/%FF` calls `decodeURIComponent` outside a client-input boundary. A URIError becomes a 500 and a synthetic server-error report despite requiring no KV or provider operation. Reproduced locally on main `049ade09791ef8a92d885d315f17506d2b6130b4`; never sent to production. Change only the profile ID decode boundary in `worker/src/index.ts`, plus a new focused regression file. Preserve Access, rate limits, normal encoded IDs, unsupported-ID behavior, existing tests and all visual design.

## Delivery and proof

Commit this plan, then correctly typed behavior regressions before implementation. Tests exercise the actual Worker with locally signed Access JWTs and a fake JWKS transport: malformed GET and PUT paths return static 400; missing Access remains 403; no profile binding operation, provider request or Sentry envelope occurs. Valid percent-encoded supported IDs still resolve, and unsupported decoded IDs remain 404. Run regressions red against unchanged source, typecheck before the first-red commit, then catch only the bounded decode failure as InvalidRequestError without altering frozen tests. Run all runtime tests, typecheck, lint and build after repair. Root provides independent exact-head review and merge; no deployment.

The sweep's prior vendor test/implementation attempts exited 1 without usable changes; the root explicitly authorised reusing that recorded failure and direct-session continuation for this bounded sweep. The Grok support handoff also exited 1 immediately on 2026-10-18 because GROKBOT_WEBHOOK_URL is unset. No further vendor timeout is needed. Expenditure: none. No service/configuration change, paid provider call, data migration or production diagnostic endpoint.

## Separate live acceptance

Do not retain this input-validation bug to produce Sentry evidence. Issues #10/#11 still require actual authorised live acceptance after service/network bindings exist. A local envelope capture with a fake DSN proves behavior only and cannot complete those baselines.
