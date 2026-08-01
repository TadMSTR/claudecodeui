# PATCHES.md — CloudCLI fork

Tracks patches this fork (`TadMSTR/claudecodeui`, branch `forge-local`) carries against
upstream `siteboon/claudecodeui`. See `~/.claude/skills/shared-fork-upstream-sync/SKILL.md`
for the format spec, probe rules, and sync procedure.

**This file must never reach a branch pushed to `origin` (siteboon/claudecodeui).**
`forge-local` only.

Last synced against: `v1.37.0` (fork base was `v1.36.1` / merge-base `5884573`).

---

## argv-secret-guard

- **status:** fork-only
- **commits:** `75726bcc`
- **upstream-pr:** none
- **files:** `server/modules/providers/list/claude/claude-runtime.provider.js` (upstream's
  restructured home for the file this patch originally touched, `server/claude-sdk.js`)
- **why:** the `@anthropic-ai/claude-agent-sdk` serializes `options.mcpServers` and
  `options.allowedTools` inline into CLI flags (`--mcp-config`, `--allowedTools`) before
  spawning the `claude` binary. Any literal secret in those objects lands in the child's
  argv, readable via `/proc/<pid>/cmdline` by any process running as the same OS user —
  exactly the isolation scoped-mcp's per-agent bearer design (SMCP-15) assumes holds.
  This patch externalizes MCP header secrets into the subprocess env behind a `${VAR}`
  placeholder before the SDK options are built. No upstream equivalent exists as of
  `v1.37.0` — `claude-runtime.provider.js` merges `mcpServers` and builds `allowedTools`
  directly with no scrub step.
- **probe:**
  ```
  # Static (tag-level) — passes only once upstream ships an equivalent scrub. Correctly
  # fails against v1.37.0 today; will need updating to upstream's own naming if/when a
  # PR (ours or theirs) lands, per the probe-naming exception in the skill doc.
  ! git grep -qE 'externaliz(e|ing)McpSecrets|scrubArgvSecret|redactMcpHeader' v1.37.0 -- \
      server/modules/providers/list/claude/claude-runtime.provider.js

  # Runtime (authoritative) — configure a bearer-token MCP server, spawn a session, and
  # assert the token value never appears in the child's argv:
  #   grep -qF "$MCP_BEARER_TOKEN" /proc/<claude-cli-pid>/cmdline  → must NOT match
  # References the env var NAME/value pairing structurally; never hardcode a live token
  # into this probe or its output (vikunja #91 / id 99).
  ```
- **last-verified:** `v1.37.0` on 2026-08-01

## plugin-env-passthrough

- **status:** fork-only
- **commits:** `4c30a9f9`
- **upstream-pr:** none
- **files:** `server/modules/plugins/plugin-process.service.ts` (upstream's restructured
  home for `server/utils/plugin-process-manager.js`, which this patch originally touched)
- **why:** plugin subprocesses got no env passthrough at all upstream — every plugin ran
  with a bare `{HOME, NODE_ENV, PATH, PLUGIN_NAME}` env. The CloudCLI task-queue plugin's
  control functions need `TASK_QUEUE_API_SECRET` to reach the subprocess and fail without
  it. This patch adds `buildPluginEnv(pluginName, permissions)`, gated by a manifest
  `env:VAR` permission entry AND a host-side `PLUGIN_ENV_ALLOWLIST` (a plugin cannot grant
  itself access to an arbitrary host var just by declaring it).
- **probe:**
  ```
  # Static (tag-level) — a real hit here would mean upstream independently built an
  # equivalent gated-passthrough mechanism; check by construct, not by our symbol name,
  # since PLUGIN_ENV_ALLOWLIST is fork-specific:
  ! git grep -qE 'plugin.*env.*allowlist|ALLOWED_PLUGIN_ENV|permissions.*env:' v1.37.0 \
      -i -- server/modules/plugins/ 2>/dev/null

  # Runtime (authoritative) — run the fork's own coverage for this construct:
  node --test server/utils/tests/plugin-process-manager.test.js
  # Must pass on forge-local; must have no upstream equivalent file to run against v1.37.0.
  ```
- **last-verified:** `v1.37.0` on 2026-08-01

## cli-exec-bit

- **status:** fork-only
- **commits:** `ed22b3a1`
- **upstream-pr:** none
- **files:** `package.json` (`build:server` script), `scripts/verify-server-aliases.js`
  (adjacent postbuild step, see next entry)
- **why:** `tsc` regenerates `dist-server/server/cli.js` with mode `644` on every build,
  even though the source `cli.ts` has a shebang — `npm link`ed installs then fail to
  execute. This patch appends `&& chmod +x dist-server/server/cli.js` to `build:server`.
  Upstream's `build:server` at `v1.37.0` (`tsc -p server/tsconfig.json && tsc-alias -p
  server/tsconfig.json`) has no such step, and upstream's own bin path moved anyway (see
  the fork's own `why:` note under Retired — check `package.json` `bin.cloudcli` before
  re-applying, it changed to `dist-server/server/modules/cli/cli.js`).
- **probe:**
  ```
  # Static (tag-level) — check upstream's own build:server script for a chmod step:
  ! git show v1.37.0:package.json | \
      python3 -c "import json,sys; print('chmod' in json.load(sys.stdin)['scripts'].get('build:server',''))" \
      | grep -q True

  # Runtime (authoritative) — build clean and check the artefact's actual mode, not the
  # script source (the whole point of this patch is that source intent and build output
  # diverge):
  npm run build:server >/dev/null && test -x dist-server/server/cli.js
  # (path changes to dist-server/server/modules/cli/cli.js once re-applied against a
  # restructured upstream — update this line at re-apply time, per Step 5/6 of the skill.)
  ```
- **last-verified:** `v1.37.0` on 2026-08-01

## verify-server-aliases

- **status:** fork-only
- **commits:** `b7a86b71`
- **upstream-pr:** none
- **files:** `scripts/verify-server-aliases.js`, `package.json` (`postbuild:server` script)
- **why:** `server/tsconfig.json` maps `@/*` → `server/*`, but Node has no such package —
  any `@/...` import that `tsc-alias` fails to rewrite crashes the server at
  require-time with `Cannot find package '@/shared'`, invisible until the process starts.
  This patch adds a `postbuild:server` step that walks `dist-server/` for the pattern
  `/(?:from|require\()\s*['"]@\//` and fails the build loudly if any survive. Upstream
  `v1.37.0` has no `postbuild:server` entry at all.
- **probe:**
  ```
  # Static (tag-level):
  ! git show v1.37.0:package.json | grep -q postbuild:server

  # Runtime (authoritative) — assert no unresolved alias survives a clean build:
  npm run build:server >/dev/null && \
    ! grep -rlE '(?:from|require\()\s*['"'"'"]@/' dist-server/ --include='*.js'
  ```
- **last-verified:** `v1.37.0` on 2026-08-01

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
- **last-verified:** `v1.37.0` on 2026-08-01

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
  just a rename to verify.
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
- **last-verified:** `v1.37.0` on 2026-08-01
