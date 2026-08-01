# PATCHES.md — CloudCLI fork

Tracks patches this fork (`TadMSTR/claudecodeui`, branch `forge-local`) carries against
upstream `siteboon/claudecodeui`. See `~/.claude/skills/shared-fork-upstream-sync/SKILL.md`
for the format spec, probe rules, and sync procedure.

**This file must never reach a branch pushed to `origin` (siteboon/claudecodeui).**
`forge-local` only.

Last synced against: `v1.37.0` (fork base was `v1.36.1` / merge-base `5884573`).
Re-applied onto `v1.37.0` on 2026-08-01 — a re-apply, not a rebase: upstream PR #1037
restructured the server into `server/modules/*` (259 files, +19322/-9323) and deleted all
three fork-touched server files rather than renaming them in place.

**Probe exit convention:** every probe below exits **0 if and only if upstream covers the
patch** — i.e. a passing probe means the entry can be retired. A failing probe means the
fork still needs to carry it. (The 2026-08-01 seeding of this file wrote the fork-only
probes inverted, prefixed with `!`, so they asserted the opposite of what their own
comments claimed. Corrected here; the classifications they produced were still right,
because they were read semantically rather than by exit code.)

---

## argv-secret-guard

- **status:** fork-only
- **commits:** `75726bcc` (original), `cef19b6d` (re-apply onto v1.37.0)
- **upstream-pr:** none
- **files:** `server/shared/argv-secret-guard.js`,
  `server/shared/tests/argv-secret-guard.test.js`,
  `server/modules/providers/list/claude/claude-runtime.provider.js` (upstream's
  restructured home for `server/claude-sdk.js`), `eslint.config.js`
- **why:** the `@anthropic-ai/claude-agent-sdk` serializes `options.mcpServers` and
  `options.allowedTools` inline into CLI flags (`--mcp-config`, `--allowedTools`) before
  spawning the `claude` binary. Any literal secret in those objects lands in the child's
  argv, readable via `/proc/<pid>/cmdline` by any process running as the same OS user —
  exactly the isolation scoped-mcp's per-agent bearer design (SMCP-15) assumes holds.
  This patch externalizes MCP header secrets into the subprocess env behind a `${VAR}`
  placeholder before the SDK options are built. No upstream equivalent exists as of
  `v1.37.0` — `claude-runtime.provider.js` merges `mcpServers` and builds `allowedTools`
  directly with no scrub step.
- **re-apply notes (v1.37.0):** four hunks, not three — the build plan omitted the
  `rememberEntry` guard in the permission-decision flow. Import uses the `@/` alias
  (`@/shared/argv-secret-guard.js`), since upstream converted `server/` to path aliases;
  `tsc-alias` rewrites it to a relative path at build time and `postbuild:server`
  verifies it resolved. Upstream also added the eslint `boundaries` plugin, which rejects
  the guard as an unknown element until it is registered under `backend-shared-utils` in
  `eslint.config.js` — without that entry the pre-commit hook fails the commit.
- **env-chain check (the silent-no-op risk):** `externalizeMcpSecrets` writes into
  `sdkOptions.env`, so the patch is worthless if that object is not what reaches the
  subprocess. Verified at v1.37.0: `mapCliOptionsToSDK` sets
  `sdkOptions.env = { ...process.env }` (L174, with an upstream comment noting
  `options.env` *replaces* process.env as of SDK 0.2.113), `externalizeMcpSecrets` mutates
  that same object (L522), and it reaches the child via `query({ options: sdkOptions })`
  (L648). Re-check this on every sync — it is the one place here where tests and build
  both pass while the patch does nothing.
- **probe:**
  ```
  # Static (tag-level) — exits 0 once upstream ships an equivalent scrub. Correctly
  # exits non-zero against v1.37.0 (no such construct exists), i.e. still fork-only.
  # Will need updating to upstream's own naming if/when a PR (ours or theirs) lands.
  git grep -qE 'externaliz(e|ing)McpSecrets|scrubArgvSecret|redactMcpHeader' <tag> -- \
      server/modules/providers/list/claude/claude-runtime.provider.js

  # Runtime (authoritative) — configure a bearer-token MCP server, spawn a session, and
  # assert the token value never appears in the child's argv:
  #   grep -qF "$MCP_BEARER_TOKEN" /proc/<claude-cli-pid>/cmdline  → must NOT match
  #   grep -qF "$MCP_BEARER_TOKEN" /proc/<claude-cli-pid>/environ  → MUST match
  # Both readable without sudo (child of the cloudcli server, same UID). Assert
  # presence/absence only; never emit a token value into a log, ticket or commit
  # (vikunja #91 / id 99).

  # Unit coverage:
  tsx --tsconfig server/tsconfig.json --test server/shared/tests/argv-secret-guard.test.js
  ```
