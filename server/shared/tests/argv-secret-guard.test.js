import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSecretHeaderValue,
  externalizeMcpSecrets,
  isSecretAllowedToolsEntry,
  scrubSecretAllowedTools,
  findArgvSecrets,
  assertNoArgvSecrets,
} from '../argv-secret-guard.js';

// Synthetic fixture only — a 64-hex-shaped value with digits so it exercises
// the same detection path as a real scoped-mcp bearer token. NOT a real secret.
const SYNTHETIC_TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test('isSecretHeaderValue flags literal Authorization but skips ${VAR} placeholders', () => {
  assert.equal(isSecretHeaderValue('Authorization', `Bearer ${SYNTHETIC_TOKEN}`), true);
  assert.equal(isSecretHeaderValue('authorization', 'Bearer ${SCOPED_MCP_BEARER_TOKEN}'), false);
  assert.equal(isSecretHeaderValue('Content-Type', 'application/json'), false);
  assert.equal(isSecretHeaderValue('Accept', 'text/event-stream'), false);
  assert.equal(isSecretHeaderValue('X-Api-Key', SYNTHETIC_TOKEN), true);
  assert.equal(isSecretHeaderValue('Authorization', ''), false);
});

test('externalizeMcpSecrets moves the literal token to env and leaves a ${VAR} in the config', () => {
  const mcpServers = {
    'scoped-mcp': {
      type: 'http',
      url: 'http://127.0.0.1:8473/mcp',
      headers: { Authorization: `Bearer ${SYNTHETIC_TOKEN}` },
    },
  };
  const env = {};
  const { externalized } = externalizeMcpSecrets(mcpServers, env);

  assert.equal(externalized.length, 1);
  const varName = externalized[0].envVar;
  // Real value now lives only in env.
  assert.equal(env[varName], `Bearer ${SYNTHETIC_TOKEN}`);
  // Config carries the placeholder, no literal token.
  assert.equal(mcpServers['scoped-mcp'].headers.Authorization, `\${${varName}}`);
  const serialized = JSON.stringify(mcpServers);
  assert.ok(!serialized.includes(SYNTHETIC_TOKEN), 'no literal token in serialized config');
});

test('externalizeMcpSecrets avoids clobbering an existing env var name', () => {
  const mcpServers = { a: { headers: { Authorization: `Bearer ${SYNTHETIC_TOKEN}` } } };
  const env = { CLOUDCLI_MCP_SECRET_0: 'pre-existing' };
  const { externalized } = externalizeMcpSecrets(mcpServers, env);
  assert.notEqual(externalized[0].envVar, 'CLOUDCLI_MCP_SECRET_0');
  assert.equal(env.CLOUDCLI_MCP_SECRET_0, 'pre-existing');
});

test('externalizeMcpSecrets is a no-op for already-placeholdered headers', () => {
  const mcpServers = { a: { headers: { Authorization: 'Bearer ${SCOPED_MCP_BEARER_TOKEN}' } } };
  const env = {};
  const { externalized } = externalizeMcpSecrets(mcpServers, env);
  assert.equal(externalized.length, 0);
  assert.deepEqual(env, {});
  assert.equal(mcpServers.a.headers.Authorization, 'Bearer ${SCOPED_MCP_BEARER_TOKEN}');
});

test('isSecretAllowedToolsEntry catches the PW= finding but keeps real tool names', () => {
  assert.equal(isSecretAllowedToolsEntry('Bash(PW="s3cr3t-long-value-here":*)'), true);
  assert.equal(isSecretAllowedToolsEntry(`Bash(curl -H "Authorization: Bearer ${SYNTHETIC_TOKEN}":*)`), true);
  // Real tool names — long, hyphen/underscore heavy, but never a credential literal.
  assert.equal(isSecretAllowedToolsEntry('mcp__scoped-mcp__task-queue-mcp_submit_task'), false);
  assert.equal(isSecretAllowedToolsEntry('Bash(kubectl get pods --namespace production:*)'), false);
  assert.equal(isSecretAllowedToolsEntry('Read'), false);
  // Shell/env var references are not literal secrets.
  assert.equal(isSecretAllowedToolsEntry('Bash(export TOKEN=$MYTOKEN:*)'), false);
});

test('isSecretAllowedToolsEntry catches underscore-prefixed env-var secrets (SMCP-41 audit CRITICAL)', () => {
  // The `\b` word-boundary bug let these sail past the scrub gate because `_`
  // is a regex word char. All four must now be flagged.
  assert.equal(isSecretAllowedToolsEntry(`Bash(DB_PASSWORD=${SYNTHETIC_TOKEN}:*)`), true);
  assert.equal(isSecretAllowedToolsEntry(`Bash(SCOPED_MCP_BEARER_TOKEN=${SYNTHETIC_TOKEN}:*)`), true);
  assert.equal(isSecretAllowedToolsEntry(`Bash(export API_SECRET_KEY=${SYNTHETIC_TOKEN} && run)`), true);
  assert.equal(isSecretAllowedToolsEntry('Bash(MY_DSN=postgres://u:p4ssword@host/db1234:*)'), true);
  // Lowercase underscore variants too (case-insensitive).
  assert.equal(isSecretAllowedToolsEntry(`Bash(my_password=${SYNTHETIC_TOKEN}:*)`), true);
  // Still a no-op for the env-reference form.
  assert.equal(isSecretAllowedToolsEntry('Bash(export SCOPED_MCP_BEARER_TOKEN=${VAR}:*)'), false);
});

