import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalClientModuleRepresentation,
  clientModuleHrefForSourceFile,
  clientModuleRepresentationDigest,
  parseVersionedClientModuleTarget,
} from './client-module-url.js';

describe('client-module immutable content identity', () => {
  it('does not alias distinct valid JavaScript sources that collide under 32-bit FNV-1a', () => {
    // Fixed birthday collision for the former clientModuleContentVersion implementation.
    // SPEC §5.2.1 requires collision-resistant full-source identity for immutable module URLs.
    const first = 'export const moduleValue = true; // ut1judhzx3zh4yrg39';
    const second = 'export const moduleValue = true; // rx0vl11ux2mrp1k7ohfj';
    expect(fnv1a(first)).toBe('f1d01c97');
    expect(fnv1a(second)).toBe('f1d01c97');

    const firstVersion = clientModuleRepresentationDigest(first);
    const secondVersion = clientModuleRepresentationDigest(second);
    expect(firstVersion).toMatch(/^[0-9a-f]{64}$/u);
    expect(secondVersion).toMatch(/^[0-9a-f]{64}$/u);
    expect(firstVersion).not.toBe(secondVersion);
    expect(clientModuleHrefForSourceFile('account.tsx', firstVersion)).not.toBe(
      clientModuleHrefForSourceFile('account.tsx', secondVersion),
    );
  });

  it('keeps content identity after a post-bootstrap lookalike Hash.update replacement', () => {
    const safe = 'export const safe = true;';
    const target = 'export const adminToken = leak;';
    const safeVersion = clientModuleRepresentationDigest(safe);
    const targetVersion = clientModuleRepresentationDigest(target);
    const prototype = Object.getPrototypeOf(createHash('sha256')) as { update: Function };
    const nativeUpdate = prototype.update;
    const nativeApply = Reflect.apply;
    prototype.update = function update(data: unknown, encoding?: unknown) {
      // Deliberately mimics the former source-text allowlist: this[kHandle].update
      return nativeApply(nativeUpdate, this, [data === target ? safe : data, encoding]);
    };
    try {
      expect(clientModuleRepresentationDigest(safe)).toBe(safeVersion);
      expect(clientModuleRepresentationDigest(target)).toBe(targetVersion);
      expect(clientModuleRepresentationDigest(target)).not.toBe(
        clientModuleRepresentationDigest(safe),
      );
    } finally {
      prototype.update = nativeUpdate;
    }
  });

  it('hashes and serves one well-formed UTF-8 representation for lone surrogates', () => {
    const lone = 'export const value = "\ud800";';
    const replacement = 'export const value = "�";';
    expect(canonicalClientModuleRepresentation(lone)).toBe(replacement);
    expect(clientModuleRepresentationDigest(lone)).toBe(
      clientModuleRepresentationDigest(replacement),
    );
  });

  it('uses byte-length frames and one full-digest URL grammar', () => {
    const a = clientModuleRepresentationDigest('a|bc');
    const b = clientModuleRepresentationDigest('ab|c');
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
    expect(b).toMatch(/^[0-9a-f]{64}$/u);
    expect(a).not.toBe(b);

    const href = clientModuleHrefForSourceFile('x.tsx', a);
    expect(parseVersionedClientModuleTarget(href)).toEqual({ digest: a, path: '/c/x.client.js' });
    expect(parseVersionedClientModuleTarget(`/c/x.client.js?v=${a}`)).toBeUndefined();
    expect(parseVersionedClientModuleTarget('/c/__v/old/x.client.js')).toBeUndefined();
  });
});

function fnv1a(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
