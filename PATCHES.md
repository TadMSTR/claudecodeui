# PATCHES.md — CloudCLI fork

Tracks patches this fork (`TadMSTR/claudecodeui`, branch `forge-local`) carries against
upstream `siteboon/claudecodeui`. See `~/.claude/skills/shared-fork-upstream-sync/SKILL.md`
for the format spec, probe rules, and sync procedure.

**This file must never reach a branch pushed to `origin` (siteboon/claudecodeui).**
`forge-local` only.

Last synced against: `v1.37.3` (previous base `v1.37.2` / merge-base `677b7ba4`).
**Re-applied onto `v1.37.3` on 2026-09-10 — a re-apply, not the rebase `v1.37.2` took.**
Upstream moved 734 files / +43530−15320, and upstream PR #1206 restructured the client
from `src/components/**` to `src/modules/**`. Both of the skill's Step 1 re-apply triggers
fired: the diffstat is far over the ~100-file threshold, and two manifest anchor files were
**deleted** (`eslint.config.js`, `docs/README.md`).

Measured before choosing, not predicted. `git merge-tree --write-tree v1.37.3 forge-local`
reported exactly **one** true conflict — `eslint.config.js` (modify/delete). It also
silently resolved `docs/README.md` into root `README.md` by rename detection, which is
precisely the outcome this fork does not want: it would move forge-specific prose into a
file that a PR branch might later carry to `origin`. That is the second reason a re-apply
was taken over a merge/rebase.

The seven fork commits were cherry-picked onto `v1.37.3` in order; `eslint.config.js` and
`docs/README.md` were dropped at pick time and handled explicitly (see `argv-secret-guard`
and the Retired `forge-fork-docs-block` entry).

**No fork patch touches `src/`**, so #1206's restructure cost this fork nothing beyond the
two deleted anchors.

**Probe exit convention:** every probe below exits **0 if and only if upstream covers the
patch** — i.e. a passing probe means the entry can be retired. A failing probe means the
fork still needs to carry it.

`auth-verify-once-per-mount` adds a third state: **exit 2 = the probe's anchor is gone and
the probe is broken.** Never read a 2 as "covered". Prefer this shape for any new probe
that locates a construct by pattern — the failure mode a two-state probe cannot express is
"upstream renamed the thing I was looking for", and that reads as a false retirement.

**Run every probe in both directions.** A probe that fails against `forge-local` — the
branch that demonstrably *has* the patch — is broken, not a result, and its "still
fork-only" verdict is worthless:

```
for REF in v1.37.3 forge-local; do echo "== $REF"; <probe>; echo "exit $?"; done
```

Both-direction results as of 2026-09-10 are recorded per entry. All **six** live probes
read `1` against `v1.37.3` and `0` against `forge-local`, which is the shape a valid
"still fork-only" verdict has.

---

## argv-secret-guard

- **status:** fork-only
- **commits:** `75726bcc` (original), `cef19b6d` (re-apply onto v1.37.0),
  `7c4676cd` (rebase onto v1.37.2), `6dacd820` (re-apply onto v1.37.3)
- **upstream-pr:** none
- **files:** `server/shared/argv-secret-guard.js`,
  `server/shared/tests/argv-secret-guard.test.js`,
  `server/modules/providers/list/claude/claude-runtime.provider.js`, `.oxlintrc.json`
  (was `eslint.config.js` until v1.37.3 — see the lint-registration note below)
- **why:** the `@anthropic-ai/claude-agent-sdk` serializes `options.mcpServers` and
  `options.allowedTools` inline into CLI flags (`--mcp-config`, `--allowedTools`) before
  spawning the `claude` binary. Any literal secret in those objects lands in the child's
  argv, readable via `/proc/<pid>/cmdline` by any process running as the same OS user —
  exactly the isolation scoped-mcp's per-agent bearer design (SMCP-15) assumes holds.
  This patch externalizes MCP header secrets into the subprocess env behind a `${VAR}`
  placeholder before the SDK options are built. No upstream equivalent exists as of
  `v1.37.3`.
- **re-apply notes (v1.37.3):** the three functional hunks in
  `claude-runtime.provider.js` cherry-picked **without conflict** — #1206 restructured
  `src/`, not `server/`. **Every line number moved anyway**, because upstream grew the
  file; do not trust line numbers across a sync, re-locate by anchor. Current positions
  on `forge-local`, re-measured 2026-09-10:

  | Hunk | v1.37.2 | v1.37.3 |
  |---|---|---|
  | guard import (`@/shared/argv-secret-guard.js`) | 23–27 | **23–27** |
  | `scrubSecretAllowedTools` before `sdkOptions.allowedTools` | 236 | **274** |
  | `externalizeMcpSecrets(sdkOptions.mcpServers, sdkOptions.env)` | 663 | **794** |
  | `assertNoArgvSecrets(sdkOptions)` backstop | 673 | **804** |
  | `isSecretAllowedToolsEntry` on `rememberEntry` | 770 | **908** |

