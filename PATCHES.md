# PATCHES.md — CloudCLI fork

Tracks patches this fork (`TadMSTR/claudecodeui`, branch `forge-local`) carries against
upstream `siteboon/claudecodeui`. See `~/.claude/skills/shared-fork-upstream-sync/SKILL.md`
for the format spec, probe rules, and sync procedure.

**This file must never reach a branch pushed to `origin` (siteboon/claudecodeui).**
`forge-local` only.

Last synced against: `v1.37.2` (fork base was `v1.37.0` / merge-base `264e0946`).
Rebased onto `v1.37.2` on 2026-08-19 — a **rebase**, not the re-apply `v1.37.0` needed.
Upstream moved 17 commits / 210 files / +10673−3689, but no fork-touched file was deleted
or moved, so skill Step 5 did not apply. Three conflicts, all measured with
`git merge-tree` before the rebase started rather than predicted: `package.json` twice
(both fork build patches) and `claude-runtime.provider.js` once.

**Probe exit convention:** every probe below exits **0 if and only if upstream covers the
patch** — i.e. a passing probe means the entry can be retired. A failing probe means the
fork still needs to carry it.

**Run every probe in both directions.** A probe that fails against `forge-local` — the
branch that demonstrably *has* the patch — is broken, not a result, and its "still
fork-only" verdict is worthless:

```
for REF in v1.37.2 forge-local; do echo "== $REF"; <probe>; echo "exit $?"; done
```

Both-direction results as of 2026-08-19 are recorded per entry. Every live probe reads
`1` against `v1.37.2` and `0` against `forge-local`, which is the shape a valid
"still fork-only" verdict has.

---

## argv-secret-guard

- **status:** fork-only
- **commits:** `75726bcc` (original), `cef19b6d` (re-apply onto v1.37.0),
  `7c4676cd` (rebase onto v1.37.2)
- **upstream-pr:** none
- **files:** `server/shared/argv-secret-guard.js`,
  `server/shared/tests/argv-secret-guard.test.js`,
  `server/modules/providers/list/claude/claude-runtime.provider.js`, `eslint.config.js`
- **why:** the `@anthropic-ai/claude-agent-sdk` serializes `options.mcpServers` and
  `options.allowedTools` inline into CLI flags (`--mcp-config`, `--allowedTools`) before
  spawning the `claude` binary. Any literal secret in those objects lands in the child's
  argv, readable via `/proc/<pid>/cmdline` by any process running as the same OS user —
  exactly the isolation scoped-mcp's per-agent bearer design (SMCP-15) assumes holds.
  This patch externalizes MCP header secrets into the subprocess env behind a `${VAR}`
  placeholder before the SDK options are built. No upstream equivalent exists as of
  `v1.37.2`.
- **re-apply notes (v1.37.2):** four hunks. `claude-runtime.provider.js` gained 347 lines
  since `v1.37.0`, so **every line number in the previous revision of this entry was
  stale** — do not trust them across a sync, re-locate by anchor. Three hunks rebased
  cleanly; only the `assertNoArgvSecrets` backstop conflicted, because upstream replaced
  the `buildPromptPayload` / `createPrompt` streaming path with
  `buildPromptMessages` / `createHeldPromptStream`. Upstream's block was taken verbatim
  and the backstop re-seated above it. Current positions on `forge-local`:

  | Hunk | Line |
  |---|---|
  | guard import (`@/shared/argv-secret-guard.js`) | 23–27 |
  | `scrubSecretAllowedTools` before `sdkOptions.allowedTools` | 236 |
  | `externalizeMcpSecrets(sdkOptions.mcpServers, sdkOptions.env)` | 663 |
  | `assertNoArgvSecrets(sdkOptions)` backstop | 673 |
  | `isSecretAllowedToolsEntry` on `rememberEntry` | 770 |

