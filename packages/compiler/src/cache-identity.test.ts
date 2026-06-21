import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compilerBuildId } from './cache-identity.js';

describe('compilerBuildId', () => {
  // B1 (plans/bug-and-testing-part3.md): the build id MUST be derived from the
  // compiler's own package.json version, never a hardcoded literal, so a
  // compiler upgrade is a clean cache miss (SPEC.md §5.2 / §5.2.1).
  it('derives its namespace from the compiler package.json version (no hardcoded literal)', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { name: string; version: string };

    const id = compilerBuildId();
    expect(id.startsWith(`${manifest.name}@${manifest.version}/`)).toBe(true);
    // The package is already past 0.1.0; the build id must reflect that, not the
    // stale literal that the bug shipped.
    expect(id.includes('@0.1.0/')).toBe(false);
  });

  it('returns a stable id when called with no arguments', () => {
    expect(compilerBuildId()).toBe(compilerBuildId());
    expect(compilerBuildId()).toBe(compilerBuildId({}));
  });

  it('is stable for equivalent source fingerprints regardless of object order', () => {
    expect(
      compilerBuildId({
        sourceFingerprints: {
          'src/compile.ts': 'a1',
          'src/vite.ts': 'b2',
        },
      }),
    ).toBe(
      compilerBuildId({
        sourceFingerprints: {
          'src/vite.ts': 'b2',
          'src/compile.ts': 'a1',
        },
      }),
    );
  });

  it('changes when a compiler source fingerprint changes', () => {
    expect(
      compilerBuildId({
        sourceFingerprints: {
          'src/compile.ts': 'a1',
        },
      }),
    ).not.toBe(
      compilerBuildId({
        sourceFingerprints: {
          'src/compile.ts': 'a2',
        },
      }),
    );
  });
});