test('isSecretAllowedToolsEntry catches basic-auth credentials embedded in a URL (SMCP-41 audit LOW)', () => {
  assert.equal(isSecretAllowedToolsEntry('Bash(curl https://user:s3cr3tpass@host/path:*)'), true);
  // A userinfo-free URL is not a credential.
  assert.equal(isSecretAllowedToolsEntry('Bash(curl https://host/path:*)'), false);
});

test('isSecretHeaderValue treats keyword-named auth headers as secret without a digit gate (SMCP-41 audit MEDIUM)', () => {
  // Custom auth header, high-entropy but digit-free value — must still externalize.
  assert.equal(isSecretHeaderValue('X-Vault-Token', 'abcdefghijklmnopqrstuvwxyzABCDEF'), true);
  assert.equal(isSecretHeaderValue('X-Service-Secret', 'someLongOpaqueValueNoDigits'), true);
  // Non-sensitive header name with a MIME-type value stays a no-op.
  assert.equal(isSecretHeaderValue('X-Trace-Context', 'application/json'), false);
});

test('scrubSecretAllowedTools drops secret-shaped entries, keeps the rest', () => {
  const { kept, dropped } = scrubSecretAllowedTools([
    'Read',
    'mcp__scoped-mcp__task-queue-mcp_submit_task',
    'Bash(PW="s3cr3t-long-value-here":*)',
    'Bash(git status:*)',
  ]);
  assert.deepEqual(kept, [
    'Read',
    'mcp__scoped-mcp__task-queue-mcp_submit_task',
    'Bash(git status:*)',
  ]);
  assert.deepEqual(dropped, ['Bash(PW="s3cr3t-long-value-here":*)']);
});

test('findArgvSecrets is clean after externalization + scrubbing', () => {
  const mcpServers = { 'scoped-mcp': { headers: { Authorization: `Bearer ${SYNTHETIC_TOKEN}` } } };
  const env = {};
  externalizeMcpSecrets(mcpServers, env);
  const { kept } = scrubSecretAllowedTools(['Read', 'Bash(PW="s3cr3t-long-value-here":*)']);
  const findings = findArgvSecrets({ mcpServers, allowedTools: kept });
  assert.deepEqual(findings, []);
});

test('findArgvSecrets detects a literal token that slipped through', () => {
  const findings = findArgvSecrets({
    mcpServers: { a: { headers: { Authorization: `Bearer ${SYNTHETIC_TOKEN}` } } },
    allowedTools: [],
  });
  assert.ok(findings.some((f) => f.kind === 'bearer'));
});

test('assertNoArgvSecrets is fail-open: logs, does not throw', () => {
  const logged = [];
  const findings = assertNoArgvSecrets(
    { mcpServers: { a: { headers: { Authorization: `Bearer ${SYNTHETIC_TOKEN}` } } }, allowedTools: [] },
    { error: (m) => logged.push(m) }
  );
  assert.ok(findings.length > 0);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /SMCP-41/);
});

// Synthetic values only, generated per run: never a real credential (vikunja #1112).
const syntheticHex = (bytes) => crypto.randomBytes(bytes).toString('hex');
const BCRYPT_ALPHABET = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const syntheticBcrypt = () =>
  '$2b$12$' + Array.from(crypto.randomBytes(53), (byte) => BCRYPT_ALPHABET[byte % 64]).join('');

test('isSecretAllowedToolsEntry catches a tk_ token behind a single-letter variable (vikunja #1112)', () => {
  assert.equal(isSecretAllowedToolsEntry(`Bash(T=tk_${syntheticHex(20)}:*)`), true);
  // The shape alone is enough, with or without an assignment in front of it.
  assert.equal(isSecretAllowedToolsEntry(`Bash(curl -H "Authorization: tk_${syntheticHex(20)}" https://host:*)`), true);
});

test('isSecretAllowedToolsEntry catches a bcrypt hash in a *_HASH variable (vikunja #1112)', () => {
  assert.equal(isSecretAllowedToolsEntry(`Bash(OLD_HASH='${syntheticBcrypt()}':*)`), true);
  assert.equal(isSecretAllowedToolsEntry(`Bash(H=${syntheticBcrypt()}:*)`), true);
});

test('isSecretAllowedToolsEntry treats HASH as a credential keyword', () => {
  assert.equal(isSecretAllowedToolsEntry('Bash(ADMIN_HASH=q9w8e7r6t5:*)'), true);
});