- **env-chain check (the silent-no-op risk):** `externalizeMcpSecrets` writes into
  `sdkOptions.env`, so the patch is worthless if that object is not what reaches the
  subprocess — it would build green, test green, and do nothing. Re-verified end to end
  at `v1.37.2`:
  - `sdkOptions.env` is assigned exactly once, at **L198**. Upstream added a key to that
    object literal (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) — **merge into it, never
    overwrite it**. Upstream's own comment notes `options.env` *replaces* `process.env`
    as of SDK 0.2.113; `package.json` pins `^0.3.165`.
  - Nothing reassigns `sdkOptions.env` after L198.
  - There are now **two `query({ prompt, options: sdkOptions })` call sites** — L788 and
    a hooks-failure retry at L801. Both pass the *same* `sdkOptions` object, and the
    retry only does `delete sdkOptions.hooks` and rebuilds the prompt stream; it touches
    neither `env` nor `mcpServers`. One `externalizeMcpSecrets` call therefore covers
    both, and the backstop is placed above both rather than beside the first.
  - The one write that lands *after* the backstop runs is the `rememberEntry` push at
    L773. That is precisely why hunk 4 exists — without it a secret-shaped entry could be
    persisted post-backstop and re-serialized into argv on the next launch.
  **Re-check all four bullets on every sync.**
- **eslint:** upstream's `boundaries` plugin rejects the guard as an unknown element until
  it is registered under `backend-shared-utils` in `eslint.config.js` — without that entry
  the pre-commit hook fails the commit. Still present and still required at `v1.37.2`
  (`eslint.config.js` is unchanged between the two tags).
