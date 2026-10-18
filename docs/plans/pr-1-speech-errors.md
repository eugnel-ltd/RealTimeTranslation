# Complete the useful remainder of stale PR #1

The owner-authorised nonvisual sweep includes clearing stale PRs. Existing PR #1 (`eaa646e85e2b8b0f080953f09621da754841ac6b`, December 2025) is the intent; never merge that old branch. Main/#23 already awaits SDK startup callbacks, rejects failures once, resets recording state and disposes cancelled recognizers with generation ownership. Its remaining useful behavior is actionable connection and microphone-permission guidance, which current raw errors do not provide.

## Bounded implementation

Change only `client/src/services/azureSpeech.ts` and add `tests/azure-speech-errors.test.ts`, plus this plan. Use one small internal Error normalizer for the typed SDK ConnectionFailure category, startup StatusCode 1006 and browser NotAllowedError/legacy PermissionDeniedError. Tell the user to check connectivity or allow microphone access; do not suggest adding provider keys/regions to the browser. Preserve unknown messages and authoritative nonconnection SDK categories. Keep quota classification/fallback before generic formatting, current stop/start generations, one startup rejection versus one established-session onError callback, token flow and lazy SDK import. No UI layout/styles, dependency, worker secret, provider request, retry or auth-policy change.

## Test and delivery sequence

Commit this accepted plan, then correctly typed behavior tests before source changes. Real AzureSpeechService tests must reproduce raw startup/established connection errors and microphone permission denial; preserve startup-error cleanup/single rejection, runtime cleanup/single callback, quota routing, unknown errors and stale-session suppression. Show meaningful old-source failures, typecheck before freezing tests, then implement without editing the committed assertions. Run full runtime tests, typecheck, lint and build/bundle scan. Root independently reviews exact head, publishes the modern fix after GitHub content cooldown and closes obsolete PR #1 with concrete modern behavior evidence. No production microphone/provider test is possible in this credential-free environment; disclose that fact.

Prior sweep vendor test/implementation attempts exited 1 without usable source changes; root explicitly authorised reusing that recorded fallback for this bounded sweep. Direct Codex continuation is used, with independent root review. Expenditure: none. No separate issue is needed while existing PR #1 represents this scope and GitHub content creation is temporarily rate limited.

## Verification

Frozen first-red commit `e859618` contains nine correctly typed service behavior tests. On unchanged main `049ade09791ef8a92d885d315f17506d2b6130b4`, five failed because raw connection/permission errors lacked actionable guidance, and four quota/authentication/unknown/stale controls passed. Typecheck passed before that commit. The frozen test SHA-256 is `75b1b904ecf25e40d1aa6ba90fc2d2b27b6e3d4aa360b78552fe7bbabf304336`.

After the focused normalizer and three callsite changes, all nine unchanged regressions and all 366 runtime tests pass. Typecheck, lint and build/bundle secret scan pass. Startup still rejects without a duplicate onError; established failure emits once after invalidating its session; no new token, provider, microphone or production test was performed beyond fake service transports. Command logs are in the session scratch directory `/workspace/work/live-acceptance/azure-guidance-*.log`.
