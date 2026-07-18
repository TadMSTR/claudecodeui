/**
 * Argv secret guard (SMCP-41)
 *
 * Keeps live credentials out of the `claude` CLI's argv — and therefore out of
 * `ps aux` / `/proc/<pid>/cmdline`, which is readable by any process running as
 * the same OS user (the exact isolation scoped-mcp's per-agent bearer design,
 * SMCP-15, exists to guarantee).
 *
 * The @anthropic-ai/claude-agent-sdk serializes `options.mcpServers` inline into
 * `--mcp-config <json>` and `options.allowedTools` into `--allowedTools <csv>`.
 * Any literal secret in those objects lands in the child's command line.
 *
 * Both mitigations rely on a property verified against claude CLI 2.1.212: the
 * CLI expands `${VAR}` in MCP header values from its own process environment
 * even when the config arrives via inline `--mcp-config`, not only from a
 * `.mcp.json` file. So we can leave a `${VAR}` placeholder in argv and put the
 * real value in the subprocess env.
 *
 *   1. externalizeMcpSecrets  — move literal credential header values into the
 *      subprocess env, replace them with a `${VAR}` placeholder in the config.
 *   2. scrubSecretAllowedTools — drop permission entries carrying a secret-shaped
 *      literal (e.g. `Bash(PW="…":*)`) before they reach argv.
 *
 * assertNoArgvSecrets is a fail-open backstop: it logs loudly if a literal
 * secret somehow survives scrubbing, but never blocks a launch — a heuristic
 * edge case must not take down every agent's session.
 */

// Header names whose values are credentials by definition.
const KNOWN_AUTH_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'x-access-token',
  'x-secret',
  'secret',
  'cookie',
]);

// A contiguous run of secret-charset characters long enough to be a real token.
// The charset includes `/`, so MIME-type-shaped values (application/json,
// text/event-stream) also match on length — the digit gate below rejects those,
// since real tokens carry entropy (digits) and MIME types do not.
const SECRET_RUN = /[A-Za-z0-9+/=_-]{16,}/;
const HAS_DIGIT = /[0-9]/;

// A `${VAR}` placeholder — a value already using the safe env indirection.
const PLACEHOLDER = /\$\{[^}]+\}/;

