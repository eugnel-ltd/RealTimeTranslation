# Deploy Real-Time Translator on Cloudflare Workers

Do **not** put API keys in the client. The Vite bundle is served as Worker static assets; all secrets live in Worker secrets.

## Worker

- Name: `rtt`
- Custom domain: `rtt.eugnel.com` (from `wrangler.jsonc`)
- Assets: `client/dist` (SPA)
- API: `/api/*` runs the Worker first (`run_worker_first`)

## Secrets

Set each with Wrangler (values are never printed back):

```bash
npx wrangler secret put AZURE_SPEECH_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TYPESAFE_API_KEY
# Optional — only if you add a Translator resource later. The Speech key cannot be reused.
npx wrangler secret put AZURE_TRANSLATOR_KEY
```

| Secret | Used by |
| --- | --- |
| `AZURE_SPEECH_KEY` | `GET /api/speech-token` → Azure `issueToken` |
| `GEMINI_API_KEY` | Gemini Live ephemeral tokens, Live proxy, and text translation when Translator is unset |
| `ANTHROPIC_API_KEY` | `POST /api/answer` and Jev fallback question detection |
| `TYPESAFE_API_KEY` | Default question detector (`POST /api/detect-question` → Jev `POST https://api.typesafe.ai/v1/systemone`) |
| `AZURE_TRANSLATOR_KEY` | Optional. If set, `POST /api/translate` uses Azure Translator; otherwise Gemini `gemini-3.5-flash-lite` |

## Vars (`wrangler.jsonc` or dashboard)

| Var | Default / notes |
| --- | --- |
| `AZURE_SPEECH_REGION` | Azure Speech region (e.g. `eastasia`) |
| `AZURE_TRANSLATOR_REGION` | Required only with `AZURE_TRANSLATOR_KEY` |
| `ACCESS_AUD` | Cloudflare Access application AUD |
| `ACCESS_TEAM_DOMAIN` | `https://eugnel.cloudflareaccess.com` |
| `SKIP_ACCESS_CHECK` | `false` in production. `true` for local `wrangler dev` |
| `DEFAULT_ANSWER_MODEL` | `claude-opus-5-5` (`claude-sonnet-5-5` also allowed) |
| `GEMINI_TRANSLATE_MODEL` | `gemini-3.5-flash-lite` |
| `GEMINI_LIVE_TRANSCRIBE_MODEL` | `gemini-3.5-transcribe-live` |
| `GEMINI_LIVE_TRANSLATE_MODEL` | `gemini-3.5-live-translate-preview` |
| `TYPESAFE_MODEL` | `jev-latest` |

Update vars:

```bash
npx wrangler deploy
# or dashboard → Workers → rtt → Settings → Variables
```

## Cloudflare Access

Protect `rtt.eugnel.com` with Access (Google login). The Worker verifies `Cf-Access-Jwt-Assertion` on **all** `/api/*` routes using `ACCESS_TEAM_DOMAIN` JWKS and `ACCESS_AUD`.

Local development: copy `.dev.vars.example` to `.dev.vars` and set `SKIP_ACCESS_CHECK=true`.

## Build and deploy (from this repo)

```bash
npm install
npm --prefix client install
npm run build                 # client production build + secret-pattern scan of dist
npx wrangler deploy --dry-run # packaging check only
npx wrangler deploy           # you run this with your Cloudflare token
```

This environment has **no** Cloudflare/Azure/Gemini/Anthropic/TypeSafe keys. Do not deploy from the agent.

## Local Worker + smoke script

```bash
cp .dev.vars.example .dev.vars
# fill real keys in .dev.vars; keep SKIP_ACCESS_CHECK=true
npx wrangler dev
```

In another terminal:

```bash
node scripts/smoke.mjs
# or: SMOKE_BASE_URL=http://127.0.0.1:8787 node scripts/smoke.mjs
```

If Access is enabled against the smoke target:

```bash
SMOKE_ACCESS_JWT='<Cf-Access-Jwt-Assertion>' node scripts/smoke.mjs
```

The script checks:

- `GET /api/health`
- `GET /api/config`
- `GET /api/speech-token`
- `POST /api/translate` (Azure Translator if key set, else Gemini)
- `GET/POST /api/gemini-token`
- `GET /api/gemini-live` (expects HTTP 426 without Upgrade)
- `POST /api/detect-question`
- `POST /api/answer` for `claude-opus-5-5` and `claude-sonnet-5-5`, including **time-to-first-token**

## Translation fallback

1. Azure Translator if `AZURE_TRANSLATOR_KEY` is set.
2. Else Gemini `GEMINI_TRANSLATE_MODEL` (`gemini-3.5-flash-lite`) via `GEMINI_API_KEY`, including Cantonese (`yue` / `zh-HK`, Traditional) and the two UI target languages.

## Question detector

Default: TypeSafe **Jev** (`POST /v1/systemone`) with parallel Noul + Choice questions (see `worker/src/detect-question.ts`). Threshold is in Settings (default `0.7`).

If `TYPESAFE_API_KEY` is missing, or Jev returns 429/5xx/529, the Worker cools down Jev for **5 minutes** and falls back to Claude. The client `QuestionDetector` interface is the plug point for a later external service.