- **env-chain check (the silent-no-op risk):** `externalizeMcpSecrets` writes into
  `sdkOptions.env`, so the patch is worthless if that object is not what reaches the
  subprocess — it would build green, test green, and do nothing. Re-verified end to end
  at `v1.37.3`:
  - `sdkOptions.env` is assigned exactly once, at **L231** (was L198 at `v1.37.2`).
    Upstream added a key to that object literal
    (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) — **merge into it, never overwrite it**.
    Upstream's own comment notes `options.env` *replaces* `process.env` as of SDK
    0.2.113; `package.json` still pins `^0.3.165` at `v1.37.3` — unchanged, so the audit
    disposition's re-open trigger below has **not** fired.
  - Nothing reassigns `sdkOptions.env` after L231; L794 only reads it as an argument.
  - There are still **two `query({ prompt, options: sdkOptions })` call sites** — L926
    and a hooks-failure retry at L939, both below the L804 backstop.
    Both pass the *same* `sdkOptions` object, and the
    retry only does `delete sdkOptions.hooks` and rebuilds the prompt stream; it touches
    neither `env` nor `mcpServers`. One `externalizeMcpSecrets` call therefore covers
    both, and the backstop is placed above both rather than beside the first.
  - The one write that lands *after* the backstop runs is the `rememberEntry` push at
    L911, gated by `isSecretAllowedToolsEntry` at L908. That is precisely why hunk 4
    exists — without it a secret-shaped entry could be
    persisted post-backstop and re-serialized into argv on the next launch.
  **Re-check all four bullets on every sync.**
- **lint registration — MOVED at `v1.37.3`, ported not retired.** Upstream deleted
  `eslint.config.js` in the eslint→oxlint migration (`lint` is now `oxlint src/ server/`).
  **`eslint-plugin-boundaries` survived it.** `.oxlintrc.json` loads the plugin through
  oxlint's JS plugin bridge (`jsPlugins[].specifier = "eslint-plugin-boundaries"`), keeps
  `server/**/*.js` in `boundaries/include`, and still sets `boundaries/no-unknown` to
  `"error"`. The registration therefore moves from `eslint.config.js`'s
  `backend-shared-utils` list to the **same element's `pattern` array in
  `.oxlintrc.json`**. `.oxlintrc.json` is JSONC — it has `//` comments and does not parse
  as strict JSON — so the fork's rationale comment carries over verbatim.

  **This is the hunk's probe now, and it was run in both directions on 2026-09-10:**

  | State | `npm run lint` | errors | warnings |
  |---|---|---|---|
  | without the `.oxlintrc.json` entry | **exit 1** | 1 | 132 |
  | with it | **exit 0** | 0 | 132 |

  The single error is
  `claude-runtime.provider.js:27:8 error boundaries(no-unknown)` — note it flags the
  **importer** for depending on an unclassified element, not the guard file itself. The
  warning count is identical on both sides, so the entry classifies exactly one file and
  suppresses nothing else. Upstream carries a 132-warning backlog; a bare exit code would
  not have told you which error was yours.
- **probe:**
  ```
  # Static (tag-level) — exits 0 once upstream ships an equivalent scrub.
  git grep -qE 'externaliz(e|ing)McpSecrets|scrubArgvSecret|redactMcpHeader' <ref> -- \
      server/modules/providers/list/claude/claude-runtime.provider.js
  # 2026-09-10: v1.37.3 -> exit 1 (fork-only), forge-local -> exit 0. Discriminates.
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
- **last-verified:** `v1.37.3` on 2026-09-10 — static probe discriminates in both
  directions (exit 1 / exit 0); unit probe 12/12 pass; **lint probe run in both
  directions**, 1 error → 0 errors with the warning count unchanged (table above); env
  chain re-measured at the new line numbers rather than carried forward; typecheck clean;
  SDK pin unchanged at `^0.3.165`.
  **Not re-run at this sync: the runtime `/proc` probe** — it requires a restarted service
  spawning a real `claude` child, and this build deliberately does not restart `cloudcli`.
  The v1.37.2 deploy-verification stands (the guard's three functional hunks are
  byte-identical), but this patch is **build-verified, not deploy-verified, at v1.37.3**.
  Re-run the `/proc` probe after Ted takes the restart.

## plugin-env-passthrough

- **status:** fork-only
- **commits:** `4c30a9f9` (original), `f0225ec1` (re-apply onto v1.37.0),
  `85c78a79` (rebase onto v1.37.2), `94fb745e` (re-apply onto v1.37.3)
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
- **last-verified:** `v1.37.3` on 2026-09-10 — static probe discriminates in both
  directions; unit probe 9/9 pass (plus plugin-registry 6/6); `server/modules/plugins/`
  cherry-picked with zero conflicts, untouched by #1206. **Startup-log signal not re-run
  at this sync** — it needs a restart, which this build defers to Ted.
  Previously confirmed live at `v1.37.2`:
  `[Plugins] "task-queue" granted env passthrough: TASK_QUEUE_API, TASK_QUEUE_API_SECRET`,
  followed by `[Plugins] Server started for "task-queue"`. The passthrough is reaching the
  subprocess on the real boot path, not just in tests. Re-verified 2026-08-27 with
  `CLOUDCLI_ORIGIN` present in the granted list.

## plugin-ws-upstream-origin

- **status:** fork-only
- **commits:** `71659dd6` (original, task-queue-plugin-repair-2026-08),
  `322dcd29` (re-apply onto v1.37.3)
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

  # Runtime (authoritative) — boots a real upstream WS server and asserts on the Origin
  # header it actually received, i.e. through the real `new WebSocket(...)` call site:
  npx tsx --tsconfig server/tsconfig.json --test \
      server/modules/websocket/services/tests/plugin-websocket-proxy.service.test.js
  # Plus the real signal, after `pm2 restart cloudcli`:
  #   grep -c 'WS proxy error for "task-queue"' ~/.pm2/logs/cloudcli-error.log  # stops rising
  #   grep 'WS proxy connected to "task-queue"' ~/.pm2/logs/cloudcli-out.log | tail -1
  # and the Task Queue tab's badge reading `live`.
  ```