// Credential-shaped `key=value` / `key:value` inside a permission pattern.
// Value must not begin with `$` (shell/env reference, not a literal secret).
const SECRET_KV =
  /\b(?:pw|pwd|pass(?:wd|word)?|secret|token|api[_-]?key|apikey|bearer|auth|credential|dsn)\b\s*[=:]\s*['"]?(?!\$)[^\s'")]{4,}/i;

// A long contiguous token wrapped in quotes — a secret value, not a tool name
// (MCP tool names are long but never quoted).
const QUOTED_SECRET = /['"][A-Za-z0-9+/=_-]{20,}['"]/;

// Literal `Bearer <token>` (but not `Bearer ${VAR}`).
const LITERAL_BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/;

// Literal secret assignment surviving into argv (but not `KEY=${VAR}`).
const LITERAL_ASSIGN =
  /[A-Za-z0-9_]*(?:TOKEN|PASSWORD|PASSWD|SECRET|APIKEY|API_KEY|BEARER|DSN)\s*[=:]\s*(?!\$\{)[^\s"']{8,}/i;

/**
 * True if an http-MCP header value carries a literal credential that must not
 * appear in argv. Values already using `${VAR}` indirection are left alone.
 * @param {string} name  Header name
 * @param {unknown} value Header value
 * @returns {boolean}
 */
function isSecretHeaderValue(name, value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (PLACEHOLDER.test(value)) return false; // already externalized / indirected
  if (KNOWN_AUTH_HEADERS.has(String(name).toLowerCase())) return true;
  const run = value.match(SECRET_RUN);
  return run !== null && HAS_DIGIT.test(run[0]);
}

/**
 * Move literal credential header values out of an mcpServers config object and
 * into `env`, leaving `${VAR}` placeholders behind. Mutates both `mcpServers`
 * and `env` in place.
 * @param {Record<string, any>} mcpServers SDK mcpServers option (mutated)
 * @param {Record<string, string>} env     Subprocess env (mutated)
 * @param {{ prefix?: string }} [opts]
 * @returns {{ externalized: Array<{ server: string, header: string, envVar: string }> }}
 */
function externalizeMcpSecrets(mcpServers, env, opts = {}) {
  const prefix = opts.prefix || 'CLOUDCLI_MCP_SECRET_';
  const externalized = [];
  if (!mcpServers || typeof mcpServers !== 'object') return { externalized };

  let counter = 0;
  const nextName = () => {
    let name;
    do {
      name = `${prefix}${counter++}`;
    } while (env && Object.prototype.hasOwnProperty.call(env, name));
    return name;
  };

  for (const [serverName, cfg] of Object.entries(mcpServers)) {
    if (!cfg || typeof cfg !== 'object') continue;
    const headers = cfg.headers;
    if (!headers || typeof headers !== 'object') continue;

    for (const [headerName, headerValue] of Object.entries(headers)) {
      if (!isSecretHeaderValue(headerName, headerValue)) continue;
      const varName = nextName();
      if (env) env[varName] = headerValue;
      // Literal `${varName}` placeholder the CLI expands from its own env.
      headers[headerName] = `\${${varName}}`;
      externalized.push({ server: serverName, header: headerName, envVar: varName });
    }
  }

  return { externalized };
}

/**
 * True if a permission (allowedTools) entry embeds a secret-shaped literal.
 * @param {unknown} entry
 * @returns {boolean}
 */
function isSecretAllowedToolsEntry(entry) {
  if (typeof entry !== 'string') return false;
  return SECRET_KV.test(entry) || QUOTED_SECRET.test(entry) || LITERAL_BEARER.test(entry);
}

/**
 * Partition allowedTools into entries safe to serialize and secret-shaped
 * entries that must be dropped before reaching argv.
 * @param {string[]} entries
 * @returns {{ kept: string[], dropped: string[] }}
 */
function scrubSecretAllowedTools(entries) {
  if (!Array.isArray(entries)) return { kept: [], dropped: [] };
  const kept = [];
  const dropped = [];
  for (const entry of entries) {
    if (isSecretAllowedToolsEntry(entry)) dropped.push(entry);
    else kept.push(entry);
  }
  return { kept, dropped };
}

/**
 * Scan the argv-bound SDK options for literal secret material that survived
 * scrubbing. Returns findings (never throws / never mutates).
 * @param {{ mcpServers?: any, allowedTools?: string[] }} sdkOptions
 * @returns {Array<{ where: string, kind: string }>}
 */
function findArgvSecrets(sdkOptions) {
  const findings = [];
  const mcpJson = sdkOptions && sdkOptions.mcpServers ? JSON.stringify(sdkOptions.mcpServers) : '';
  const toolsCsv = Array.isArray(sdkOptions && sdkOptions.allowedTools)
    ? sdkOptions.allowedTools.join(',')
    : '';
  for (const [where, text] of [['mcpServers', mcpJson], ['allowedTools', toolsCsv]]) {
    if (LITERAL_BEARER.test(text)) findings.push({ where, kind: 'bearer' });
    if (LITERAL_ASSIGN.test(text)) findings.push({ where, kind: 'assignment' });
  }
  return findings;
}

/**
 * Fail-open backstop. Logs loudly if a literal secret survived into the
 * argv-bound options but never blocks the launch.
 * @param {{ mcpServers?: any, allowedTools?: string[] }} sdkOptions
 * @param {{ error: (msg: string) => void }} [logger]
 * @returns {Array<{ where: string, kind: string }>}
 */
function assertNoArgvSecrets(sdkOptions, logger = console) {
  const findings = findArgvSecrets(sdkOptions);
  if (findings.length > 0) {
    logger.error(
      '[SMCP-41] argv secret guard: literal secret material still present after ' +
        'scrubbing — this indicates a bug in the guard. Launching anyway (fail-open). ' +
        `Findings: ${JSON.stringify(findings)}`
    );
  }
  return findings;
}

export {
  isSecretHeaderValue,
  externalizeMcpSecrets,
  isSecretAllowedToolsEntry,
  scrubSecretAllowedTools,
  findArgvSecrets,
  assertNoArgvSecrets,
};
