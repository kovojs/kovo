import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { bootFixture, type BootedFixture } from './boot-fixture.js';

let booted: BootedFixture | undefined;
let distDir: string | undefined;
let secretDir: string | undefined;

afterEach(async () => {
  await booted?.close();
  booted = undefined;
  if (distDir !== undefined) await rm(distDir, { force: true, recursive: true });
  distDir = undefined;
  if (secretDir !== undefined) await rm(secretDir, { force: true, recursive: true });
  secretDir = undefined;
});

describe('fixture static asset security', () => {
  it('C191 keeps SSR bridge hooks off the authored retainable database handle', async () => {
    const fixtureDir = fileURLToPath(
      new URL(
        '../../../../tests/integration/fixtures/query-readset-runtime-crosscheck/',
        import.meta.url,
      ),
    );
    booted = await bootFixture(fixtureDir);
    const db = booted.db;

    const bridgeHooks = Object.getOwnPropertySymbols(db).filter((symbol) => {
      const descriptor = Object.getOwnPropertyDescriptor(db, symbol);
      return (
        descriptor !== undefined &&
        'value' in descriptor &&
        typeof descriptor.value === 'function' &&
        (symbol.description === 'kovo.readonly-db-handle' ||
          symbol.description === 'kovo.declared-write-db-handle')
      );
    });
    // The only visible hooks are the native adapter-realm symbols. The verifier refuses to vend
    // them, while the foreign SSR-realm hooks live on an unreachable private bridge shell.
    expect(bridgeHooks.map((symbol) => symbol.description).sort()).toEqual([
      'kovo.declared-write-db-handle',
      'kovo.readonly-db-handle',
    ]);
    for (const hook of bridgeHooks) {
      expect(() =>
        Reflect.apply((db as Record<symbol, (...args: unknown[]) => unknown>)[hook]!, db, [{}]),
      ).toThrow(/reserved for the framework lifecycle/u);
    }
  });

  it('C156 rejects encoded traversal into a sibling whose path shares the dist prefix', async () => {
    const fixtureDir = fileURLToPath(
      new URL('../../../../tests/integration/fixtures/bootstrap-order/', import.meta.url),
    );
    secretDir = path.join(fixtureDir, 'dist-secret');
    await mkdir(secretDir, { recursive: true });
    await writeFile(path.join(secretDir, 'secret.txt'), 'fixture-sibling-secret');
    booted = await bootFixture(fixtureDir);

    const response = await fetch(`${booted.origin}/assets/..%2f..%2fdist-secret%2fsecret.txt`);
    await expect(response.text()).resolves.not.toContain('fixture-sibling-secret');
  });

  it('C156 rejects static-asset symlinks that resolve outside the assets root', async () => {
    const fixtureDir = fileURLToPath(
      new URL('../../../../tests/integration/fixtures/bootstrap-order/', import.meta.url),
    );
    secretDir = path.join(fixtureDir, 'dist-secret');
    distDir = path.join(fixtureDir, 'dist');
    const assetsDir = path.join(distDir, 'assets');
    await mkdir(secretDir, { recursive: true });
    await mkdir(assetsDir, { recursive: true });
    const secretPath = path.join(secretDir, 'secret.txt');
    await writeFile(secretPath, 'fixture-symlink-secret');
    await symlink(secretPath, path.join(assetsDir, 'leak.txt'));
    booted = await bootFixture(fixtureDir);

    const response = await fetch(`${booted.origin}/assets/leak.txt`);
    await expect(response.text()).resolves.not.toContain('fixture-symlink-secret');
  });

  it('C201 rejects inherited MIME authority and keeps known/unknown static types explicit', async () => {
    const fixtureDir = fileURLToPath(
      new URL('../../../../tests/integration/fixtures/bootstrap-order/', import.meta.url),
    );
    distDir = path.join(fixtureDir, 'dist');
    const assetsDir = path.join(distDir, 'assets');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(path.join(assetsDir, 'known.css'), 'body { color: rebeccapurple; }');
    await writeFile(
      path.join(assetsDir, 'payload.kovo-unknown'),
      '<script>globalThis.pwned=1</script>',
    );
    booted = await bootFixture(fixtureDir);

    const knownResponse = await fetch(`${booted.origin}/assets/known.css`);
    expect(knownResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(knownResponse.headers.get('x-content-type-options')).toBe('nosniff');

    const unknownResponse = await fetch(`${booted.origin}/assets/payload.kovo-unknown`);
    expect(unknownResponse.headers.get('content-type')).toBe('application/octet-stream');
    expect(unknownResponse.headers.get('x-content-type-options')).toBe('nosniff');

    Object.defineProperty(Object.prototype, '.kovo-unknown', {
      configurable: true,
      value: 'text/html; charset=utf-8',
    });
    try {
      const response = await fetch(`${booted.origin}/assets/payload.kovo-unknown`);
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
    } finally {
      delete (Object.prototype as Record<string, unknown>)['.kovo-unknown'];
    }
  });

  it('C189 rejects an assets root symlink that establishes an outside trusted root', async () => {
    const fixtureDir = fileURLToPath(
      new URL('../../../../tests/integration/fixtures/bootstrap-order/', import.meta.url),
    );
    secretDir = path.join(fixtureDir, 'dist-secret');
    distDir = path.join(fixtureDir, 'dist');
    await mkdir(secretDir, { recursive: true });
    await mkdir(distDir, { recursive: true });
    await writeFile(path.join(secretDir, 'secret.txt'), 'fixture-assets-root-secret');
    await symlink(secretDir, path.join(distDir, 'assets'), 'dir');
    booted = await bootFixture(fixtureDir);

    const response = await fetch(`${booted.origin}/assets/secret.txt`);
    await expect(response.text()).resolves.not.toContain('fixture-assets-root-secret');
  });

  it('C189 rejects a dist root symlink that establishes an outside trusted root', async () => {
    const fixtureDir = fileURLToPath(
      new URL('../../../../tests/integration/fixtures/bootstrap-order/', import.meta.url),
    );
    secretDir = path.join(fixtureDir, 'dist-secret');
    distDir = path.join(fixtureDir, 'dist');
    await mkdir(path.join(secretDir, 'assets'), { recursive: true });
    await writeFile(path.join(secretDir, 'assets', 'secret.txt'), 'fixture-dist-root-secret');
    await symlink(secretDir, distDir, 'dir');
    booted = await bootFixture(fixtureDir);

    const response = await fetch(`${booted.origin}/assets/secret.txt`);
    await expect(response.text()).resolves.not.toContain('fixture-dist-root-secret');
  });
});
