# PATCHES.md — CloudCLI fork

Tracks patches this fork (`TadMSTR/claudecodeui`, branch `forge-local`) carries against
upstream `siteboon/claudecodeui`. See `~/.claude/skills/shared-fork-upstream-sync/SKILL.md`
for the format spec, probe rules, and sync procedure.

**This file must never reach a branch pushed to `origin` (siteboon/claudecodeui).**
`forge-local` only.

Last synced against: `v1.37.9` (`f86543fa`, published 2026-11-16). Previous base `v1.37.4`;
the pre-sync branch is kept as `archive/forge-local-1.37.4` (`48ad111d`) on `fork`.

**Re-applied onto `v1.37.9` on 2026-11-22, not rebased.** Both of the skill's re-apply
triggers fired:
- the diffstat is 359 files / +43994 −2764 (`v1.37.4..v1.37.9`);
- an anchor file moved: `claude-runtime.provider.js` became **`claude-runtime.provider.ts`**
  (upstream PR #1600, the server TS migration). The file is strictly typed now, so every
  fork hunk in it was ported with real types. No `@ts-nocheck`, no `any` casts.

`git merge-tree --write-tree v1.37.9 forge-local` with `7ff426ab` (the retired
`background-send-dialog`) reverted first reports **3** content conflicts. Without the revert
there are 10; the extra 7 are the dialog's own files.
- `claude-runtime.provider.ts`: argv guard and held-run hunks against the TS migration.
- `chat-websocket.service.ts`: the held-run docstring on `hasBackgroundWork`, next to
  upstream's new `steer` member.
- `claude-runtime-hold.test.ts`: upstream PR #1762 added a `stopHangs` switch to the same
  scripted-query stub the held-run tests extend. Both were kept.

The branch was cut from the tag and the kept commits were cherry-picked in their original
order:
1. the two build-script commits;
2. the argv guard, its hunks hand-ported into the `.ts` provider;
3. core dumps, baseline, plugin env, WS origin, the two allowedTools value-shape commits;
4. the three held-run commits, with conflicts resolved by hand and the held-run helpers typed;
5. one new patch, `viewer-secret-paths`, written at this sync for upstream PR #1622.

Dropped: `7ff426ab` and every `PATCHES.md`-only commit (this file was rewritten instead).
`git log --oneline v1.37.9..forge-local` shows only fork commits.

**Typecheck:** `npm run typecheck` reports 0 errors on clean `v1.37.9` and 0 on the fork.
The held-run port added one optional member to the structural `createQuery` return type in
`server/shared/types.ts` (`close?(): void`, the SDK `Query.close()`).

**Build and test surface:** `bin`, `engines` and the `build*` / `lint` / `test` /
`typecheck` scripts are identical between `v1.37.4` and `v1.37.9`. `bin.cloudcli` did not
move, so no `npm link` is needed. **The SDK pin moved `^0.3.165` → `^0.3.311`**, which is
the argv guard's re-open trigger (see its entry). Test counts on 2026-11-22, in the same
worktrees:

| | clean `v1.37.9` | fork (final, with `viewer-secret-paths`) |
|---|---|---|
| server (`npm test`) | 1061 tests, 1060 pass, 1 skip (2 of 3 runs; the third had one load flake) | 1127 tests, 1124 pass, 1 fail, 1 skip |
| client (`npm run test:client`) | 159 files, 1176 pass | 159 files, 1177 pass |
| `npm run lint` | — | exit 0, 0 errors, 147 warnings |

The fork's +66 server tests are its own. Every full-suite failure seen on the fork across
four runs is a load-sensitive upstream test that passes alone, in a file no fork commit
changes:
- `agent.routes.test.ts`, failing at file level with `Unable to deserialize cloned data`:
  the runner flake #306 (see Retired `test-alias-resolution`).
- `chat-side-question.test.ts`: two subtests time out or assert after a fixed 30 ms
  `settle()`. They run against a fake runtime and pass 5/5 alone. Clean `v1.37.9` showed the
  same class: its second full run had a `not ok` in the side-questions history route test.
- one webhook in-flight-cap count, once.

**`npm audit` (2026-11-22):** 80 advisories (9 critical, 37 high, 28 moderate, 6 low) on
both the fork and clean `v1.37.9`. The package set is the same and `package-lock.json` is
byte-identical, so the fork adds no dependency and no advisory. Production only
(`--omit=dev`): 54 (1 critical, `proxy-addr`; 28 high). The 1.37.0 baseline (2026-08-01) was
34 (0 critical, 17 high, 17 moderate).

**Upstream changes with a security bearing, measured at this sync.** Ted decides; recorded
here so the next sync knows the state.
- **PR #1622 (1.37.6): the file viewer reads any file under the workspace root.**
  `resolveReadablePath` (`server/modules/file-tree/file-tree.service.ts`) accepts any
  absolute path under `workspace.rootPath`, which is `WORKSPACES_ROOT`, which defaults to
  `os.homedir()` (`server/shared/utils.ts`). Forge does not set it. Measured through the
  real HTTP routes on a loopback scratch server built from this branch, with
  `WORKSPACES_ROOT` unset and status and byte count only:
  - `GET /api/file-tree/projects/:id/file` and `/files/content` both returned 200 and the
    full on-disk byte count for a file in each of `~/.secrets/`, `~/.claude-secrets/` and
    `~/.ssh/` (`config` and the private key).
  - `/etc/hostname`, outside the root, was refused with 403.
  - Also by design: the read-only roots (`READ_ONLY_ROOTS`) make all of `/tmp` and
    `~/.claude/projects` readable.

  The live service before this sync (`v1.37.4`) predates PR #1622. **Status: fixed by a
  new fork patch, `viewer-secret-paths`** (Ted's decision, 2026-11-22). The same probe
  against the patched build gives 403 for all four secret files and still 200 for
  ordinary files under home and `/tmp`.
- **PR #1609 (1.37.6): Settings can update a provider CLI.**
  `POST /api/providers/:provider/cli/update` runs `providerCliService.updateCli`
  (`server/modules/providers/services/provider-cli.service.ts`), e.g. `claude update`. The
  only gate is `IS_PLATFORM` (hosted mode); there is no setting or env var to turn it off
  on a self-hosted install. It bypasses `sysadmin-claude-code-update`. Separately,
  `POST /api/system/update` (present since before `v1.37.4`) runs `npm install -g
  @cloudcli-ai/cloudcli@latest`, which would replace this fork's `npm link` with the
  unpatched registry build. **Do not use either from the UI.**
- PR #1725 (1.37.8) and PR #1766 (1.37.9): MCP elicitation forms are shown rather than
  auto-declined, and `POST /api/agent` can pass `unattended: false` to keep them open.
  PR #1714 (1.37.8): an opt-in outbound webhook channel, left unconfigured (#1471).

**Probe exit convention:** every probe below exits **0 if and only if upstream covers the
patch**, so a passing probe means the entry can be retired. A failing probe means the
fork still needs to carry it. **Exit 2 means the probe's anchor is gone and the probe is
broken.** Never read a 2 as "covered". Prefer the three-state shape for any probe that
locates a construct by pattern.

**Run every probe in both directions.** A probe that fails against the branch that has
the patch is broken, not a result:

```
for REF in v1.37.9 forge-local; do echo "== $REF"; <probe>; echo "exit $?"; done
```

On 2026-11-22 all **eight** live probes read `1` against `v1.37.9` and `0` against
`sync/v1.37.9`. Every Retired probe, `background-send-dialog` included, reads `0` against
`v1.37.9`, so nothing upstream absorbed has regressed.

---

## argv-secret-guard

- **status:** fork-only
- **commits:** `75726bcc` (original), `cef19b6d` (v1.37.0), `7c4676cd` (v1.37.2),
  `6dacd820` (v1.37.3), `9f077e84` (v1.37.4), **`1a910d7b`** (hand-ported onto v1.37.9);
  value shapes `f2391b68` (was `a5e18dfb`) and `bd594bf1` (was `8db25684`)
- **upstream-pr:** none
- **files:** `server/shared/argv-secret-guard.js`,
  `server/shared/tests/argv-secret-guard.test.js`,
  `server/modules/providers/list/claude/claude-runtime.provider.ts` (**was `.js` until
  v1.37.4**), `.oxlintrc.json`
- **why:** `@anthropic-ai/claude-agent-sdk` serializes `options.mcpServers` and
  `options.allowedTools` inline into CLI flags (`--mcp-config`, `--allowedTools`) before
  spawning the `claude` binary. Any literal secret in those objects lands in the child's
  argv, readable via `/proc/<pid>/cmdline` by any process running as the same OS user. That
  breaks the isolation scoped-mcp's per-agent bearer design (SMCP-15) assumes. This patch
  moves MCP header secrets into the subprocess env behind a `${VAR}` placeholder, drops
  secret-shaped `allowedTools` entries, refuses to remember one, and runs a fail-open
  backstop over the argv-bound options. No upstream equivalent exists at `v1.37.9`.
- **re-apply notes (v1.37.9):** the provider is TypeScript now, so the hunks were
  hand-ported, not merged. The guard stays a `.js` module (`allowJs: true`, `checkJs:
  false` in `server/tsconfig.json`), imported as `@/shared/argv-secret-guard.js` like
  upstream's other `@/shared/*` imports. One placement changed deliberately: upstream added
  `sdkOptions.extraArgs = { …, 'replay-user-messages': null }` after `mcpServers`.
  `extraArgs` is argv-bound, so the backstop now sits **after** it rather than straight
  after `mcpServers`. Positions on `sync/v1.37.9`, re-measured by anchor:

  | Hunk | v1.37.3 | v1.37.4 | v1.37.9 |
  |---|---|---|---|
  | guard import (`@/shared/argv-secret-guard.js`) | 23–27 | 23–27 | **23–28** |
  | `scrubSecretAllowedTools` before `sdkOptions.allowedTools` | 274 | 279 | **488** |
  | `externalizeMcpSecrets(sdkOptions.mcpServers, sdkOptions.env)` | 794 | 1010 | **1534** |
  | `assertNoArgvSecrets(sdkOptions)` backstop | 804 | 1020 | **1551** |
  | `isSecretAllowedToolsEntry` on `rememberEntry` | 908 | 1124 | **1714** |

- **env-chain check (the silent-no-op risk):** `externalizeMcpSecrets` writes into
  `sdkOptions.env`, so the patch is worthless if that object is not what reaches the
  subprocess: it would build green, test green, and do nothing. Re-verified at `v1.37.9`
  on 2026-11-22:
  - `sdkOptions.env` is assigned exactly once, at **L445**, from `buildClaudeSdkEnv()`
    (L431). That returns a fresh object: `{ CLAUDE_CODE_ARTIFACT: '1',
    CLAUDE_CODE_ENTRYPOINT: 'claudecodeui', ...hostEnv, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS }`.
    `externalizeMcpSecrets` (L1534) writes into it after it is built.
  - Nothing reassigns `sdkOptions.env` after L445.
  - Both **`createQuery(`** call sites (**L1736**, and the hooks-failure retry at
    **L1750**) sit below the backstop at **L1551** and pass the same `sdkOptions` object.
    The retry only deletes `hooks` and rebuilds the prompt stream.
  - After the backstop, the argv-bound writes are the `rememberEntry` push at **L1717**,
    gated at **L1714**, and the `disallowedTools` filter, which only removes entries. The
    other post-backstop writes are callbacks that never reach argv: `hooks` (L1558),
    `onElicitation`, `canUseTool`.
  **Re-check all four bullets on every sync.**
- **lint registration:** the guard is listed in `.oxlintrc.json`'s `backend-shared-utils`
  element (`boundaries/no-unknown` is `"error"`). Lint probe, both directions, 2026-11-22:

  | State | `npm run lint` | errors | warnings |
  |---|---|---|---|
  | without the `.oxlintrc.json` entry | **exit 1** | 1 (`claude-runtime.provider.ts:28:8 boundaries(no-unknown)`) | 147 |
  | with it | **exit 0** | 0 | 147 |

  The two warning sets are identical when sorted and compared with `diff`. Lint output
  order varies between runs, so compare sorted. Upstream's backlog grew from 136.
- **probe:**
  ```
  # Static (tag-level). Exits 0 once upstream ships an equivalent scrub.
  git grep -qE 'externaliz(e|ing)McpSecrets|scrubArgvSecret|redactMcpHeader' <ref> -- \
      server/modules/providers/list/claude/claude-runtime.provider.ts
  # 2026-11-22: v1.37.9 -> exit 1, sync/v1.37.9 -> exit 0. Discriminates.
  # Negative control: the same probe on the old .js path exits 1 against BOTH refs,
  # because the file is gone, so a path that falls out of date reads "fork-only" rather
  # than "covered". Repath it whenever the provider moves.

  # Runtime (authoritative). Spawn a session through a bearer-token MCP server and
  # assert, presence/absence only (never print a value, vikunja #91 / id 99):
  #   grep -qF "$MCP_BEARER_TOKEN" /proc/<claude-cli-pid>/environ  -> MUST match
  #   grep -qF "$MCP_BEARER_TOKEN" /proc/<claude-cli-pid>/cmdline  -> must NOT match
  #   grep -qF '${CLOUDCLI_MCP_SECRET_0}' /proc/<claude-cli-pid>/cmdline -> MUST match
  # The placeholder assertion is the one that matters most: a guard that simply DROPPED
  # the header would pass the first two.

  # Unit coverage:
  npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/argv-secret-guard.test.js
  ```
- **audit disposition M1 / DH-04 (2026-08-01) — RE-OPENED by this sync.** The guard's
  security property also depends on the bundled `claude` CLI expanding `${VAR}` in MCP
  headers. That was proven empirically at SDK `^0.3.165` (2026-08-19, re-checked at the
  `v1.37.4` deploy), and the disposition named an SDK pin move as its only re-open
  trigger. **`v1.37.9` pins `^0.3.311`.** The runtime `/proc` probe after the restart is
  therefore the acceptance test for this build, not a formality: environ has the bearer,
  cmdline does not, cmdline has the placeholder, no environ value of 20+ characters
  appears in argv, and an MCP tool call succeeds over the placeholder.
- **allowedTools value shapes (carried, unchanged):** `VIKUNJA_TOKEN`, `BCRYPT_HASH`,
  `OPAQUE_ASSIGN` (vikunja #1112 / id 1195), then `PREFIXED_TOKEN`, `JWT`, `CRYPT_HASH` and
  the 40+ lowercase `OPAQUE_ASSIGN` branch (audit F-02, cloudcli-held-run-race-2026-10).
  **SECURITY[accepted] (F-05):** false positives fail closed (one permission prompt). Still
  missed by design: values of 31 or fewer hex characters, and `mysql -p<pw>`.
- **last-verified:** `v1.37.9` on 2026-11-22, **build-verified**. Static probe 1 / 0; unit
  test 23/23; under the recorded mutation (`externalizeMcpSecrets` returning early) it goes
  red, 3 of 23 failing (externalize, clobber-avoid, clean-after-externalize); lint probe
  1 → 0 with identical warnings; env chain re-measured above; typecheck 0 errors. **Not yet
  deploy-verified at SDK `^0.3.311`:** the `/proc` probe runs after the restart (deploy row 5).
- **previously verified:** `v1.37.4` on 2026-10-15, deploy-verified at SDK `^0.3.165` (the
  `/proc` probe passed all four assertions and MCP calls succeeded over the placeholder).

## plugin-env-passthrough

- **status:** fork-only
- **commits:** `4c30a9f9` (original), `f0225ec1` (re-apply onto v1.37.0),
  `85c78a79` (rebase onto v1.37.2), `94fb745e` (re-apply onto v1.37.3),
  `6c4a956a` (cherry-pick onto v1.37.4),
  **`7439a97f`** (cherry-pick onto v1.37.9)
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
  # 2026-09-10: v1.37.3 -> exit 1 (fork-only), forge-local -> exit 0. Discriminates.
  # 2026-10-15: v1.37.4 -> exit 1, forge-local -> exit 0. Still discriminates.
  # 2026-11-22: v1.37.9 -> exit 1, sync/v1.37.9 -> exit 0. Still discriminates.

  # Runtime (authoritative) — the fork's own coverage for this construct:
  tsx --tsconfig server/tsconfig.json --test \
      server/modules/plugins/tests/plugin-process.service.test.js
  # Plus the real signal: exercise the task-queue plugin's Approve/Cancel controls in the
  # UI (they fail closed without the secret), and confirm the startup log line
  #   [Plugins] "cloudcli-plugin-task-queue" granted env passthrough: …
  # appears, while a plugin requesting a non-allowlisted var is refused with a warning.
  ```
- **2026-08-27 (task-queue-plugin-repair-2026-08):** `CLOUDCLI_ORIGIN` added to
  `PLUGIN_ENV_ALLOWLIST`. It is not a secret — it is a name the host and its plugins must
  agree on, so that a plugin's WS upgrade allowlist contains the same value the proxy
  sends (see `plugin-ws-upstream-origin`). Adding a var here is still a reviewed host
  decision; the two-gate rule is unchanged, and the task-queue manifest declares
  `env:CLOUDCLI_ORIGIN` alongside it. The existing tests pick the allowlist entry to
  exercise via `[...PLUGIN_ENV_ALLOWLIST][0]` rather than by literal, so they cover the
  widened set without edit.
- **last-verified:** `v1.37.9` on 2026-11-22. Static probe 1 / 0; unit probe 9/9 and
  plugin-registry 6/6. Upstream changed `server/modules/plugins/` between `v1.37.4` and
  `v1.37.9` (a new `plugin-git.service.ts`, and small edits to `plugin-registry.service.ts`
  and `plugins.service.ts`), but the fork's commit cherry-picked without conflict. The
  startup-log signal (`granted env passthrough:` for task-queue) is deploy row 6.
- **previously verified:** `v1.37.4` on 2026-10-15, including the live startup line
  `[Plugins] "task-queue" granted env passthrough: TASK_QUEUE_API, CLOUDCLI_ORIGIN`.

## plugin-ws-upstream-origin

- **status:** fork-only
- **commits:** `71659dd6` (original, task-queue-plugin-repair-2026-08),
  `322dcd29` (re-apply onto v1.37.3), `048d1d91` (cherry-pick onto v1.37.4),
  **`74652510`** (cherry-pick onto v1.37.9)
- **upstream-pr:** none
- **files:** `server/modules/websocket/services/plugin-websocket-proxy.service.ts`,
  `server/modules/websocket/services/tests/plugin-websocket-proxy.service.test.js`
- **why:** `handlePluginWsProxy` opens the upstream leg with the `ws` client's defaults,
  and that client sends **no `Origin` header** unless one is passed explicitly. Any
  plugin that gates its `/ws` upgrade on `Origin` therefore sees an anonymous handshake
  from the one client it is meant to trust. The forge task-queue plugin's v0.4.0
  hardening did exactly that gate and 403'd every proxy connect from 2026-08-02 to
  2026-08-27 — 2239 `[Plugins] WS proxy error for "task-queue": Unexpected server
  response: 403` lines — with the tab reading `disconnected` throughout. This patch
  passes `origin: process.env.CLOUDCLI_ORIGIN || 'http://127.0.0.1:3001'` so the
  handshake is self-identifying. Paired with `plugin-env-passthrough` carrying
  `CLOUDCLI_ORIGIN`, both sides read one value and cannot disagree.
- **note on what the value means:** it names the proxy's own **loopback** leg, not how
  the operator browses. The browser's `Origin` reaches CloudCLI and stops there; the
  proxy dials `127.0.0.1:<ephemeral>` on a separate socket. A hostname here would
  describe a handshake that does not occur.
- **`||` not `??`:** an empty `CLOUDCLI_ORIGIN` must fall back to the default, not send
  an empty `Origin` — that would reintroduce the anonymous handshake. Covered by test.
- **probe:**
  ```
  # Static (tag-level) — exits 0 if upstream independently started sending an Origin
  # on the plugin proxy's upstream leg. Matched by construct, not by our env var name.
  git grep -qiE "origin: .*(process\.env|['\"]http)" <ref> \
      -- server/modules/websocket/services/plugin-websocket-proxy.service.ts
  # 2026-09-10: v1.37.3 -> exit 1 (fork-only), forge-local -> exit 0. Discriminates.
  # 2026-10-15: v1.37.4 -> exit 1, forge-local -> exit 0. Still discriminates.
  # 2026-11-22: v1.37.9 -> exit 1, sync/v1.37.9 -> exit 0. Still discriminates.

  # Runtime (authoritative) — boots a real upstream WS server and asserts on the Origin
  # header it actually received, i.e. through the real `new WebSocket(...)` call site:
  npx tsx --tsconfig server/tsconfig.json --test \
      server/modules/websocket/services/tests/plugin-websocket-proxy.service.test.js
  # Plus the real signal, after `pm2 restart cloudcli`:
  #   grep -c 'WS proxy error for "task-queue"' ~/.pm2/logs/cloudcli-error.log  # stops rising
  #   grep 'WS proxy connected to "task-queue"' ~/.pm2/logs/cloudcli-out.log | tail -1
  # and the Task Queue tab's badge reading `live`.
  ```
- **last-verified:** `v1.37.9` on 2026-11-22. Static probe 1 / 0; runtime probe 5/5. The
  proxy service is untouched upstream between `v1.37.4` and `v1.37.9`, so the pick was
  clean. The live signal (`WS proxy connected`, 0 `WS proxy error`) is deploy row 6.
- **previously verified:** `v1.37.4` on 2026-10-15, live: 0 `WS proxy error` lines since
  boot and the Task Queue badge read `live`.

## cli-exec-bit

- **status:** fork-only
- **commits:** `ed22b3a1` (original), `52141e2a` (re-apply onto v1.37.0),
  `fcd4feb3` (rebase onto v1.37.2), `bc9a19f7` (re-apply onto v1.37.3),
  `fb51b320` (cherry-pick onto v1.37.4),
  **`e4d71b20`** (cherry-pick onto v1.37.9)
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
  # 2026-09-10: v1.37.3 -> exit 1 (fork-only), forge-local -> exit 0. Discriminates.
  # 2026-10-15: v1.37.4 -> exit 1, forge-local -> exit 0. Still discriminates.
  # 2026-11-22: v1.37.9 -> exit 1, sync/v1.37.9 -> exit 0. Still discriminates.

  # Runtime (authoritative) — build clean and check the artefact's actual mode, not the
  # script source (the whole point is that source intent and build output diverge).
  # Read the bin path from package.json rather than hardcoding it — it has moved once.
  # Must be checked on the PROMOTED dist-server, i.e. after postbuild:server, since the
  # chmod is applied to the staging dir and only survives if rename preserves the mode:
  npm run build >/dev/null && \
    test -x "$(python3 -c "import json;print(json.load(open('package.json'))['bin']['cloudcli'])")"
  ```
- **last-verified:** `v1.37.9` on 2026-11-22. **Runtime probe passed** in the
  `sync/v1.37.9` worktree: after `npm run build`, the promoted
  `dist-server/server/modules/cli/cli.js` is `-rwxr-xr-x`, and `dist-server.next` and
  `dist-server.old` are both gone. Upstream's build scripts and `bin.cloudcli` are
  unchanged since `v1.37.4`, so no `npm link` is expected. Deploy row 3 confirms
  `readlink -f /usr/bin/cloudcli` in the live tree.
- **previously verified:** `v1.37.4` on 2026-10-15 (runtime probe passed; no `npm link` needed).

## verify-server-aliases

- **status:** fork-only
- **commits:** `b7a86b71` (original), `50d3d001` (rebase onto v1.37.2),
  `a36532d0` (re-apply onto v1.37.3), `8f914aa9` (cherry-pick onto v1.37.4),
  **`7393fd36`** (cherry-pick onto v1.37.9)
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
  # 2026-09-10: v1.37.3 -> exit 1 (fork-only), forge-local -> exit 0. Discriminates.
  # 2026-10-15: v1.37.4 -> exit 1, forge-local -> exit 0. Still discriminates.
  # 2026-11-22: v1.37.9 -> exit 1, sync/v1.37.9 -> exit 0. Still discriminates.

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
- **last-verified:** `v1.37.9` on 2026-11-22. **Runtime probe passed**, with the ordering
  read from the build log: `✓ No unresolved "@/" aliases in dist-server.next` (log L402)
  prints before `promote-dist-server.mjs` (L405). The missing-directory control was re-run
  and exits 1. The script is fork-added and unchanged, and the build surface is identical
  to `v1.37.4`, so the negative and layer controls carry over.
- **previously verified:** `v1.37.4` on 2026-10-15 (runtime probe passed, ordering confirmed).
---

## viewer-secret-paths

- **status:** fork-only (new at the v1.37.9 sync)
- **commits:** **`57734c48`** (2026-11-22)
- **upstream-pr:** none. An upstream PR would need to drop the forge paths (`.secrets`,
  `.claude-secrets`) and ask Ted first.
- **files:** `server/shared/secret-path-guard.ts` (new),
  `server/modules/file-tree/file-tree.service.ts`,
  `server/modules/file-tree/tests/file-tree-secret-paths.test.ts` (new), `.oxlintrc.json`
  (registers the guard in `backend-shared-utils`, next to `argv-secret-guard.js`)
- **why:** upstream PR #1622 (1.37.6) lets the file viewer read any absolute path under
  `WORKSPACES_ROOT`, which defaults to the home directory, and forge does not set it.
  Measured at this sync over HTTP, the viewer returned `~/.secrets`, `~/.claude-secrets` and
  `~/.ssh` files (including the private key) in full to any authenticated session. Ted chose
  a fork patch over a `WORKSPACES_ROOT` config change on 2026-11-22: it protects every
  workspace and does not depend on the launcher's env.
- **what it does:** `isSecretPath()` treats `~/.ssh`, `~/.gnupg`, `~/.secrets`,
  `~/.claude-secrets`, `~/.cloudcli` (this server's DB, which holds the JWT signing
  secret) and `~/.claude/.credentials.json` as protected. It compares the path as written
  and with symlinks resolved, on both the target and the root. A path that does not exist
  yet is resolved through its nearest existing ancestor. The file-tree service calls it
  (`refuseSecretPath`, 403 `SECRET_PATH`) after its own resolution on **every** path:
  - reads (`resolveReadablePath`: the read-only-root, workspace-root and project branches);
  - the folder browser and `createWorkspaceFolder`;
  - every write through `resolveWritablePath`: save, create, rename (both ends), delete and
    each upload destination. A project rooted at home cannot plant `~/.ssh/authorized_keys`.

  The roots are read from `os.homedir()` per call. **Not covered:** the project file tree
  listing still shows the *names* of entries inside a protected directory when a project
  is rooted at home; contents are refused.
- **probe:** three-state:
  ```
  f=server/modules/file-tree/file-tree.service.ts
  git show <ref>:$f 2>/dev/null | python3 -c "
  import re,sys
  s=sys.stdin.read()
  i=s.find('async function resolveReadablePath(')
  if not s or i<0: sys.exit(2)          # anchor gone: probe broken, NOT covered
  j=s.find('\n  }\n', i)
  if j<0: sys.exit(2)
  body=s[i:j]
  sys.exit(0 if re.search(r'secret|\.ssh|credential|deny|protected', body, re.I) else 1)"
  ```
  2026-11-22: `v1.37.9` → **1**, `sync/v1.37.9` → **0**. Negative controls: the three
  `refuseSecretPath` calls in `resolveReadablePath` removed → **1**; the function renamed →
  **2**. A match for `'.ssh'` across `server/` is **not** a usable probe: upstream's own
  `image-attachments.test.ts` already contains one. **This probe only reads the resolver's
  body.** If upstream adds its own protection elsewhere (in `resolvePathUnderRoots`, say),
  expect 1, and read the code before retiring.

  Runtime (authoritative): the viewer probe, against a loopback scratch server built from
  the branch, with `WORKSPACES_ROOT` unset. Status and byte count only:
  ```
  GET /api/file-tree/projects/<id>/file?filePath=<abs>          (and /files/content?path=<abs>)
    ~/.secrets/<f>, ~/.claude-secrets/<f>, ~/.ssh/config, ~/.ssh/id_ed25519  -> 403
    an ordinary file under home, a file under /tmp                           -> 200, full size
    /etc/hostname                                                            -> 403 (outside root)
  ```
- **tests:** 10 in `file-tree-secret-paths.test.ts`, over a scratch home with the real
  filesystem adapter: each protected path and its contents; a prefix sibling (`.sshfoo`)
  and `~/.claude/settings.json` stay allowed; a project symlink into `~/.ssh`, including a
  not-yet-created target; a protected directory that is itself a symlink; `HOME` read at
  call time; workspace-root reads, project-relative reads through a symlink, and a
  home-rooted project's read, save, create, delete and rename (files on disk checked
  unchanged); rename *to* `.secrets`; the browser. Mutations, both red: the guard disabled
  in `refuseSecretPath` → 5 of 10 fail; symlink resolution of the target dropped → 2 fail
  (the two symlink tests). The existing file-tree service and route suites pass unchanged.
- **last-verified:** `v1.37.9` on 2026-11-22. Probe 1 / 0 with controls; tests 10/10 and
  red under both mutations; runtime probe as above (all four secret targets 200 → 403, both
  controls still 200); typecheck 0 errors; lint 0 errors, 147 warnings (unchanged).

## held-run-relay-turn

- **status:** fork-only (upstream PR closed unmerged; race re-proven on clean `v1.37.9`)
- **commits:** `f8fd78a1` / `ab96b028` (v1.37.4); **`61bbc72b`** and **`2c5b2099`**
  (re-applied onto v1.37.9, conflicts resolved by hand and the helpers typed)
- **upstream-pr:** [siteboon/claudecodeui#1584](https://github.com/siteboon/claudecodeui/pull/1584),
  **closed unmerged 2026-10-31**, with no maintainer comment. The companion #1585 was
  closed the same minute: *"repro steps didn't replicate"*. A clean-`v1.37.9` repro comment
  is drafted in the build-plan directory and has not been posted (Ted decides).
- **files:** `server/modules/providers/list/claude/claude-runtime.provider.ts` (**was
  `.js`**), `server/modules/providers/services/provider-runtime.service.ts`,
  `server/shared/interfaces.ts`, `server/shared/types.ts` (`close?(): void` on the
  `createQuery` return type), docstrings in `scheduled-message-dispatcher.service.ts` and
  `chat-websocket.service.ts`, tests in `claude-runtime-hold.test.ts` and
  `provider-runtime.service.test.ts`
- **why:** vikunja #1115 (id 1198). A held process releases on the `result` of the turn
  that relays its last task, but between the settle and that `result` neither
  `isProcessing` nor `hasBackgroundWork` is true. The dispatcher (30 s poll) or a direct
  send then takes the session over mid-relay.
- **Phase 2 re-test on clean `v1.37.9` (2026-11-22): the race still happens.** Run against
  an unpatched `v1.37.9` scratch server (loopback, own DB), driven over HTTP/WS exactly as
  in the PR comment: `sleep 120` in the background, four `sleep 12` in the relay, then
  Queue (`POST /api/user/drafts/queued-message`). Sampled every 2 s. One run:
  - the dispatcher claimed the queued message **17 s into the relay** (a poll tick);
  - the takeover interrupted the relay: the second `sleep 12` was rejected after 1 s
    (*"Request interrupted by user for tool use"*), and the other two never ran;
  - 2 `claude` processes for the session in one sample, 0 transcript forks.

  **The symptom changed since `v1.37.4`; the race did not.** Then, the old turn ran next to
  the new one (two processes, a forked transcript). Now the old turn is cut short, so the
  relay's work is lost. The queued message was still sent *while*, not *when*, the work
  finished. Upstream PR #1697 (dispatch on `onRunSettled`) does not cover it, because the
  relay turn is not a run in `chat-run-registry`. PR #1763 and PR #1634 change who
  dispatches, not whether the session reads busy. **Verdict: carry.**
- **fix (unchanged in behaviour):**
  - Per-session `heldTurns` (now `Map<string, HeldTurn>`): set at a non-`stopped` settle,
    or at main-thread traffic while held. Cleared at `result` or process exit.
  - `hasActiveHeldTurn` is ORed into `providerRuntimeService.hasBackgroundWork`, which
    covers the dispatcher's `isSessionBusy`, the retention guard and the subscribe attach.
  - `queryClaudeSDK` awaits `waitForHeldTurn()` before `releaseHeldSession()`. It waits
    120 s by default (`CLAUDE_HELD_TURN_WAIT_MS`, clamped to [1 s, 2³¹−1 ms]), then sends
    `interrupt()` while stdin is still open, then `close()` after 10 s, then waits up to 6 s
    for the exit.
  - `releaseHeldSession(sessionId, { interrupt })` interrupts the held process before it
    stops the tasks and ends stdin, unless the wait already did.
  - `addSession` interrupts before it releases. This only helps supersedes that skip
    `releaseHeldSession` (audit F-01).
  - Known gap, unchanged: when a held turn ends, nothing fires the dispatcher, so a message
    queued behind a relay goes on the next 30 s poll. Upstream's `onRunSettled` fires only
    for registry runs.
- **probe:** three-state. **Fixed 2026-11-22:** the anchor had been
  `releaseHeldSession(sessionKey())`, which audit follow-up `ab96b028` broke on 2026-10-15
  by adding an options argument, so the probe exited 2 against `forge-local` itself from
  then until this sync.
  ```
  f=server/modules/providers/list/claude/claude-runtime.provider.ts
  git show <ref>:$f 2>/dev/null | python3 -c "
  import re,sys
  s=sys.stdin.read()
  i=s.find('async function queryClaudeSDK(')
  j=s.find('releaseHeldSession(sessionKey()', i) if i>=0 else -1   # no closing paren
  if not s or i<0 or j<0: sys.exit(2)      # anchor gone: probe broken, NOT covered
  pre=s[max(i,j-600):j]
  sys.exit(0 if re.search(r'\\bawait\\b', pre) else 1)"
  ```
  2026-11-22: `v1.37.9` → **1**, `sync/v1.37.9` → **0**. Negative controls on the patched
  file: the `await waitForHeldTurn` line removed → **1**; the call renamed → **2**. The old
  anchor reads **2** against both refs. **The probe only asks whether *something* is awaited
  before the release.** If upstream ships "deliver, don't respawn", expect 1 or 2 and read
  the code before retiring.
- **tests:** 7 runtime tests, 3 audit follow-up tests and 1 service test, all carried.
  Each was seen red under a recorded mutation at `v1.37.4`; the test bodies are unchanged.
  Upstream PR #1762's stop-task tests share the stub, which now has both `stopHangs` and
  `calls` / `onInterrupt` / `onClose`. `claude-runtime-hold.test.ts` plus
  `provider-runtime.service.test.ts` plus `sessions.service.test.ts`: **38/38** on
  `sync/v1.37.9`.
- **last-verified:** `v1.37.9` on 2026-11-22, build-verified. Probe 1 / 0 with controls;
  tests green; typecheck 0 errors. Live acceptance is deploy row 7.
- **previously verified:** `v1.37.4`, deployed and accepted 2026-10-15 (restarts 15:11:19
  and 16:29:33). Queue across a forced ~56 s relay: delivered after the relay's `result`,
  at most 1 process per 2 s sample, 0 forks.

## running-sessions-single-entry

- **status:** fork-only (upstream PR closed unmerged; duplicate re-proven on clean `v1.37.9`)
- **commits:** `666a9851` (v1.37.4); **`e041480d`** (clean cherry-pick onto v1.37.9)
- **upstream-pr:** [siteboon/claudecodeui#1585](https://github.com/siteboon/claudecodeui/pull/1585),
  **closed unmerged 2026-10-31**: *"Closed as repro steps didn't replicate the issue
  mentioned."* A clean-`v1.37.9` repro comment is drafted, not posted.
- **files:** `server/modules/providers/services/sessions.service.ts`,
  `server/modules/providers/services/claude-cli-liveness.service.ts` (adds `pid` to the live
  entry, for the log line), `server/modules/providers/tests/sessions.service.test.ts`,
  `src/shared/tests/backgroundSessionActivity.test.tsx`
- **why:** vikunja #1116 (id 1199). Background-only entries were not recorded in
  `runningById`, so a `busy` CLI liveness file added a second entry for the same session,
  without `background` or `tasks`. The client keeps the last entry per id, so which state
  the composer sees depends on array order.
- **Phase 2 re-test on clean `v1.37.9` (2026-11-22): the duplicate still happens.** The PR's
  repro exactly as written (`sleep 20` + `sleep 300`, three `sleep 10` in the relay),
  polling `GET /api/providers/sessions/running` every 2 s: **17 consecutive samples (about
  34 s)** with the session listed twice, `{background: true, tasks: 1}` and
  `{background: false, tasks: 0}`. The relay run above showed the same pair for 5 samples.
  The repro needs a task still outstanding while the CLI reads `busy`. That is likely why
  upstream could not reproduce it with a single short task. **Verdict: carry.**
- **fix:** record background entries in `runningById`. A `busy` CLI upgrades the background
  entry in place to processing with tasks. A CLI that is not busy leaves it as background.
  `console.warn` with session id, pid and task count when the upgrade fires.
- **probe:** three-state:
  ```
  f=server/modules/providers/services/sessions.service.ts
  git show <ref>:$f 2>/dev/null | python3 -c "
  import sys
  s=sys.stdin.read()
  i=s.find('async listRunningSessions(')
  a=s.find('listBackgroundWork', i) if i>=0 else -1
  b=s.find('listBusyClaudeCliSessions()', a) if a>=0 else -1
  if not s or i<0 or a<0 or b<0: sys.exit(2)
  sys.exit(0 if 'runningById.set(' in s[a:b] else 1)"
  ```
  2026-11-22: `v1.37.9` → **1**, `sync/v1.37.9` → **0**. Negative controls: the
  `runningById.set` line removed → **1**; `listBusyClaudeCliSessions()` renamed → **2**.
- **last-verified:** `v1.37.9` on 2026-11-22, build-verified (probe 1 / 0 with controls;
  server tests green; client 1177 = upstream's 1176 + this patch's 1).
- **previously verified:** `v1.37.4`, deployed and accepted 2026-10-15: exactly one entry
  per session in about 600 samples. **Exception, #1117 (id 1200):** a process spawned by
  Send anyway reads registry `busy` for its whole next wait, so the session lists as
  processing. That fails safe (the client queues). The cause is not yet known.

---

## Retired

## background-send-dialog

- **status:** upstreamed
- **commits (at retirement):** `7ff426ab` on `forge-local` (cherry-pick of upstream branch
  `d3adf7a7`), **not carried onto `v1.37.9`**
- **upstream-pr:** [siteboon/claudecodeui#1583](https://github.com/siteboon/claudecodeui/pull/1583),
  `merged: true` (2026-10-16), first released in **`v1.37.5`**
- **files (at retirement):** `src/modules/chat/hooks/useChatComposerState.ts`,
  `src/modules/chat/composer/BackgroundSendDialog.tsx` and their tests, i18n
- **why it existed:** vikunja #1114 (id 1197). After a turn ended with background work
  still running, sending offered only a `window.confirm` with OK focused, so a second
  Enter killed the work. The patch added a Send anyway / Queue / Cancel dialog.
- **absorbed by:** upstream's own copy of the PR. By `v1.37.8` upstream had grown it well
  past the fork's version (`useChatComposerState.ts` +569 −72 against `forge-local`), so
  the drop took upstream's code as it is. Dropping it removed 7 of the 10 merge conflicts.
- **probe:** three-state, auth-verify shape (unchanged):
  ```
  f=src/modules/chat/hooks/useChatComposerState.ts
  git show <ref>:$f 2>/dev/null | python3 -c "
  import re,sys
  s=sys.stdin.read()
  i=s.find('ownBackgroundTasks(')
  if not s or i<0: sys.exit(2)
  block=s[i:i+2500]
  if 'window.confirm' in block: sys.exit(1)
  if re.search(r\"['\\\"]queue['\\\"]\", block): sys.exit(0)
  sys.exit(2)"
  ```
- **last-verified:** `v1.37.9` on 2026-11-22. Probe exit 0, covered upstream.

## auth-verify-once-per-mount

- **status:** superseded (retired at the `v1.37.4` sync, 2026-10-15)
- **commits:** `09f62510` (carried onto v1.37.3, 2026-09-10). **Dropped at `v1.37.4`.**
  Its docs commit `bedbcd41` was dropped with it, and this record replaces it.
- **absorbed by:** `v1.37.4`, via upstream
  [#1408](https://github.com/siteboon/claudecodeui/pull/1408) `dc7cb6c6`
  ("stop token refreshes and language changes from remounting the app"), **merged**
  2026-09-28 (`merged: true` read from the API, not `state`). Upstream's `checkAuthStatus`
  deps are now `[checkOnboardingStatus, clearSession]`. It reads the stored token at run
  time and reads `t` through `tRef` (`AuthContext.tsx:192-240` at `v1.37.4`). That is the
  same fix reached a different way, and it **goes further**: a language change no longer
  rebuilds the callback either.
- **retirement proof (2026-10-15). Behaviour was tested, not taken from the static probe:**

  | Check | Ref | Result |
  |---|---|---|
  | static probe | `v1.37.4` | exit **0** (covered) |
  | static probe | `forge-local` (old) | exit 0 |
  | this patch's regression test, copied onto pristine upstream | `v1.37.4` worktree | **2/2 pass, 1 verify per mount** |
  | same test, `token` put back into upstream's `checkAuthStatus` deps | `v1.37.4` worktree, mutated | **2/2 fail**, "expected exactly one session verification, got 11" |

  The mutation row matters. It shows the test still discriminates against *upstream's*
  code rather than passing vacuously, so upstream's fix is not the "superseded but weaker"
  case (skill Step 10). There is nothing to file upstream.
- **upstream-pr:** [siteboon/claudecodeui#1310](https://github.com/siteboon/claudecodeui/pull/1310)
  is open and unmerged, and #1408 supersedes it. Commenting on and closing it is Ted's call
  (#1109 Phase 4). **History:** #1310 was a resubmission of
  [#1177](https://github.com/siteboon/claudecodeui/pull/1177), which was **closed unmerged**
  on 2026-09-07 with *"I think this is not reproducible on latest main."*
- **files:** `src/modules/auth/context/AuthContext.tsx`,
  `src/modules/auth/tests/authVerificationReentrancy.test.tsx`
- **why:** `checkAuthStatus` lists `token` in its dependency array and the mount effect
  depends on `checkAuthStatus`, so every `X-Refreshed-Token` reissue rebuilds the callback,
  re-runs the effect and re-verifies the session — three more authenticated requests, which
  can refresh again. **This is the first fork patch carried for a defect measured on this
  deployment rather than one found by reading code.**

  | Episode | Cycles | Rate | Version |
  |---|---|---|---|
  | 04:54–05:05 | ~5,300 | ~800/min | `v1.37.2` |
  | 10:31–10:46 | **11,542** | peak 1,167/min, **48 in one second** | `v1.37.3` |

  Both start immediately after a restart and decay without stopping. The earlier episode
  **predates the v1.37.3 sync**, so the sync did not introduce it.
- **why the rate matters (this is what identifies the mechanism):** the client's `onclose`
  path retries on a **fixed 3000ms** timer (`WebSocketContext.tsx:113-116`), capping at
  0.33 cycles/sec — 11,542 cycles that way would take 9.6 hours, not 15 minutes. The
  amplifier is **`WebSocketContext.tsx:126`**, where `connect`'s deps are
  `[dispatch, isAuthLoading, token, user]` and the effect at `:159` depends on `connect`.
  A `token` *or* `user` identity change reopens the socket **immediately**. The auth loop
  supplies both every pass — `setToken()` from the refreshed header, and `setUser()` with a
  freshly parsed object, a new identity each time. Render speed, not timer speed.

  vikunja#417 attributes the storm to event-loop stalls missing the heartbeat. That path
  exists, but it cannot produce this rate; see the ticket comment of 2026-09-10.
- **deliberately NOT included:** narrowing `WebSocketContext.tsx:126`'s dependency array.
  That would address the amplifier as well as the trigger, but it is outside #1310's scope,
  unreviewed upstream, and removing the trigger is sufficient to stop the storm. Widening
  the fork's diff beyond the PR it mirrors would also make the retirement below messier.
- **deploy note:** client-only. Applies with `npm run build:client` plus a browser
  hard-refresh — **no service restart required**, which is why it could ship without one.
- **probe:**
  ```
  # Exit 0 iff upstream no longer lists `token` in checkAuthStatus's deps.
  # Anchored on the following mount effect rather than a line number, and FAILS CLOSED:
  # exit 2 means the anchor is gone and the probe is broken — never read that as covered.
  git show <ref>:src/modules/auth/context/AuthContext.tsx | python3 -c "
  import re,sys
  s=sys.stdin.read()
  m=re.search(r'\}, \[([^\]]*)\]\);\s*\n(?:\s*//[^\n]*\n)*\s*useEffect\(\(\) => \{\s*\n\s*if \(IS_PLATFORM\)', s)
  if not m: sys.exit(2)
  deps=[d.strip() for d in m.group(1).split(',')]
  sys.exit(1 if 'token' in deps else 0)"
  # 2026-09-10: v1.37.3 -> 1, origin/main -> 1, forge-local -> 0. Discriminates.
  # Negative control: anchor deliberately mangled -> exit 2 (BROKEN), not 0. Verified.

  # Runtime (authoritative) — the regression test carried with the patch:
  npx vitest run src/modules/auth/tests/authVerificationReentrancy.test.tsx
  # Demonstrated to discriminate, not asserted: 1 request/mount with the fix,
  # 11 with `token` restored to the dep array (budget-capped so it fails with a
  # count instead of hanging).

  # Live signal, after a restart — the thing this patch exists for:
  #   grep -c 'WebSocket connection attempt' ~/.pm2/logs/cloudcli-out.log
  # must not climb by thousands in the minutes after boot. Quiet baseline is
  # single-digit connects per minute.
  ```
- **retirement clause (as written 2026-09-10):** when #1310 merges, the static probe flips
  to exit 0 on its own and this entry moves to Retired. **It flipped because of #1408, not
  #1310.** That is why the runtime test was run before the commit was dropped. Drop the commit at that sync — it will conflict, and it is
  redundant once upstream carries it.
- **last-verified:** `v1.37.9` on 2026-11-22. Probe exit 0, still covered upstream.
- **last-verified (as a live patch):** `v1.37.3` on 2026-09-10. The static probe discriminates in both
  directions and fails closed on a mangled anchor; runtime test 2/2 pass; full client suite
  57 files / 398 tests pass with the patch applied. **Live signal not yet confirmed** — it
  needs the next restart, since the storm only manifests on boot.
- **live signal, confirmed on upstream's fix (2026-10-15):** there were 5
  `WebSocket connection attempt` lines in the 24 minutes after the 11:25 boot, 2 of them at
  boot. The 2026-10-15 10:31 episode on `v1.37.3` + this patch had 11,542. The storm
  stays gone with the patch dropped.

## forge-fork-docs-block

- **status:** retired (deleted, not relocated)
- **commits (at retirement):** `0f3defdb`, `0e4be35e` — **not carried onto `v1.37.3`**
- **upstream-pr:** none — this was never upstreamable; it is forge prose
- **files (at retirement):** `docs/README.md` (upstream **deleted** at `v1.37.3`, README
  consolidation `d27062e` / `125a293`; no successor file)
- **why it existed:** an at-a-glance summary of the fork's patches for someone landing in
  the repo, with `PATCHES.md` named as the authoritative manifest.
- **why it is retired rather than relocated (decision, 2026-09-10):** three reasons, and
  the third is the one that decides it.
  1. It had **already drifted** — it listed four patches when there were five
     (`plugin-ws-upstream-origin`, added 2026-08-27, never reached it). A summary that
     silently disagrees with the manifest it points at is worse than no summary.
  2. It already declared `PATCHES.md` authoritative, so it duplicated a file that is
     kept current by the sync procedure itself.
  3. The only surviving relocation target is **root `README.md`** — a file that exists
     upstream and that a PR branch can plausibly touch. Putting forge-specific prose
     there creates a standing path for it to reach `origin`, which is the one thing this
     fork must never do. `git merge-tree` in fact tried exactly this relocation on its
     own via rename detection during the v1.37.3 measurement.
- **consequence:** `PATCHES.md` is now the single manifest, and it is fork-only by
  construction — it exists on no upstream path at all.
- **probe:** n/a by construction (fork-only documentation).
- **last-verified:** `v1.37.9` on 2026-11-22. `docs/README.md` is still absent at the tag.
- **last-verified:** `v1.37.4` on 2026-10-15. `docs/README.md` is still absent at the tag.
- **last-verified:** `v1.37.3` on 2026-09-10 — `docs/README.md` confirmed absent at the
  tag; root `README.md` on `forge-local` confirmed **byte-identical to upstream's**, i.e.
  the block was dropped rather than moved.

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
  # 2026-09-10: exit 0 against v1.37.3 → upstream covers it. Exits 1 against v1.37.0,
  # confirming it discriminates rather than trivially passing.
  ```
- **known adjacent issue (vikunja #306 / id 317):** with the aliases resolving,
  `server/modules/agent/tests/agent.routes.test.ts` is flaky under concurrency — passes
  standalone, intermittently fails in a full run. **It DID fire at the v1.37.3 sync, and
  was measured rather than assumed** (2026-09-10):

  | Run | Result |
  |---|---|
  | full suite on `forge-local`, 4 runs | fails 2/4 — `uncaughtException: Unable to deserialize cloned data due to invalid or unsupported version` |
  | that file standalone, 3 runs | 6/6 pass, every time |
  | **full suite on pristine `v1.37.3`, 4 runs** | **fails 1/4, same test, same error** |
  | fork patches touching `server/modules/agent/` | **none** |

  The pristine control is the point: it establishes the flake as upstream's, not the
  sync's, which "no fork patch touches it" only argues. Note the discovered-test count
  also varies run to run (446/448/449), so a bare pass count is not a stable signal
  here — read the named failure, not the total.
- **last-verified:** `v1.37.9` on 2026-11-22. Probe exit 0, still covered upstream.
- **last-verified:** `v1.37.4` on 2026-10-15. Probe exit 0, still covered, and `test` is
  unchanged. Full suite on the new `forge-local`: **651 tests, 650 pass, 0 fail, 1 skipped**.
  The skip is upstream's own: `codex app-server forks a real thread at a turn`, with "the
  committed Codex rollout fixture is not available". The `agent.routes` flake (#306) did
  not fire in this run. That is not evidence it is fixed; it fired 2 in 4 last time. Client
  suite (`npm run test:client`): **106 files, 730 tests, all pass**. Upstream's new
  `claude-runtime-hold.test.ts` (#1395) passes 6/6 when run alone, and its subtests appear
  in the full-suite log.
- **last-verified:** `v1.37.3` on 2026-09-10 — still covered upstream; `test` is
  unchanged from `v1.37.2`. Full suite on the re-applied fork: **448 discovered /
  447 pass / 1 skipped**, the only failure being the known flake below.

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
- **last-verified:** `v1.37.9` on 2026-11-22. Probe exit 0, still covered upstream.
- **last-verified:** `v1.37.4` on 2026-10-15. Probe exit 0, still covered upstream.
- **last-verified:** `v1.37.3` on 2026-09-10 — still covered upstream (probe exits 0;
  `claude-auth.provider.ts` did not move at #1206); no fork exposure.

## jwt-refresh-ws-sse-idle

- **status:** superseded, then fully resolved upstream
- **commits:** `7e88414`, `f6b6fe9c`, `dfd55590`, `daa950eb`, `bb6062c9`, `b8683abc`
- **upstream-pr:** [siteboon/claudecodeui#980](https://github.com/siteboon/claudecodeui/pull/980)
  (closed, unmerged — folded into
  [siteboon/claudecodeui#1037](https://github.com/siteboon/claudecodeui/pull/1037), merged)
- **files (at retirement):** `src/utils/api.js`, `src/contexts/WebSocketContext.tsx`
  — **both moved at `v1.37.3`** by upstream PR #1206 (client restructure). Now
  `src/shared/authToken.ts` (all four probe symbols), `src/shared/api.ts`, and
  `src/shared/context/WebSocketContext.tsx`. The probes below are repathed accordingly;
  left pointing at `src/utils/api.js` they would have silently found nothing and read as
  a regression at the next sync.
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
  # Path is src/shared/authToken.ts as of v1.37.3; was src/utils/api.js through v1.37.2.
  git grep -q 'storeAuthToken' <ref> -- src/shared/authToken.ts && \
  git grep -q 'getAuthTokenRefreshDelay' <ref> -- src/shared/authToken.ts && \
  git grep -q 'expireAuthSession' <ref> -- src/shared/authToken.ts

  # Clock-skew tolerance specifically — the property that was missing at v1.37.0.
  # This is the behavioural half; the construct probe above passes without it, which is
  # exactly how the regression hid in the first place. Keep both.
  git grep -q 'TOKEN_EXPIRY_SKEW_MS' <ref> -- src/shared/authToken.ts
  ```
- **absorbed by:** `v1.37.0` (construct) and `v1.37.2` (clock-skew tolerance, PR #1085)
- **last-verified:** `v1.37.9` on 2026-11-22. Probe exit 0, still covered upstream.
- **last-verified:** `v1.37.4` on 2026-10-15. Both probes (construct and `TOKEN_EXPIRY_SKEW_MS`) exit 0, still covered.
- **last-verified:** `v1.37.3` on 2026-09-10 — both probes exit 0 against `v1.37.3` at
  the repathed location; all four symbols confirmed present in `src/shared/authToken.ts`.
  The skew probe exits 1 against `v1.37.0`, confirming it still discriminates.
