# RTT server observability

Server reporting and the authenticated uptime workflow are prepared. `baseline.observability` remains `missing` until live evidence below exists. This source change provisions no external service. Operator evidence below records the Access setup separately; Sentry and live end-to-end checks remain pending.

RTT reuses `eugnel-platform/telemetry`, pinned to commit `d50993325b0d094ea8b79d30dc75696ea387ec28`. The narrow `yaml:2.8.3` override fixes the shared package's CLI dependency advisory; the Worker does not import its YAML CLI. There is no browser Sentry SDK, new analytics binding, Cloudflare cron or paid monitoring service.

## What can leave the Worker

With `SENTRY_DSN` configured, one bounded background report records a returned HTTP 5xx, caught server failure or non-cancelled answer-stream failure. Access refusals, 4xx, expected quota refusals and cancellation do not produce reports.

The shared Sentry envelope receives only:

- A generated event ID and timestamps, platform and fixed severity.
- Release `rtt@<package version>`, optionally followed by a configured 40-character `DEPLOYMENT_SHA`.
- Fixed error name/message and allow-listed route, status and `http`/`stream` tags.

Original error names, messages and stacks are never passed to the reporter. Neither are requests, full URLs/queries, headers, tokens, IP addresses, user IDs, transcripts, profiles or provider bodies. Shared redaction is an additional safeguard. The Sentry project region remains unverified; confirm it during provisioning and update the processor fact before activation. These partial facts do not complete the legal baseline.

Missing or malformed DSN disables capture. Reporting runs through `waitUntil`, has a two-second transport deadline, performs no retry and cannot change the original response. Reporting errors are not logged with private content.

## Health and deployment identity

`GET /api/health` retains `{ "ok": true }`. `GET /api/healthz` uses the shared `{status, product, version, checks}` response and returns 503 when required provider configuration is absent. These are configuration checks, with no paid provider request; they do not certify provider credentials or provider uptime. Both routes keep the existing Cloudflare Access check and API request budget.

The package version is a declared version only. It does not prove which commit is deployed. A release pipeline may set the non-secret `DEPLOYMENT_SHA` to the independently reviewed commit; record the actual deployed version/commit and Cloudflare deployment evidence separately.

## Authenticated uptime

The trusted default-branch workflow is disabled by default. Once deployed health checks pass, repository variable `RTT_UPTIME_ENABLED=true` enables the existing self-hosted runner every 30 minutes, including manual dispatches. An absent/false variable skips the job and prevents false outage issues before deployment. It checks only `https://rtt.eugnel.com/` and `https://rtt.eugnel.com/api/healthz`, using a narrow Access service identity. Redirects are not followed; a 302/403 Access page is never application health. An unconfigured monitor is reported separately and opens no outage incident. Repeated failures use one incident, and an authenticated recovery closes it.

Existing repository secrets `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` are mapped by the workflow to script environment names `RTT_UPTIME_ACCESS_CLIENT_ID` and `RTT_UPTIME_ACCESS_CLIENT_SECRET`. Reuse those configured secrets; no new secret is required. Keep values in the existing secure environment. Do not remove Access, exempt health routes, enable `workers.dev`/preview exposure or set `SKIP_ACCESS_CHECK=true` for monitoring.

```sh
node scripts/uptime.mjs
```

Exit 0 means both authenticated checks passed; exit 1 means unhealthy; exit 2 means unconfigured. Output contains static reasons and safe version/timing metadata, never raw response bodies or credentials. The monitor must not run pull-request code with secrets.

## Provision and verify

James approved the existing free Sentry plan for `pgnetwork/rtt` and a free RTT uptime monitor on 18 October 2026. Use authorised account/configuration facilities, or the AI-SDLC Grok Bot handoff lane, for unavailable capabilities. The read-only Sentry skill cannot create a project. No webhook handoff was dispatched by this source integration; the operator evidence below came through the authorised owner channel.

Operator evidence received on 18 October 2026: Access identity `rtt-uptime` and a Service Auth policy at precedence 2 are configured; the human allow policy is unchanged. The two existing repository secrets are configured. An authenticated homepage request returned 200, while `/api/healthz` returned 404 because this code is not deployed. The monitor remains inactive. Sentry project creation returned 403 for the available member role and remains pending with James; it is not provisioned. No credentials are recorded here.

1. Create or reuse Sentry project `rtt` in `pgnetwork` on the free plan; confirm region and normal data/IP scrubbing. Install its DSN directly as Worker secret `SENTRY_DSN` through normal configuration. Never copy it to a repository, chat, log or client variable.
2. Reuse the configured `rtt-uptime` Access identity/policy and existing `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` repository secrets. Preserve human policies and use the supported Git transport for the pinned private dependency, without credentials in package URLs or lockfiles.
3. Deploy only when release enforcement permits. Trigger one controlled synthetic server failure, verify the private envelope's allow-list and a Sentry receipt with the actual deployment identity. Avoid real provider calls, customer content or production error loops.
4. After the deployed `/api/healthz` returns its expected shared shape with authentication, set non-secret repository variable `RTT_UPTIME_ENABLED=true`. Run the authenticated monitor and record a successful run URL, version, timestamp and separately verified deployed identity.
5. Verify existing **Cloudflare Workers Metrics > rtt > Requests**, the aggregate invocation count for script `rtt` in a named UTC window containing the synthetic health invocation. Record the window/count and invocation timestamp, not request logs. These are operational request counts, not implemented user analytics or feature events.
6. Verify the shared support intake reads `sentry: {org: pgnetwork, project: rtt}` using its separate read-only `SENTRY_AUTH_TOKEN`. No alert webhook or new intake backend is required.

Only after those checks should an evidence PR change `baseline.observability` to `done` and close issue #10. Until then, the code is ready and the baseline remains open. Do not waive it on the owner's behalf.

To disable reporting, remove `SENTRY_DSN` through normal secure configuration. To pause monitoring, disable the scheduled workflow through authorised controls; do not weaken Access. Retain incident/evidence history.
