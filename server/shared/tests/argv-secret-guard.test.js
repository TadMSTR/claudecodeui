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
const LIVE_TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test('isSecretHeaderValue flags literal Authorization but skips ${VAR} placeholders', () => {
  assert.equal(isSecretHeaderValue('Authorization', `Bearer ${LIVE_TOKEN}`), true);
  assert.equal(isSecretHeaderValue('authorization', 'Bearer ${SCOPED_MCP_BEARER_TOKEN}'), false);
  assert.equal(isSecretHeaderValue('Content-Type', 'application/json'), false);
  assert.equal(isSecretHeaderValue('Accept', 'text/event-stream'), false);
  assert.equal(isSecretHeaderValue('X-Api-Key', LIVE_TOKEN), true);
  assert.equal(isSecretHeaderValue('Authorization', ''), false);
});

test('externalizeMcpSecrets moves the literal token to env and leaves a ${VAR} in the config', () => {
  const mcpServers = {
    'scoped-mcp': {
      type: 'http',
      url: 'http://127.0.0.1:8473/mcp',
      headers: { Authorization: `Bearer ${LIVE_TOKEN}` },
    },
  };
  const env = {};
  const { externalized } = externalizeMcpSecrets(mcpServers, env);

  assert.equal(externalized.length, 1);
  const varName = externalized[0].envVar;
  // Real value now lives only in env.
  assert.equal(env[varName], `Bearer ${LIVE_TOKEN}`);
  // Config carries the placeholder, no literal token.
  assert.equal(mcpServers['scoped-mcp'].headers.Authorization, `\${${varName}}`);
  const serialized = JSON.stringify(mcpServers);
  assert.ok(!serialized.includes(LIVE_TOKEN), 'no literal token in serialized config');
});

test('externalizeMcpSecrets avoids clobbering an existing env var name', () => {
  const mcpServers = { a: { headers: { Authorization: `Bearer ${LIVE_TOKEN}` } } };
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
  assert.equal(isSecretAllowedToolsEntry(`Bash(curl -H "Authorization: Bearer ${LIVE_TOKEN}":*)`), true);
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
  assert.equal(isSecretAllowedToolsEntry(`Bash(DB_PASSWORD=${LIVE_TOKEN}:*)`), true);
  assert.equal(isSecretAllowedToolsEntry(`Bash(SCOPED_MCP_BEARER_TOKEN=${LIVE_TOKEN}:*)`), true);
  assert.equal(isSecretAllowedToolsEntry(`Bash(export API_SECRET_KEY=${LIVE_TOKEN} && run)`), true);
  assert.equal(isSecretAllowedToolsEntry('Bash(MY_DSN=postgres://u:p4ssword@host/db1234:*)'), true);
  // Lowercase underscore variants too (case-insensitive).
  assert.equal(isSecretAllowedToolsEntry(`Bash(my_password=${LIVE_TOKEN}:*)`), true);
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
  const mcpServers = { 'scoped-mcp': { headers: { Authorization: `Bearer ${LIVE_TOKEN}` } } };
  const env = {};
  externalizeMcpSecrets(mcpServers, env);
  const { kept } = scrubSecretAllowedTools(['Read', 'Bash(PW="s3cr3t-long-value-here":*)']);
  const findings = findArgvSecrets({ mcpServers, allowedTools: kept });
  assert.deepEqual(findings, []);
});

test('findArgvSecrets detects a literal token that slipped through', () => {
  const findings = findArgvSecrets({
    mcpServers: { a: { headers: { Authorization: `Bearer ${LIVE_TOKEN}` } } },
    allowedTools: [],
  });
  assert.ok(findings.some((f) => f.kind === 'bearer'));
});

test('assertNoArgvSecrets is fail-open: logs, does not throw', () => {
  const logged = [];
  const findings = assertNoArgvSecrets(
    { mcpServers: { a: { headers: { Authorization: `Bearer ${LIVE_TOKEN}` } } }, allowedTools: [] },
    { error: (m) => logged.push(m) }
  );
  assert.ok(findings.length > 0);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /SMCP-41/);
});
