// Forge fork (viewer-secret-paths): the file viewer refuses credential
// directories under every root policy — workspace, read-only and project — and
// through symlinks, for reads, browsing and writes.
import assert from 'node:assert/strict';
import fs, { promises as fsPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createFileTreeService } from '@/modules/file-tree/file-tree.service.js';
import type { FileTreeFileSystem, FileTreeServices } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';
import { isSecretPath, secretPathRoots } from '@/shared/secret-path-guard.js';

const realFileSystem: FileTreeFileSystem = {
  access: (candidatePath) => fsPromises.access(candidatePath),
  stat: (candidatePath) => fsPromises.stat(candidatePath),
  lstat: (candidatePath) => fsPromises.lstat(candidatePath),
  openDirectory: async function* (directoryPath) {
    yield* await fsPromises.opendir(directoryPath);
  },
  realpath: (candidatePath) => fsPromises.realpath(candidatePath),
  readTextFile: (filePath) => fsPromises.readFile(filePath, 'utf8'),
  writeTextFile: (filePath, content) => fsPromises.writeFile(filePath, content, 'utf8'),
  async makeDirectory(directoryPath, recursive) {
    await fsPromises.mkdir(directoryPath, { recursive });
  },
  rename: (oldPath, newPath) => fsPromises.rename(oldPath, newPath),
  async removeDirectory(directoryPath) {
    await fsPromises.rm(directoryPath, { recursive: true, force: true });
  },
  unlink: (filePath) => fsPromises.unlink(filePath),
  copyFile: (sourcePath, destinationPath) => fsPromises.copyFile(sourcePath, destinationPath),
  createReadStream: (filePath) => fs.createReadStream(filePath),
};

type Home = { home: string; project: string; service: FileTreeServices; projects: Map<string, string> };

/** A scratch home with credentials, a project inside it, and a viewer rooted at that home (forge's default). */
async function withHome(run: (home: Home) => Promise<void>): Promise<void> {
  const home = await fsPromises.realpath(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'viewer-secret-home-')));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    for (const directory of ['.ssh', '.gnupg', '.secrets', '.claude-secrets', '.cloudcli', '.claude', 'repo/app']) {
      await fsPromises.mkdir(path.join(home, directory), { recursive: true });
    }
    await fsPromises.writeFile(path.join(home, '.ssh', 'id_test'), 'synthetic-key');
    await fsPromises.writeFile(path.join(home, '.secrets', 'app.env'), 'SYNTHETIC=1');
    await fsPromises.writeFile(path.join(home, '.claude', '.credentials.json'), '{}');
    await fsPromises.writeFile(path.join(home, '.claude', 'settings.json'), '{}');
    await fsPromises.mkdir(path.join(home, '.sshfoo'));
    await fsPromises.writeFile(path.join(home, '.sshfoo', 'plain.txt'), 'plain');
    const project = path.join(home, 'repo', 'app');
    await fsPromises.writeFile(path.join(project, 'readme.md'), 'hello');
    await fsPromises.symlink(path.join(home, '.ssh'), path.join(project, 'keys'));

    const projects = new Map<string, string>([['app', project], ['home', home]]);
    const service = createFileTreeService({
      fileSystem: realFileSystem,
      projects: { getProjectPathById: async (projectId) => projects.get(projectId) ?? null },
      workspace: {
        rootPath: home,
        validatePath: async (candidatePath) => ({ valid: true, resolvedPath: candidatePath }),
        resolveReadOnlyRootPath: async () => null,
      },
      resolveMimeType: () => 'text/plain',
      fileSystemConcurrency: 4,
      logger: { error: () => {} },
    });
    await run({ home, project, service, projects });
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await fsPromises.rm(home, { recursive: true, force: true });
  }
}

async function assertSecretRefusal(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, 'SECRET_PATH');
    return true;
  });
}

test('the guard covers each credential path and its contents, not a sibling sharing the prefix', async () => {
  await withHome(async ({ home }) => {
    for (const entry of ['.ssh', '.ssh/id_test', '.gnupg', '.secrets/app.env', '.claude-secrets', '.cloudcli/auth.db', '.claude/.credentials.json']) {
      assert.equal(await isSecretPath(path.join(home, entry)), true, entry);
    }
    for (const entry of ['.sshfoo/plain.txt', '.claude/settings.json', 'repo/app/readme.md', '.secrets-not']) {
      assert.equal(await isSecretPath(path.join(home, entry)), false, entry);
    }
  });
});

test('the guard covers the tool credential stores, PM2 state and compose env files', async () => {
  await withHome(async ({ home }) => {
    const covered = [
      '.claude.json', '.pm2/dump.pm2', 'docker/stack/.env', '.netrc', '.git-credentials',
      '.npmrc', '.docker/config.json', '.aws/credentials', '.kube/config', '.config/gh/hosts.yml',
    ];
    for (const entry of covered) {
      assert.equal(await isSecretPath(path.join(home, entry)), true, entry);
    }
    for (const entry of ['.config/other/settings.json', 'dockerfiles/Dockerfile', 'repo/.claude.json', 'x.claude.json']) {
      assert.equal(await isSecretPath(path.join(home, entry)), false, entry);
    }
  });
});

