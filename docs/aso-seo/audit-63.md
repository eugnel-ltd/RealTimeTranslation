# Search audit: issue #63, 28 October 2026

The whole production host currently redirects unauthenticated requests to Cloudflare Access, as reported in the task. Search engines and social preview fetchers cannot see the app, legal pages, crawler files or the new information page until an operator changes that policy. No Access policy, API protection, deployment configuration, footer, legal page or eugnel-platform pin changes in this diff.

## Before and after

| Area | Before | After |
| --- | --- | --- |
| App shell | Descriptive title and description; deliberate noindex | Existing title, description and noindex preserved; canonical, OG/Twitter and WebApplication JSON-LD added |
| Public information | No marketing HTML page | `/about/` provides static, visible product information and owner-only availability; unique title and description, canonical, OG/Twitter and matching JSON-LD |
| Sitemap and robots | Absent | Sitemap includes only `/about/`; robots allows HTML crawling to observe noindex and excludes API/internal paths |
| Social image | No image metadata | Local 1200×630 PNG with accessible OG/Twitter image descriptions; generated from an editable SVG |
| Internal links | App links to generated legal documents | Information page links to the existing app and four legal routes; app's non-JavaScript fallback links to the information page |
| Legal metadata | Generated noindex pages, without canonical or social metadata | Deferred to legal PR #62; no legal page is put in the sitemap |
| Performance design | React app with speech tooling | Private app bundle unchanged; information page has inline CSS, system fonts, no executable JavaScript, external fonts or visible images |

The WebApplication description is present in the HTML body. No ratings, reviews, awards, download counts, pricing offers or public sign-up claims are added. There are no new tracking scripts, cookies, paid tools or package dependencies. There are no visible raster images needing alt text; the social card has both OG and Twitter descriptions and its SVG has a title and description. All newly linked internal destinations exist in source or the existing legal generator. Public HTTP 200 availability has not been established.

This updates the search recommendation in the historical 18 October listing audit: the app remains private and noindex, while an explicitly described product information page is prepared for a later operator decision on public access.

## Lighthouse and Core Web Vitals

| Target | Before SEO | After SEO | Before performance | After performance |
| --- | --- | --- | --- | --- |
| Local production app `/` | Not measured | Not measured | Not measured | Not measured |
| Local product information `/about/` | Not applicable: page did not exist | Not measured | Not applicable: page did not exist | Not measured |
| Production host | Not measured: Access login redirect | Not measured: Access login redirect | Not measured: Access login redirect | Not measured: Access login redirect |

No score improvement or Core Web Vitals pass is claimed. `npm exec --cache ./node_modules/.cache/npm --yes --package=lighthouse -- lighthouse --version` could not obtain Lighthouse: registry DNS returned `EAI_AGAIN`. Local Chromium also failed before opening a page with `setsockopt: Operation not permitted` and SIGTRAP. The production baseline build was attempted before implementation and failed because client dependencies could not be installed. The offline npm cache lacks required package versions, so it cannot supply a lockfile installation. Local-server tests also encounter `listen EPERM` in this sandbox.

On a machine that permits local servers, Chromium and npm registry reads, install both lockfiles, build and serve the production files:

```sh
npm ci
npm --prefix client ci
npm run build
npm --prefix client run preview -- --host 127.0.0.1 --port 4173
```

In a second terminal, run the free Lighthouse CLI for both routes. Repeat the root measurement on the base revision with identical tool versions, browser and throttling settings. Keep the resulting JSON for review.

```sh
npx --yes lighthouse http://127.0.0.1:4173/ --only-categories=seo,performance --chrome-flags="--headless" --output=json --output-path=./node_modules/.cache/lighthouse-app.json
npx --yes lighthouse http://127.0.0.1:4173/about/ --only-categories=seo,performance --chrome-flags="--headless" --output=json --output-path=./node_modules/.cache/lighthouse-about.json
```

The app's noindex is intentional, so its Lighthouse indexing failure must stay. Record LCP, CLS and TBT alongside scores. TBT is a lab responsiveness measure; it does not prove field INP. Field LCP/CLS/INP remain unmeasured for this private service. Do not add analytics to obtain them. Use available browser tools and any existing public field data after public access is authorised.

## Verification and remaining work

The new five-case SEO regression failed on the old tree: missing canonical, information page, sitemap, robots and image. It passes after implementation. It checks complete unique page metadata, parseable JSON-LD with visible matching text, app noindex, the exact sitemap scope, robots directives, internal destinations, social image dimensions and prohibited claims/links. The sitemap also parses with Python's standard XML parser.

Full test, typecheck, lint and build commands were attempted. They do not pass in this sandbox: missing client modules follow the registry failure; local-server tests report `listen EPERM`; legal fixture child-process output is also affected by the sandbox. The final `npm test` summary was `Test Files 28 failed | 44 passed (72)`, `Tests 43 failed | 505 passed | 84 skipped (632)`, with six unhandled errors. These are environment-blocked results, not a passing regression suite. `npm run typecheck` and `npm run build` exited 2 with missing React/Speech SDK modules and resulting TypeScript diagnostics. `npm run lint` exited 2: without the locked client ESLint, the available executable rejected `--resolve-plugins-relative-to`. The new test alone passed all five cases; its standalone strict TypeScript compilation, social-card regeneration and XML parse passed. No existing test has been changed, skipped or removed by this diff, and no independent approval is claimed.

An operator must:

1. Review the local diff, restore the lockfile dependencies on a permitted runner, pass all four required commands and finish the local before/after Lighthouse audit before treating acceptance as complete.
2. Integrate legal PR #62 and review legal metadata separately. Retain the owner footer rule and only add legal URLs to the sitemap if their generated pages are deliberately indexable with complete metadata.
3. Use the existing guarded release process when authorised. Deploying this diff does not itself change Access.
4. Decide whether to expose `/about/`, `/robots.txt`, `/sitemap.xml` and `/social-card.png` outside Access. Keep `/`, app routes, `/api/*` and `/_internal/*` protected. If legal documents become public, expose only the approved exact legal paths. Check anonymous 200 responses and the expected content for every approved route; verify the private app/API still require authentication. Check `/about`, `/about/` and `/about/index.html` converge on the canonical trailing-slash URL.
5. Only after public HTTP 200 verification, submit `https://rtt.eugnel.com/sitemap.xml` through the owner's verified Search Console property. No store-console, DNS or paid-service change is needed for this issue.