- **audit disposition (2026-08-01, finding M1 — MEDIUM, deferred):** the static chain above
  is confirmed correct, but the guard's security property also depends on the bundled
  `claude` CLI expanding `${VAR}` in MCP headers. The original verification was against CLI
  2.1.212; the SDK is now `^0.3.165` and reports `claudeCodeVersion: 2.1.165` — an *older*
  bundled CLI despite the higher SDK semver. `bridge.mjs`/`sdk.mjs` are too minified to
  confirm statically. **Treat SMCP-41 as NOT deploy-verified until the runtime probe above
  runs against the live service** — unit tests exercise the guard's pure functions, not the
  CLI's expansion. Tracked in vikunja #307 (id 318).
- **known nit (audit I2, accepted):** the synthetic constant in the test file is named
  `LIVE_TOKEN`. The value is synthetic and the file is carried byte-for-byte from the
  audited `75726bc` remediation, so it was not renamed here. Rename it to `SYNTHETIC_TOKEN`
  on the next touch — a live bearer token was once copied into a fixture in this repo and
  force-pushed publicly (vikunja #91 / id 99).
- **last-verified:** `v1.37.0` on 2026-08-01 (build layer; runtime probe pending deploy)

## plugin-env-passthrough

- **status:** fork-only
- **commits:** `4c30a9f9` (original), `f0225ec1` (re-apply onto v1.37.0)
- **upstream-pr:** none
- **files:** `server/modules/plugins/plugin-process.service.ts` (upstream's restructured
  home for `server/utils/plugin-process-manager.js`),
  `server/modules/plugins/plugins.service.ts`,
  `server/modules/plugins/tests/plugin-process.service.test.js`,
  `server/modules/plugins/tests/plugin-registry.service.test.js`
- **why:** plugin subprocesses got no env passthrough at all upstream — every plugin ran
  with a bare `{HOME, NODE_ENV, PATH, PLUGIN_NAME}` env. The CloudCLI task-queue plugin's
  control functions need `TASK_QUEUE_API_SECRET` to reach the subprocess and fail without
  it. This patch adds `buildPluginEnv(pluginName, permissions)`, gated by a manifest
  `env:VAR` permission entry AND a host-side `PLUGIN_ENV_ALLOWLIST` (a plugin cannot grant
  itself access to an arbitrary host var just by declaring it).
- **re-apply notes (v1.37.0):** five call sites, not the two the build plan predicted.
  Beyond `plugin-process.service.ts:212` (boot path) and the positional
  `plugins.module.ts` re-export (which needs no edit), `plugins.service.ts` carries the
  runtime paths: the `startServer` signature on the `PluginDependencies` type (L24),
  `startServerIfAvailable` (L62, used by enable/toggle/restart) and the lazy start when a
  control call finds no port (L135), plus `permissions?: unknown` on `PluginManifest`.
  Plumbing only the boot path would leave a plugin enabled at runtime silently starting
  without its passthrough. `plugins.service.ts` is real TypeScript (unlike the
  `@ts-nocheck`'d process service), so the interface must be widened or typecheck fails.
  Upstream's `validateManifest` (now in `plugin-registry.service.ts`) already validates a
  `permissions` string array — the fork never patched the loader, only added coverage.
- **probe:**
  ```
  # Static (tag-level) — exits 0 if upstream independently built an equivalent gated
  # passthrough. Checks by construct, not by our symbol name, since PLUGIN_ENV_ALLOWLIST
  # is fork-specific. Exits non-zero against v1.37.0 → still fork-only.
  git grep -qiE 'plugin.*env.*allowlist|ALLOWED_PLUGIN_ENV|permissions.*env:' <tag> \
      -- server/modules/plugins/

  # Runtime (authoritative) — the fork's own coverage for this construct:
  tsx --tsconfig server/tsconfig.json --test \
      server/modules/plugins/tests/plugin-process.service.test.js
  # Plus the real signal: exercise the task-queue plugin's Approve/Cancel controls in the
  # UI (they fail closed without the secret), and confirm the startup log line
  #   [Plugins] "cloudcli-plugin-task-queue" granted env passthrough: …
  # appears, while a plugin requesting a non-allowlisted var is refused with a warning.
  ```
- **last-verified:** `v1.37.0` on 2026-08-01 (build layer; runtime probe pending deploy)

## cli-exec-bit

- **status:** fork-only
- **commits:** `ed22b3a1` (original), `52141e2a` (re-apply onto v1.37.0)
- **upstream-pr:** none
- **files:** `package.json` (`build:server` script)
- **why:** `tsc` regenerates the built `cli.js` with mode `644` on every build, even
  though the source `cli.ts` carries a shebang (and is itself `100644` in-tree) —
  `npm link`ed installs then fail to execute it. This patch appends a `chmod +x` to
  `build:server`. Caused a production outage once already (claudecodeui#4, vikunja #188).
- **re-apply notes (v1.37.0):** **path changed.** `bin.cloudcli` moved from
  `dist-server/server/cli.js` to `dist-server/server/modules/cli/cli.js`, so the `chmod`
  target moved with it. Re-confirmed the bug still exists before re-applying rather than
  assuming: `server/modules/cli/cli.ts` is mode `100644` at `v1.37.0` and starts with
  `#!/usr/bin/env node`. **Deploy consequence:** `/usr/bin/cloudcli` resolves through
  `npm link` to the *old* path, so `sudo npm link` must be re-run after this upgrade or
  the binary breaks despite a clean build.
- **probe:**
  ```
  # Static (tag-level) — exits 0 if upstream's own build:server does the chmod:
  git show <tag>:package.json | \
    python3 -c "import json,sys; sys.exit(0 if 'chmod' in json.load(sys.stdin)['scripts'].get('build:server','') else 1)"

  # Runtime (authoritative) — build clean and check the artefact's actual mode, not the
  # script source (the whole point is that source intent and build output diverge).
  # Read the bin path from package.json rather than hardcoding it — it has moved once:
  npm run build:server >/dev/null && \
    test -x "$(python3 -c "import json;print(json.load(open('package.json'))['bin']['cloudcli'])")"
  ```
- **last-verified:** `v1.37.0` on 2026-08-01 — runtime probe PASSED
  (`dist-server/server/modules/cli/cli.js` is `-rwxr-xr-x` after a clean build)

## verify-server-aliases

- **status:** fork-only
- **commits:** `b7a86b71`
- **upstream-pr:** none
- **files:** `scripts/verify-server-aliases.js`, `package.json` (`postbuild:server`)
- **why:** `server/tsconfig.json` maps `@/*` → `server/*`, but Node has no package named
  `@` — any `@/...` import that `tsc-alias` fails to rewrite crashes the server at
  require-time with `Cannot find package '@/shared'`, invisible until the process starts.
  This adds a `postbuild:server` step that walks `dist-server/` and fails the build loudly
  if any survive. Upstream `v1.37.0` has no `postbuild:server` entry at all. (CloudCLI
  went down this way on 2026-07-18.)
- **re-apply notes (v1.37.0):** cherry-picked cleanly; only a trivial `package.json`
  auto-merge. Upstream's restructure made this patch *more* load-bearing, not less —
  `server/` now uses `@/` aliases pervasively.
- **known gap (vikunja #305 / id 316):** the pattern is
  `/(?:from|require\()\s*['"]@\//`, which catches the `from` and `require(` shapes but
  **misses** bare side-effect imports (`import '@/x.js'`) and dynamic imports
  (`import('@/x.js')`). Verified by injecting each shape into a built `dist-server`.
  Not fixed here — out of scope for the port.
- **probe:**
  ```
  # Static (tag-level) — exits 0 if upstream adds its own postbuild:server check:
  git show <tag>:package.json | grep -q postbuild:server

  # Runtime (authoritative) — assert no unresolved alias survives a clean build:
  npm run build:server >/dev/null && node scripts/verify-server-aliases.js

  # Negative control — the check must be able to FAIL. Append to a built file:
  #   import x from '@/shared/nope.js';   → node scripts/verify-server-aliases.js exits 1
  # Use the `from` shape specifically; bare and dynamic imports are not yet caught (#305).
  ```
- **last-verified:** `v1.37.0` on 2026-08-01 — runtime probe PASSED, negative control
  PASSED for the `from` shape (exit 1), MISSED for bare/dynamic (see known gap)

## test-alias-resolution

- **status:** fork-only
- **commits:** `e17739f7`
- **upstream-pr:** none yet — **PR candidate, nothing here is forge-specific**
- **files:** `package.json` (`test` script)
- **why:** upstream `v1.37.0` added a real `test` script, but it cannot load most of what
  it targets. `server/tsconfig.json` maps `@/*` → `server/*` with `baseUrl: ".."`, and
  `node --import tsx --test` does not pick that up — tsx only honours tsconfig paths when
  pointed at the right config. Every server file importing `@/…` died at module load with
  `ERR_MODULE_NOT_FOUND: Cannot find package '@/shared'`, so whole files failed and their
  subtests never ran. Measured on pristine `v1.37.0`: **75 discovered, 27 pass, 48 fail**.
  With `tsx --tsconfig server/tsconfig.json`: **277 discovered, 277 pass**. This is the
  test-time counterpart of the build-time gap `verify-server-aliases` guards.
- **why it matters for syncing:** without this, the fork's test suite is permanently red
  and cannot distinguish a real regression from upstream noise — which is the signal every
  other probe in this file leans on.
- **probe:**
  ```
  # Static (tag-level) — exits 0 once upstream's own test script resolves the aliases:
  git show <tag>:package.json | \
    python3 -c "import json,sys; t=json.load(sys.stdin)['scripts'].get('test',''); sys.exit(0 if '--tsconfig' in t or 'tsconfig-paths' in t else 1)"

  # Runtime (authoritative) — a file that imports @/ must load and pass:
  tsx --tsconfig server/tsconfig.json --test server/shared/tests/slice-tail-page.test.ts
  ```
- **known adjacent issue (vikunja #306 / id 317):** with the aliases resolving,
  `server/modules/agent/tests/agent.routes.test.ts` is flaky under concurrency — passes
  standalone, intermittently fails in a full run. Upstream code, untouched by any fork
  patch.
- **last-verified:** `v1.37.0` on 2026-08-01 — runtime probe PASSED

---

## Retired

## check-credentials-oauth-token

- **status:** upstreamed
- **commits:** `d2eb718`, `07b4dc26`, `3b48ba11`, `6ee65cc8`
- **upstream-pr:** [siteboon/claudecodeui#979](https://github.com/siteboon/claudecodeui/pull/979) (merged)
- **files (at retirement):** `server/modules/providers/list/claude/claude-auth.provider.ts`
  (upstream's restructured home; fork originally touched `server/claude-auth.js`)
- **why:** fork added a fallback check for `CLAUDE_CODE_OAUTH_TOKEN` in
  `checkCredentials()`, alongside a friendlier auth-status label. Upstream PR #979 landed
  the same check — `claude-auth.provider.ts` is functionally identical to the fork's
  version at `v1.37.0`, including the accompanying test (`claude-auth.test.ts`).
- **probe:**
  ```
  git grep -q 'CLAUDE_CODE_OAUTH_TOKEN' <tag> -- \
    server/modules/providers/list/claude/claude-auth.provider.ts
  # Passes (exit 0) against v1.37.0. Fails against the pre-sync base (5884573,
  # path server/claude-auth.js there) — confirms the probe discriminates rather
  # than trivially matching.
  ```
- **absorbed by:** `v1.37.0`
- **last-verified:** `v1.37.0` on 2026-08-01 — probe PASSED; PR #979 confirmed
  `merged: true` via the API's merged boolean (its `state` is `closed`, which is
  ambiguous). Dropped from the re-applied branch.

## jwt-refresh-ws-sse-idle

- **status:** superseded
- **commits:** `7e88414`, `f6b6fe9c`, `dfd55590`, `daa950eb`, `bb6062c9`, `b8683abc`
- **upstream-pr:** [siteboon/claudecodeui#980](https://github.com/siteboon/claudecodeui/pull/980)
  (closed, unmerged — folded into
  [siteboon/claudecodeui#1037](https://github.com/siteboon/claudecodeui/pull/1037), merged)
- **files (at retirement):** `src/utils/api.js`, `src/contexts/WebSocketContext.tsx`
- **why:** fork's `applyRefreshedToken`/`isTokenExpired` (with a 60s clock-skew tolerance,
  fixing security finding F1) landed upstream under different names —
  `storeAuthToken`/`isAuthTokenExpired` in `src/utils/api.js` — plus exp-derived refresh
  scheduling (`getAuthTokenRefreshDelay`) and session-expiry events
  (`expireAuthSession`/`AUTH_SESSION_EXPIRED_EVENT`) that are *better* than the fork's
  original. **But the 60s clock-skew tolerance did not carry**: upstream's
  `isAuthTokenExpired` is a bare `Date.now() >= claims.expiresAt`, and it now runs inside
  `getStoredAuthToken()` — i.e. on every authenticated read, not just at WS close, making
  the regression more exposed than the original fork bug it fixed.
- **PR candidate (Step 10 flag):** open an upstream PR restoring a skew tolerance in
  `isAuthTokenExpired`. This is a real regression versus the fork's prior behaviour, not
  just a rename to verify. Deliberately excluded from the v1.37.0 port as separate work.
- **probe:**
  ```
  git grep -q 'storeAuthToken' <tag> -- src/utils/api.js && \
  git grep -q 'getAuthTokenRefreshDelay' <tag> -- src/utils/api.js && \
  git grep -q 'expireAuthSession' <tag> -- src/utils/api.js
  # Asserts the *construct* (exp-derived refresh + session-expiry event), not the
  # clock-skew tolerance — that regression is tracked separately via the PR-candidate
  # flag above, not this probe. Passes against v1.37.0, fails against the pre-sync
  # base (5884573) where none of these three exports existed yet.
  ```
- **absorbed by:** `v1.37.0` (partially — see above)
- **last-verified:** `v1.37.0` on 2026-08-01 — probe PASSED (all three exports present);
  PR #980 confirmed `merged: false`, #1037 merged. Dropped from the re-applied branch.
