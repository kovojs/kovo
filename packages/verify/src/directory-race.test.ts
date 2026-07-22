import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const race = vi.hoisted(() => ({
  active: false,
  backup: '',
  hits: 0,
  original: '',
  replacement: '',
  swapped: false,
  target: '',
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    lstatSync(filePath: Parameters<typeof actual.lstatSync>[0], ...args: unknown[]) {
      if (race.active && String(filePath) === race.target) {
        race.hits += 1;
        if (race.hits === 2) {
          actual.renameSync(race.original, race.backup);
          actual.renameSync(race.replacement, race.original);
          race.swapped = true;
        }
      }
      return Reflect.apply(actual.lstatSync, actual, [filePath, ...args]);
    },
    readSync(file: Parameters<typeof actual.readSync>[0], ...args: unknown[]) {
      const value = Reflect.apply(actual.readSync, actual, [file, ...args]);
      if (race.swapped) {
        actual.renameSync(race.original, race.replacement);
        actual.renameSync(race.backup, race.original);
        race.swapped = false;
      }
      return value;
    },
  };
});

import {
  KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
  type KovoCertificateV1,
  verifyCertificateDirectory,
} from './index.js';

const roots: string[] = [];

afterEach(() => {
  race.active = false;
  race.swapped = false;
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('filesystem certificate snapshot identity', () => {
  it.each([
    { code: 'artifact-list', targetPath: 'dist/index.mjs' },
    { code: 'manifest-invalid', targetPath: 'package.json' },
  ])(
    'rejects a tree swapped at the $targetPath read and restored before the final census',
    async ({ code, targetPath }) => {
      const root = mkdtempSync(path.join(tmpdir(), 'kovo-verify-tree-swap-'));
      roots.push(root);
      const original = path.join(root, '@kovojs/server');
      const replacement = path.join(root, 'replacement-server');
      const backup = path.join(root, 'original-server');
      const module = '@kovojs/server/dist/index.mjs';
      const source = 'export const safe = true;';
      const manifest = { exports: { '.': './dist/index.mjs' }, name: '@kovojs/server' };
      writePackageTree(original, source, manifest);
      writePackageTree(replacement, source, manifest);
      const policy = policyBytes(module, source, manifest);
      const certificate: KovoCertificateV1 = {
        artifacts: [module],
        cap: { [module]: [] },
        domain: KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
        doors: [],
        edges: [],
        opaque: [],
        policySha512: sha512(policy),
        roots: [],
        schema: 'kovo.certificate/v1',
      };
      Object.assign(race, {
        active: true,
        backup,
        hits: 0,
        original,
        replacement,
        swapped: false,
        target: realpathSync(path.join(original, targetPath)),
      });

      const result = await verifyCertificateDirectory(certificate, policy, root);
      expect(race.hits).toBeGreaterThanOrEqual(2);
      expect(race.swapped).toBe(false);
      expect(result).toMatchObject({
        findings: expect.arrayContaining([expect.objectContaining({ code })]),
        ok: false,
      });
    },
  );
});

function writePackageTree(
  packageRoot: string,
  source: string,
  manifest: Record<string, unknown>,
): void {
  mkdirSync(path.join(packageRoot, 'dist'), { recursive: true });
  writeFileSync(path.join(packageRoot, 'dist/index.mjs'), source);
  writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify(manifest));
}

function policyBytes(module: string, source: string, manifest: Record<string, unknown>): Buffer {
  return Buffer.from(
    `${JSON.stringify(
      {
        artifacts: [{ path: module, sha512: sha512(source) }],
        doors: [],
        opaque: [],
        packages: [{ manifest, name: '@kovojs/server' }],
        roots: [],
        schema: 'kovo.certificate-policy/v1',
      },
      null,
      2,
    )}\n`,
  );
}

function sha512(bytes: string | Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}