- **probe:**
  ```
  # Static (tag-level) — exits 0 once upstream ships an equivalent scrub.
  git grep -qE 'externaliz(e|ing)McpSecrets|scrubArgvSecret|redactMcpHeader' <ref> -- \
      server/modules/providers/list/claude/claude-runtime.provider.js
  # 2026-08-19: v1.37.2 -> exit 1 (fork-only), forge-local -> exit 0. Discriminates.
  # Will need updating to upstream's own naming if/when a PR (ours or theirs) lands.

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
- **✅ audit disposition (2026-08-01, finding M1 / DH-04 — MEDIUM) — CLOSED 2026-08-19.** The
  concern was that the guard's security property also depends on the bundled `claude` CLI
  expanding `${VAR}` in MCP headers, verified only against CLI 2.1.212 while the SDK reports
  `claudeCodeVersion: 2.1.165` — an *older* bundled CLI despite the higher semver — and
  `bridge.mjs`/`sdk.mjs` are too minified to confirm statically. **Resolved empirically after
  the v1.37.2 restart**, against a real cloudcli-spawned `claude` child:
  - its `--mcp-config` argv carries `Authorization: ${CLOUDCLI_MCP_SECRET_0}` — a
    placeholder, not a literal, so the guard rewrote it;
  - `ss -tnp` shows that same pid holding **established** connections to the
    `scoped-mcp-developer` backend, and it is the only `claude` client of that port;
  - tool calls over those connections succeed, with no genuine 401/403.

  A CLI that did *not* expand `${VAR}` would send the literal placeholder string as the
  bearer and be rejected. It was not. **The expansion works at SDK `^0.3.165`.** Re-open this
  only if the SDK pin moves — that is the trigger, not the passage of time.
- **✅ vikunja #307 — runtime `/proc` probe RUN, 2026-08-19. SMCP-41 is now DEPLOY-verified**,
  not merely build-verified. Against pid of the live `claude` child:
  | Assertion | Result |
  |---|---|
  | secret present in `/proc/<pid>/environ` | **true** (required) |
  | secret present in `/proc/<pid>/cmdline` | **false** (required) |
  | `${CLOUDCLI_MCP_SECRET_0}` placeholder present in cmdline | **true** (required) |

  The third assertion is the one that matters most and is easy to omit: without it, a guard
  that simply *dropped* the header would pass the first two and look identical to success.
  Also swept every long literal in argv and confirmed none matches any value in the process
  environment — the remaining matches are session UUIDs and filesystem paths. No token value
  was emitted to any log, commit or ticket at any point (vikunja #91).
- **known nit (audit I2) — FIXED 2026-08-19** in `9a935292`: the test fixture constant was
  renamed `LIVE_TOKEN` → `SYNTHETIC_TOKEN` (15 occurrences, value unchanged and confirmed
  synthetic against the real secrets files with 0 matches). The old name invited exactly the
  mistake that once put a real bearer token in a fixture in this repo (vikunja #91 / id 99).
- **last-verified:** `v1.37.2` on 2026-08-19 — static probe discriminates in both
  directions; unit probe 12/12 pass; env chain re-read by eye at the line numbers above;
  **runtime `/proc` probe PASSED against the live service after restart**, and the CLI
  `${VAR}` expansion assumption confirmed rather than assumed.

## plugin-env-passthrough

- **status:** fork-only
- **commits:** `4c30a9f9` (original), `f0225ec1` (re-apply onto v1.37.0),
  `85c78a79` (rebase onto v1.37.2)
- **upstream-pr:** none
- **files:** `server/modules/plugins/plugin-process.service.ts`,
  `server/modules/plugins/plugins.service.ts`,
  `server/modules/plugins/tests/plugin-process.service.test.js`,
  `server/modules/plugins/tests/plugin-registry.service.test.js`
- **why:** plugin subprocesses got no env passthrough at all upstream — every plugin ran
  with a bare `{HOME, NODE_ENV, PATH, PLUGIN_NAME}` env. The CloudCLI task-queue plugin's
  control functions need `TASK_QUEUE_API_SECRET` to reach the subprocess and fail without
  it. This patch adds `buildPluginEnv(pluginName, permissions)`, gated by a manifest
  `env:VAR` permission entry AND a host-side `PLUGIN_ENV_ALLOWLIST` (a plugin cannot grant
  itself access to an arbitrary host var just by declaring it).
- **re-apply notes (v1.37.2):** **rebased with zero conflicts** — `server/modules/plugins/`
  is untouched between `v1.37.0` and `v1.37.2`. The five call sites recorded at the last
  sync are unchanged: `plugin-process.service.ts` (boot path), and in `plugins.service.ts`
  the `startServer` signature on `PluginDependencies`, `startServerIfAvailable`
  (enable/toggle/restart), and the lazy start when a control call finds no port, plus
  `permissions?: unknown` on `PluginManifest`. Plumbing only the boot path would leave a
  plugin enabled at runtime silently starting without its passthrough.
  `plugins.service.ts` is real TypeScript (unlike the `@ts-nocheck`'d process service), so
  the interface must stay widened or `typecheck` fails.
- **probe:**
  ```
  # Static (tag-level) — exits 0 if upstream independently built an equivalent gated
  # passthrough. Checks by construct, not by our symbol name, since PLUGIN_ENV_ALLOWLIST
  # is fork-specific.
  git grep -qiE 'plugin.*env.*allowlist|ALLOWED_PLUGIN_ENV|permissions.*env:' <ref> \
      -- server/modules/plugins/
  # 2026-08-19: v1.37.2 -> exit 1 (fork-only), forge-local -> exit 0. Discriminates.

  # Runtime (authoritative) — the fork's own coverage for this construct:
  tsx --tsconfig server/tsconfig.json --test \
      server/modules/plugins/tests/plugin-process.service.test.js
  # Plus the real signal: exercise the task-queue plugin's Approve/Cancel controls in the
  # UI (they fail closed without the secret), and confirm the startup log line
  #   [Plugins] "cloudcli-plugin-task-queue" granted env passthrough: …
  # appears, while a plugin requesting a non-allowlisted var is refused with a warning.
  ```
- **last-verified:** `v1.37.2` on 2026-08-19 — static probe discriminates in both
  directions; unit probe 9/9 pass; **startup-log signal confirmed live after restart**:
  `[Plugins] "task-queue" granted env passthrough: TASK_QUEUE_API, TASK_QUEUE_API_SECRET`,
  followed by `[Plugins] Server started for "task-queue"`. The passthrough is reaching the
  subprocess on the real boot path, not just in tests.

## cli-exec-bit

- **status:** fork-only
- **commits:** `ed22b3a1` (original), `52141e2a` (re-apply onto v1.37.0),
  `fcd4feb3` (rebase onto v1.37.2)
- **upstream-pr:** none
- **files:** `package.json` (`build:server` script)
- **why:** `tsc` regenerates the built `cli.js` with mode `644` on every build, even
  though the source `cli.ts` carries a shebang (and is itself `100644` in-tree) —
  `npm link`ed installs then fail to execute it. This patch appends a `chmod +x` to
  `build:server`. Caused a production outage once already (claudecodeui#4, vikunja #188).
- **re-apply notes (v1.37.2):** **the build layout changed under this patch.** Upstream
  `0d517749` introduced stage-then-promote: `server/tsconfig.json` `outDir` is now
  `../dist-server.next`, `prebuild:server` cleans that staging dir, and a new
  `postbuild:server` runs `scripts/promote-dist-server.mjs`, which renames
  `dist-server` → `dist-server.old` then `dist-server.next` → `dist-server`.

  `tsc` therefore no longer writes `dist-server/...` at the time `build:server` runs. Left
  as written, the `chmod` would either fail the build outright or chmod the **stale live
  copy** that promote is about to replace with a fresh mode-644 file — a silent regression
  of a patch that already has an outage behind it.

  The `chmod` now targets **`dist-server.next/server/modules/cli/cli.js`**, at the end of
  `build:server`, after the alias check. `fs.rename` preserves modes, so the promoted
  `cli.js` arrives executable. Verified below at the promoted artefact, not the staged one.

  `bin.cloudcli` is `dist-server/server/modules/cli/cli.js` — **unchanged** between
  `v1.37.0` and `v1.37.2`, so `sudo npm link` was *not* needed for this sync (confirmed:
  `readlink -f /usr/bin/cloudcli` resolves to an existing executable after rebuild). It
  moved once before; keep reading it from `package.json` rather than hardcoding it.
- **probe:**
  ```
  # Static (tag-level) — exits 0 if upstream's own build:server does the chmod:
  git show <ref>:package.json | \
    python3 -c "import json,sys; sys.exit(0 if 'chmod' in json.load(sys.stdin)['scripts'].get('build:server','') else 1)"
  # 2026-08-19: v1.37.2 -> exit 1 (fork-only), forge-local -> exit 0. Discriminates.

  # Runtime (authoritative) — build clean and check the artefact's actual mode, not the
  # script source (the whole point is that source intent and build output diverge).
  # Read the bin path from package.json rather than hardcoding it — it has moved once.
  # Must be checked on the PROMOTED dist-server, i.e. after postbuild:server, since the
  # chmod is applied to the staging dir and only survives if rename preserves the mode:
  npm run build >/dev/null && \
    test -x "$(python3 -c "import json;print(json.load(open('package.json'))['bin']['cloudcli'])")"
  ```
- **last-verified:** `v1.37.2` on 2026-08-19 — runtime probe PASSED: after a clean
  `npm run build`, the promoted `dist-server/server/modules/cli/cli.js` is `-rwxr-xr-x`,
  `dist-server.next` and `dist-server.old` are both gone, and `/usr/bin/cloudcli` resolves
  to that executable.

## verify-server-aliases

- **status:** fork-only
- **commits:** `b7a86b71` (original), `50d3d001` (rebase onto v1.37.2)
- **upstream-pr:** none
- **files:** `scripts/verify-server-aliases.js`, `package.json` (`build:server`)
- **why:** `server/tsconfig.json` maps `@/*` → `server/*`, but Node has no package named
  `@` — any `@/...` import that `tsc-alias` fails to rewrite crashes the server at
  require-time with `Cannot find package '@/shared'`, invisible until the process starts.
  This walks the built server tree and fails the build loudly if any survive. (CloudCLI
  went down this way on 2026-07-18.) Upstream has no equivalent check at `v1.37.2`.
- **re-apply notes (v1.37.2):** **this patch changed shape.** It previously occupied
  `postbuild:server`, which upstream `0d517749` now claims for its promote step. Taking
  upstream's line would drop the alias check; keeping the fork's would drop the promotion
  and leave the server serving the previous build forever.

  Resolved by moving the check to the **end of `build:server`, against the staged
  `dist-server.next`**, and leaving `postbuild:server` as upstream's promote step
  untouched. This removes the conflict *and* is strictly better than the arrangement it
  replaces: an unresolved alias now aborts the build **before** promotion, so a bad build
  never reaches the live `dist-server`. The old placement verified a build that was
  already live — verification at the wrong layer, which is the failure class the sync
  skill exists to prevent.

  `scripts/verify-server-aliases.js` accordingly takes the directory to check as an
  optional argument (defaulting to `dist-server`, so any existing invocation keeps
  working) and **exits 1 with a clear message if that directory does not exist** — a check
  that silently passes over a build that was never produced is worse than no check.
- **known gap (vikunja #305 / id 316):** the pattern is
  `/(?:from|require\()\s*['"]@\//`, which catches the `from` and `require(` shapes but
  **misses** bare side-effect imports (`import '@/x.js'`) and dynamic imports
  (`import('@/x.js')`). Verified by injecting each shape into a built tree. Not fixed
  here — out of scope, tracked separately.
- **probe:**
  ```
  # Static (tag-level) — exits 0 once upstream ships its own alias VERIFICATION step.
  # Note the exclusion: `tsc-alias` is the tool that performs the rewrite, not a check
  # that it worked. Matching it would be the same class of bug as the old probe below.
  git show <ref>:package.json | python3 -c "
  import json,re,sys
  s=json.load(sys.stdin)['scripts']
  pat=re.compile(r'(verify|check|assert|guard)[-_a-z]*alias|alias[-_a-z]*(verify|check)', re.I)
  sys.exit(0 if any(pat.search(v.replace('tsc-alias','')) for v in s.values()) else 1)"
  # 2026-08-19: v1.37.2 -> exit 1 (fork-only), forge-local -> exit 0. Discriminates.

  # Runtime (authoritative) — assert no unresolved alias survives a clean build:
  npm run build:server >/dev/null && node scripts/verify-server-aliases.js dist-server

  # Negative control — the check must be able to FAIL:
  #   append `import x from '@/shared/nope.js';` to a built .js file → exit 1
  # Use the `from` shape specifically; bare and dynamic imports are not caught (#305).

  # Layer control — the check must abort the build BEFORE promotion. Inject the bad
  # import into dist-server.next mid-chain, run `npm run build`, and assert:
  #   npm exits non-zero, dist-server.next is left behind (not promoted),
  #   and the live dist-server is byte-identical (same inode, same mtime).

  # Missing-directory control:
  node scripts/verify-server-aliases.js dist-server.doesnotexist   → exit 1
  ```
- **⚠ the previous probe produced a FALSE PASS at `v1.37.2` — do not restore it.** It was
  `git show <tag>:package.json | grep -q postbuild:server`, which asserts a *script slot*
  rather than a behaviour. Upstream added a `postbuild:server` in `0d517749` that promotes
  a staged build and has nothing to do with alias verification, so the old probe exits 0
  against `v1.37.2` and reads as "upstream covers this" for a patch that is entirely
  fork-only. Re-confirmed on 2026-08-19: old probe → exit 0 against **both** refs, i.e.
  it no longer discriminates at all. Had this sync trusted it, the patch would have been
  dropped silently and the next unresolved alias would have taken CloudCLI down again.
  This is the probe rule "assert behaviour, never a symbol or file name" failing in
  production; the replacement above asserts an alias *verification* construct and
  explicitly excludes `tsc-alias`.
- **last-verified:** `v1.37.2` on 2026-08-19 — runtime probe PASSED; negative control
  PASSED (exit 1 for the `from` shape), MISSED for bare/dynamic (see known gap);
  **layer control PASSED** — injected alias failed `npm run build` with exit 1,
  `postbuild:server` never ran, `dist-server.next` left behind, live `dist-server`
  unchanged at the same inode and mtime; missing-directory control PASSED (exit 1).

---

## Retired

## test-alias-resolution

- **status:** upstreamed
- **commits:** `e17739f7` (dropped during the v1.37.2 rebase)
- **upstream-pr:** [siteboon/claudecodeui#1084](https://github.com/siteboon/claudecodeui/pull/1084)
  — **merged** (confirmed via the API's `merged: true` boolean; its `state` is `closed`,
  which is ambiguous), landed as upstream commit `74d3f8ff`
- **files (at retirement):** `package.json` (`test` script)
- **why:** upstream `v1.37.0` added a real `test` script that could not load most of what
  it targeted. `server/tsconfig.json` maps `@/*` → `server/*` with `baseUrl: ".."`, and
  `node --import tsx --test` does not pick that up — tsx only honours tsconfig paths when
  pointed at the right config. Every server file importing `@/…` died at module load with
  `ERR_MODULE_NOT_FOUND`, so whole files failed and their subtests never ran. Measured on
  pristine `v1.37.0`: **75 discovered, 27 pass, 48 fail**; with
  `tsx --tsconfig server/tsconfig.json`: **277 discovered, 277 pass**.
- **absorbed by:** `v1.37.2`. Upstream's `test` script is now **character-identical** to
  the fork's:
  `tsx --tsconfig server/tsconfig.json --test "server/**/*.test.ts" "server/**/*.test.js"`.
  During the rebase the commit conflicted only because the fork's version predates
  upstream's `test:client` entry and would have deleted it — i.e. it contributed nothing
  but a regression. Skipped with `git rebase --skip`.