test('isSecretAllowedToolsEntry catches a long opaque value behind any variable name', () => {
  assert.equal(isSecretAllowedToolsEntry(`Bash(K=${syntheticHex(16)}:*)`), true);
  assert.equal(isSecretAllowedToolsEntry('Bash(X="Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MGFiY2RlZg":*)'), true);
});

test('the value-shape patterns keep ordinary permission entries', () => {
  for (const entry of [
    'Bash(gh auth status:*)',
    'Bash(npm run task-scheduler:*)',
    'Bash(git checkout feat/disk-usage-report:*)',
    "Bash(awk '{print $1$2}':*)",
    'Bash(BUILD=release2024:*)',
    'Bash(pip install scikit-learn:*)',
    'Bash(git log:*)',
    'Bash(npm run test:*)',
    'mcp__scoped-mcp__task-queue-mcp_submit_task',
    'mcp__scoped-mcp__githost-mcp_git_status',
    'Bash(X=1:*)',
    'Bash(NODE_ENV=production npm run build:*)',
    'Bash(CONFIG=/home/User/Projects/Some-Long-Directory-Name/config2.json node app.js:*)',
    'Bash(NAME=my-very-long-kebab-case-project-name-2024:*)',
    'Bash(export TOKEN=$MYTOKEN:*)',
  ]) {
    assert.equal(isSecretAllowedToolsEntry(entry), false, entry);
  }
});

test('findArgvSecrets reports a token shape that slipped through', () => {
  const findings = findArgvSecrets({ allowedTools: ['Read', `Bash(T=tk_${syntheticHex(20)}:*)`] });
  assert.ok(findings.some((f) => f.kind === 'token-shape'));
  assert.deepEqual(findArgvSecrets({ allowedTools: ['Read', 'Bash(git log:*)'] }), []);
});

// Synthetic values only: random bytes in each format, never a real credential.
const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const B64URL = B62 + '-_';
const LOWER_DIGIT = 'abcdefghijklmnopqrstuvwxyz0123456789';
const synthetic = (alphabet, length) =>
  Array.from(crypto.randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join('');
const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const syntheticJwt = () =>
  `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub: synthetic(B62, 12), exp: 1 })}.${synthetic(B64URL, 43)}`;

test('isSecretAllowedToolsEntry catches bare vendor tokens with a known prefix (audit F-02)', () => {
  for (const entry of [
    `Bash(gh auth login --with-token ghp_${synthetic(B62, 36)}:*)`,
    `Bash(git clone https://github_pat_${synthetic(B62 + '_', 82)}@github.com/x/y:*)`,
    `Bash(curl -H x-api-key\\ sk-ant-api03-${synthetic(B64URL, 93)}:*)`,
    `Bash(llm -k sk-proj-${synthetic(B64URL, 48)} prompt:*)`,
    `Bash(glab auth login --token glpat-${synthetic(B64URL, 20)}:*)`,
    `Bash(slack-cli --token xoxb-${synthetic('0123456789', 12)}-${synthetic(B62, 24)}:*)`,
  ]) {
    assert.equal(isSecretAllowedToolsEntry(entry), true, entry.slice(0, 30));
  }
});

test('isSecretAllowedToolsEntry catches a bare JWT (audit F-02)', () => {
  assert.equal(isSecretAllowedToolsEntry(`Bash(curl --oauth2-bearer ${syntheticJwt()} https://host:*)`), true);
});

test('isSecretAllowedToolsEntry catches argon2 and sha-crypt hashes (audit F-02)', () => {
  const crypt = './' + B62;
  for (const entry of [
    `Bash(OLD=$argon2id$v=19$m=65536,t=3,p=4$${synthetic(B62, 22)}$${synthetic(B62, 43)}:*)`,
    `Bash(echo '$6$${synthetic(crypt, 16)}$${synthetic(crypt, 86)}':*)`,
    `Bash(echo '$5$rounds=5000$${synthetic(crypt, 16)}$${synthetic(crypt, 43)}':*)`,
    `Bash(echo '$1$${synthetic(crypt, 8)}$${synthetic(crypt, 22)}':*)`,
  ]) {
    assert.equal(isSecretAllowedToolsEntry(entry), true, entry.slice(0, 20));
  }
});

test('isSecretAllowedToolsEntry catches a long lowercase-and-digit value behind any variable name (audit F-02)', () => {
  // At least one digit and one letter are guaranteed so the shape is the one under test.
  const value = `a1${synthetic(LOWER_DIGIT, 40)}`;
  assert.equal(isSecretAllowedToolsEntry(`Bash(X=${value}:*)`), true);
  assert.equal(isSecretAllowedToolsEntry(`Bash(X=${value.slice(0, 38)}:*)`), false, 'below 40 it stays');
});

test('findArgvSecrets reports the new token shapes (audit F-02)', () => {
  for (const text of [`ghp_${synthetic(B62, 36)}`, syntheticJwt()]) {
    const findings = findArgvSecrets({ allowedTools: ['Read', `Bash(x ${text}:*)`] });
    assert.ok(findings.some((f) => f.kind === 'token-shape'));
  }
});
