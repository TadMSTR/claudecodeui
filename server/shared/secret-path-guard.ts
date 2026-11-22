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
  // MCP server entries here can carry bearer tokens in their headers.
  '.claude.json',
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
];

/** The protected paths for a home directory, absolute. Read per call so `HOME` changes are honoured. */
export function secretPathRoots(homeDirectory: string = os.homedir()): string[] {
  return SECRET_HOME_PATHS.map((entry) => path.join(homeDirectory, entry));
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
export async function isSecretPath(candidate: string, roots: string[] = secretPathRoots()): Promise<boolean> {
  const lexical = path.resolve(candidate);
  const resolved = await resolveExisting(lexical);
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