- **last-verified:** `v1.37.3` on 2026-09-10 — static probe discriminates in both
  directions; runtime probe 5/5 pass; `server/modules/websocket/` untouched by #1206, so
  the patch cherry-picked clean. **Live signal (the 403 count ceasing to rise, the tab
  badge reading `live`) not re-checked** — it needs a restart, deferred to Ted. Mutation
  coverage carried from 2026-08-27; the test file is byte-identical.

## cli-exec-bit

- **status:** fork-only
- **commits:** `ed22b3a1` (original), `52141e2a` (re-apply onto v1.37.0),
  `fcd4feb3` (rebase onto v1.37.2), `bc9a19f7` (re-apply onto v1.37.3)
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

  # Runtime (authoritative) — build clean and check the artefact's actual mode, not the
  # script source (the whole point is that source intent and build output diverge).
  # Read the bin path from package.json rather than hardcoding it — it has moved once.
  # Must be checked on the PROMOTED dist-server, i.e. after postbuild:server, since the
  # chmod is applied to the staging dir and only survives if rename preserves the mode:
  npm run build >/dev/null && \
    test -x "$(python3 -c "import json;print(json.load(open('package.json'))['bin']['cloudcli'])")"
  ```
- **last-verified:** `v1.37.3` on 2026-09-10 — runtime probe PASSED. Upstream's
  `build:server`, `prebuild:server`, `postbuild:server` and `bin.cloudcli` are all
  **byte-identical** to `v1.37.2`, so the patch cherry-picked clean. After `npm run build`:
  the promoted `dist-server/server/modules/cli/cli.js` is `-rwxr-xr-x`, `dist-server.next`
  and `dist-server.old` are both gone, and `readlink -f /usr/bin/cloudcli` resolves to
  exactly that file. **No `sudo npm link` was needed** — `bin.cloudcli` did not move.

## verify-server-aliases

- **status:** fork-only
- **commits:** `b7a86b71` (original), `50d3d001` (rebase onto v1.37.2),
  `a36532d0` (re-apply onto v1.37.3)
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
- **last-verified:** `v1.37.3` on 2026-09-10 — runtime probe PASSED; negative control
  PASSED (exit 1 for the `from` shape), MISSED for bare/dynamic (see known gap);
  missing-directory control PASSED (exit 1). Both controls were run against a **copy** of
  `dist-server`, not the live one — `cloudcli` is serving from it and an injected bad
  import left behind by an interrupted run would be a live regression.
  **Reachability and ordering re-confirmed from the build log itself**, which is the
  property the layer control exists to establish: `✓ No unresolved "@/" aliases in
  dist-server.next` prints between `build:server` and `postbuild:server`, i.e. the check
  runs against the staged tree *before* promotion. The full mid-chain injection layer
  control was not re-run — it mutates a live build directory — and is carried from
  `v1.37.2`, where it passed against a byte-identical `build:server`.

## auth-verify-once-per-mount

- **status:** pending-PR
- **commits:** `09f62510` (carried onto v1.37.3, 2026-09-10)
- **upstream-pr:** [siteboon/claudecodeui#1310](https://github.com/siteboon/claudecodeui/pull/1310)
  — open, unmerged. Resubmission of
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
- **retirement:** when #1310 merges, the static probe flips to exit 0 on its own and this
  entry moves to Retired. Drop the commit at that sync — it will conflict, and it is
  redundant once upstream carries it.
- **last-verified:** `v1.37.3` on 2026-09-10 — static probe discriminates in both
  directions and fails closed on a mangled anchor; runtime test 2/2 pass; full client suite
  57 files / 398 tests pass with the patch applied. **Live signal not yet confirmed** — it
  needs the next restart, since the storm only manifests on boot.


---

## Retired

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
- **last-verified:** `v1.37.3` on 2026-09-10 — both probes exit 0 against `v1.37.3` at
  the repathed location; all four symbols confirmed present in `src/shared/authToken.ts`.
  The skew probe exits 1 against `v1.37.0`, confirming it still discriminates.