test('the guard covers every backup copy of ~/.claude.json, directly and through a symlink', async () => {
  await withHome(async ({ home, project, service }) => {
    for (const entry of ['.claude.json.bak-20260101-120000', '.claude.json.rolledback-1', '.claude.json.backup']) {
      assert.equal(await isSecretPath(path.join(home, entry)), true, entry);
    }
    await fsPromises.writeFile(path.join(home, '.claude.json.bak-1'), '{}');
    await fsPromises.symlink(path.join(home, '.claude.json.bak-1'), path.join(project, 'cfg.json'));
    assert.equal(await isSecretPath(path.join(project, 'cfg.json')), true);
    await assertSecretRefusal(service.readTextFile('app', path.join(home, '.claude.json.bak-1')));
  });
});

test('a compose env file is refused through the workspace-root read', async () => {
  await withHome(async ({ home, service }) => {
    await fsPromises.mkdir(path.join(home, 'docker', 'stack'), { recursive: true });
    await fsPromises.writeFile(path.join(home, 'docker', 'stack', '.env'), 'SYNTHETIC=1');
    await assertSecretRefusal(service.readTextFile('app', path.join(home, 'docker', 'stack', '.env')));
  });
});

test('the guard follows a symlink into a credential directory, and one that does not exist yet', async () => {
  await withHome(async ({ home, project }) => {
    assert.equal(await isSecretPath(path.join(project, 'keys', 'id_test')), true);
    assert.equal(await isSecretPath(path.join(project, 'keys', 'not-yet-created')), true);
  });
});

test('the guard catches a credential directory that is itself a symlink', async () => {
  await withHome(async ({ home }) => {
    const elsewhere = path.join(home, 'repo', 'real-secrets');
    await fsPromises.mkdir(elsewhere);
    await fsPromises.writeFile(path.join(elsewhere, 'token'), 'synthetic');
    await fsPromises.rm(path.join(home, '.claude-secrets'), { recursive: true });
    await fsPromises.symlink(elsewhere, path.join(home, '.claude-secrets'));
    assert.equal(await isSecretPath(path.join(elsewhere, 'token')), true);
  });
});

test('the protected roots follow HOME at call time', async () => {
  await withHome(async ({ home }) => {
    assert.ok(secretPathRoots().every((root) => root.startsWith(`${home}${path.sep}`)));
  });
});

test('an absolute path into a credential directory is refused through the workspace-root read (PR #1622)', async () => {
  await withHome(async ({ home, service }) => {
    await assertSecretRefusal(service.readTextFile('app', path.join(home, '.ssh', 'id_test')));
    await assertSecretRefusal(service.openFile('app', path.join(home, '.secrets', 'app.env')));
    await assertSecretRefusal(service.readTextFile('app', path.join(home, '.claude', '.credentials.json')));
  });
});

test('ordinary files under the workspace root stay readable', async () => {
  await withHome(async ({ home, service }) => {
    assert.equal((await service.readTextFile('app', 'readme.md')).content, 'hello');
    assert.equal((await service.readTextFile('app', path.join(home, '.sshfoo', 'plain.txt'))).content, 'plain');
    assert.equal((await service.readTextFile('app', path.join(home, '.claude', 'settings.json'))).content, '{}');
  });
});

test('a project-relative path through a symlink into a credential directory is refused', async () => {
  await withHome(async ({ service }) => {
    await assertSecretRefusal(service.readTextFile('app', 'keys/id_test'));
  });
});

test('a project rooted at the home directory cannot read or write a credential directory', async () => {
  await withHome(async ({ home, service }) => {
    await assertSecretRefusal(service.readTextFile('home', '.ssh/id_test'));
    await assertSecretRefusal(service.saveTextFile('home', '.ssh/authorized_keys', 'synthetic'));
    await assertSecretRefusal(service.createEntry({ projectId: 'home', parentPath: '.ssh', name: 'planted', type: 'file' }));
    await assertSecretRefusal(service.deleteEntry({ projectId: 'home', targetPath: '.secrets/app.env' }));
    await assertSecretRefusal(service.renameEntry({ projectId: 'home', oldPath: '.secrets/app.env', newName: 'moved.env' }));
    await assert.rejects(fsPromises.access(path.join(home, '.ssh', 'authorized_keys')));
    await assert.rejects(fsPromises.access(path.join(home, '.ssh', 'planted')));
    assert.equal(await fsPromises.readFile(path.join(home, '.secrets', 'app.env'), 'utf8'), 'SYNTHETIC=1');
  });
});

test('renaming an ordinary file into a credential directory name is refused', async () => {
  await withHome(async ({ home, service }) => {
    await fsPromises.writeFile(path.join(home, 'plain.txt'), 'x');
    await assertSecretRefusal(service.renameEntry({ projectId: 'home', oldPath: 'plain.txt', newName: '.secrets' }));
  });
});

test('the folder browser will not list a credential directory', async () => {
  await withHome(async ({ service }) => {
    await assertSecretRefusal(service.browseWorkspace('~/.ssh'));
    assert.ok((await service.browseWorkspace('~/repo')).suggestions.length >= 1);
  });
});
