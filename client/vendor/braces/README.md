# Local braces depth guard

RTT uses the MIT-licensed `braces` 3.0.3 runtime with a small local security patch.
It retains the original authorship, package name, version and public methods.
This is not an upstream release.

The original package is `braces@3.0.3` from the npm registry, fetched on 18 October 2026.
Its tarball has SHA-512 integrity:

```text
sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==
```

The upstream source is <https://github.com/micromatch/braces>.
The original MIT terms and copyright are in `LICENSE`.
`upstream.patch` records every runtime change from the published tarball.
`index.js` and `lib/utils.js` remain byte-identical to that release.
Local package metadata omits upstream development dependencies and scripts.
It adds `private: true` and retains the `fill-range` runtime dependency.

## Repair and scope

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) concerns stack exhaustion from recursive AST processing.
The registry has no patched upstream release as of 18 October 2026.
This patch derives from the depth guards in [upstream PR 72](https://github.com/micromatch/braces/pull/72),
including the parent-cycle guard in source commit `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`.
It excludes unrelated parser fixes from that source.

The local hard limit is 100 nested brace or parenthesis containers.
Parse rejects the next container with `SyntaxError` before recursive work starts.
Compile, expand and stringify also reject direct AST input beyond that depth with `RangeError`.
Expansion rejects cycles in parent links.
The limit is fixed. Callers cannot raise it through an option.
Shallow patterns retain the original output, including the original stringify parent behaviour.

This repair covers the named recursion defect.
It does not bound expansion cardinality, AST width or all malformed JavaScript objects.
RTT passes only repository-controlled patterns from `client/tailwind.config.js` to this tooling.
These development dependencies are outside the browser and Worker runtime bundles.

## Audit interpretation and maintenance

Keep the raw `npm audit` findings visible. Never add an ignore or invent an upstream version.
Version-based audit tools can still report the original 3.0.3 advisory for this local package.
That report does not inspect these patched source files.
Some audit versions can omit local packages, so a zero count alone also proves nothing.
With npm 11.9.0, the full client audit still reports five high findings from the original version.
The client audit with `--omit=dev` reports one high finding at `vendor/braces`.
The physical local folder remains in that audit despite `dev: true` in the lockfile.
Root full and production audits report zero.
The application still uses this package only through development tooling.
The installed consumer paths and browser bundle checks confirm that boundary.
Do not describe the client production audit as clean.

The orchestrator approved this accurate local disposition on 18 October 2026.
The source repair still requires independent review of the exact commit.
It is not continued acceptance of the vulnerable recursive implementation.

`tests/braces-depth.test.ts` resolves this runtime through both micromatch and chokidar.
Each hostile-input test runs in a child with a three-second deadline, a 256 KB stack and bounded output.
The same frozen tests reproduce native stack exhaustion or missing rejection on the original release.
They distinguish those failures from the explicit local depth error.
The suite also checks normal patterns, the depth boundary and parent cycles.

Run `npm ci` in the repository root and in `client`, then `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`.
The client override must continue to resolve every transitive `braces` consumer to this directory.
Compare generated application CSS byte for byte before any patch update.
Replace this local copy only after a compatible upstream release passes the same tests and CSS comparison.