- **probe:**
  ```
  git show <ref>:package.json | \
    python3 -c "import json,sys; t=json.load(sys.stdin)['scripts'].get('test',''); sys.exit(0 if '--tsconfig' in t or 'tsconfig-paths' in t else 1)"
  # 2026-08-19: exit 0 against v1.37.2 → upstream covers it. Exits 1 against v1.37.0,
  # confirming it discriminates rather than trivially passing.
  ```
- **known adjacent issue (vikunja #306 / id 317):** with the aliases resolving,
  `server/modules/agent/tests/agent.routes.test.ts` is flaky under concurrency — passes
  standalone, intermittently fails in a full run. Upstream code, untouched by any fork
  patch. It did **not** fire during the v1.37.2 verification run (297/297 pass); treat a
  failure there as the known flake, not a sync regression.
- **last-verified:** `v1.37.2` on 2026-08-19 — full suite 297 discovered / 297 pass /
  0 fail on the rebased fork, using upstream's own test script.

## check-credentials-oauth-token

- **status:** upstreamed
- **commits:** `d2eb718`, `07b4dc26`, `3b48ba11`, `6ee65cc8`
- **upstream-pr:** [siteboon/claudecodeui#979](https://github.com/siteboon/claudecodeui/pull/979) (merged)
- **files (at retirement):** `server/modules/providers/list/claude/claude-auth.provider.ts`
- **why:** fork added a fallback check for `CLAUDE_CODE_OAUTH_TOKEN` in
  `checkCredentials()`, alongside a friendlier auth-status label. Upstream PR #979 landed
  the same check, including the accompanying test (`claude-auth.test.ts`).
- **probe:**
  ```
  git grep -q 'CLAUDE_CODE_OAUTH_TOKEN' <ref> -- \
    server/modules/providers/list/claude/claude-auth.provider.ts
  ```
- **absorbed by:** `v1.37.0`
- **last-verified:** `v1.37.2` on 2026-08-19 — still covered upstream; no fork exposure.

## jwt-refresh-ws-sse-idle

- **status:** superseded, then fully resolved upstream
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
  original. **But at `v1.37.0` the 60s clock-skew tolerance did not carry**: upstream's
  `isAuthTokenExpired` was a bare `Date.now() >= claims.expiresAt`, running inside
  `getStoredAuthToken()` — i.e. on every authenticated read, not just at WS close, making
  the regression more exposed than the original fork bug it fixed.
- **✅ Step 10 PR-candidate flag — CLOSED at this sync.**
  [siteboon/claudecodeui#1085](https://github.com/siteboon/claudecodeui/pull/1085) is
  **merged** (confirmed via `merged: true`), landed as upstream commit `f0dca2d5`.
  `v1.37.2` carries `export const TOKEN_EXPIRY_SKEW_MS = 60_000;` at
  `src/utils/api.js:49` and applies it at `:53`
  (`Date.now() >= claims.expiresAt + TOKEN_EXPIRY_SKEW_MS`). The regression this entry
  tracked no longer exists and there is **no remaining fork exposure** — nothing to
  re-apply, nothing left to file. This entry is now purely historical.
- **probe:**
  ```
  # Construct (exp-derived refresh + session-expiry event):
  git grep -q 'storeAuthToken' <ref> -- src/utils/api.js && \
  git grep -q 'getAuthTokenRefreshDelay' <ref> -- src/utils/api.js && \
  git grep -q 'expireAuthSession' <ref> -- src/utils/api.js

  # Clock-skew tolerance specifically — the property that was missing at v1.37.0.
  # This is the behavioural half; the construct probe above passes without it, which is
  # exactly how the regression hid in the first place. Keep both.
  git grep -q 'TOKEN_EXPIRY_SKEW_MS' <ref> -- src/utils/api.js
  ```
- **absorbed by:** `v1.37.0` (construct) and `v1.37.2` (clock-skew tolerance, PR #1085)
- **last-verified:** `v1.37.2` on 2026-08-19 — both probes exit 0 against `v1.37.2`.
  The skew probe exits 1 against `v1.37.0`, confirming it discriminates.
