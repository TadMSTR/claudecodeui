/**
 * Forge fork (viewer-secret-paths): directories the file viewer must never read
 * from or write into, whatever the workspace root is.
 *
 * Upstream lets the viewer read any file under `WORKSPACES_ROOT`, which
 * defaults to the home directory (#1622). That makes the SSH keys, credential
 * files and this server's own database readable by any authenticated session.
 * The check runs on the path the viewer resolved, both as written and with
 * symlinks resolved, so a link planted inside a project cannot point at one of
 * these directories either.
 *
 * This is a deny-list, so it is best-effort: a credential store it does not
 * name stays readable. Anyone signed in also has CloudCLI's own terminal, so it
 * is defence in depth for the viewer, not the boundary.
 */
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Paths under the home directory that hold credentials. */
const SECRET_HOME_PATHS = [
  '.ssh',
  '.gnupg',
  '.secrets',
  '.claude-secrets',
  // This server's database, which holds the JWT signing secret.
  '.cloudcli',
  path.join('.claude', '.credentials.json'),
  // PM2's saved process list records each process's environment.
  '.pm2',
  // Compose stacks, each with its service secrets in an env file.
  'docker',
  // Tool credential stores.
  '.netrc',
  '.git-credentials',
  '.npmrc',
  '.docker',
  '.aws',
  '.kube',
  path.join('.config', 'gh'),
  '.pki',
  '.password-store',
  '.ansible',
  '.semgrep',
  // Other agent CLIs' logins, and this server's older data directory.
  '.codex',
  '.gemini',
  '.cursor',
  '.claude-code-ui',
  path.join('.config', 'Claude'),
  path.join('.local', 'share', 'opencode'),
  // Desktop keyring, browser profiles, mail and online accounts.
  path.join('.local', 'share', 'keyrings'),
  '.mozilla',
  path.join('.config', 'evolution'),
  path.join('.local', 'share', 'evolution'),
  path.join('.config', 'protonmail'),
  path.join('.local', 'share', 'protonmail'),
  path.join('.config', 'goa-1.0'),
  // Backup tooling: repository passwords, and data restored out of a backup.
  path.join('.config', 'backrest'),
  path.join('.local', 'share', 'backrest'),
  'backrest-restore',
  // Forge's own tool configs that hold keys or secrets.
  path.join('.config', 'fleet-tunnel'),
  path.join('.config', 'cloudcli-plugin-task-queue'),
  // Shell history can hold a secret typed or pasted on a command line.
  '.bash_history',
  '.zsh_history',
];

/**
 * Names in the home directory protected by prefix, for files whose backups sit
 * beside them under suffixed names. `.claude.json` holds MCP server entries,
 * which can carry bearer tokens in their headers, and so does every
 * `.claude.json.bak-*` copy of it.
 */
const SECRET_HOME_NAME_PREFIXES = ['.claude.json'];

/** The protected paths for a home directory, absolute. Read per call so `HOME` changes are honoured. */
export function secretPathRoots(homeDirectory: string = os.homedir()): string[] {
  return SECRET_HOME_PATHS.map((entry) => path.join(homeDirectory, entry));
}

/** Whether `target` is a home-directory entry named with a protected prefix, or inside one. */
function hasSecretHomePrefix(target: string, homeDirectory: string): boolean {
  const relative = path.relative(homeDirectory, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return false;
  }
  const first = relative.split(path.sep)[0];
  return SECRET_HOME_NAME_PREFIXES.some((prefix) => first.startsWith(prefix));
}

function isUnder(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/**
 * Resolves symlinks in `candidate`, or in its nearest existing ancestor when it
 * does not exist yet (a file about to be created), re-appending the rest.
 */
async function resolveExisting(candidate: string): Promise<string> {
  let current = candidate;
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(await realpath(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return candidate;
      }
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Whether `candidate` is, or is inside, a protected path. Compared as written
 * and with symlinks resolved on both sides, so neither a link to a protected
 * directory nor a protected directory that is itself a link gets past it.
 */
export async function isSecretPath(
  candidate: string,
  roots: string[] = secretPathRoots(),
  homeDirectory: string = os.homedir(),
): Promise<boolean> {
  const lexical = path.resolve(candidate);
  const resolved = await resolveExisting(lexical);
  const home = path.resolve(homeDirectory);
  const resolvedHome = await resolveExisting(home);
  for (const target of [lexical, resolved]) {
    if (hasSecretHomePrefix(target, home) || hasSecretHomePrefix(target, resolvedHome)) {
      return true;
    }
  }
  for (const root of roots) {
    const resolvedRoot = await resolveExisting(path.resolve(root));
    for (const target of [lexical, resolved]) {
      if (isUnder(target, root) || isUnder(target, resolvedRoot)) {
        return true;
      }
    }
  }
  return false;
}
