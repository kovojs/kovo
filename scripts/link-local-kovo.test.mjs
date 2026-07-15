import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('link-local-kovo', () => {
  it('rewrites direct Kovo packages and Drizzle to identity-safe local links', () => {
    const appRoot = tempDir('kovo-link-local-app-');
    const kovoRoot = tempDir('kovo-link-local-repo-');
    writeJson(path.join(appRoot, 'package.json'), {
      dependencies: {
        '@kovojs/headless-ui': 'workspace:*',
        '@kovojs/icons': 'workspace:*',
        '@kovojs/ui': 'workspace:*',
        'drizzle-orm': '1.0.0-rc.4',
      },
      devDependencies: {
        '@kovojs/core': 'workspace:*',
      },
    });
    for (const leaf of ['core', 'headless-ui', 'icons', 'ui']) {
      writeJson(path.join(kovoRoot, 'packages', leaf, 'package.json'), {
        name: `@kovojs/${leaf}`,
      });
    }
    writeJson(path.join(kovoRoot, 'packages/server/node_modules/drizzle-orm/package.json'), {
      name: 'drizzle-orm',
      version: '1.0.0-rc.4',
    });

    execFileSync('node', [path.resolve('scripts/link-local-kovo.mjs'), appRoot, kovoRoot], {
      cwd: path.resolve('.'),
      stdio: 'pipe',
    });

    const appPackage = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    expect(appPackage.dependencies['@kovojs/headless-ui']).toMatch(
      /^link:\.\.\/kovo-link-local-repo-.*\/packages\/headless-ui$/,
    );
    expect(appPackage.dependencies['@kovojs/icons']).toMatch(
      /^link:\.\.\/kovo-link-local-repo-.*\/packages\/icons$/,
    );
    expect(appPackage.dependencies['@kovojs/ui']).toMatch(
      /^link:\.\.\/kovo-link-local-repo-.*\/packages\/ui$/,
    );
    expect(appPackage.dependencies['drizzle-orm']).toMatch(
      /^link:\.\.\/kovo-link-local-repo-.*\/packages\/server\/node_modules\/drizzle-orm$/,
    );
    expect(appPackage.devDependencies['@kovojs/core']).toMatch(
      /^link:\.\.\/kovo-link-local-repo-.*\/packages\/core$/,
    );
  });
});
