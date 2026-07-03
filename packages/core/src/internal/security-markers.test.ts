import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { diagnosticDefinitions } from '../diagnostics.js';
import {
  AUTHORIZATION_CONFIDENTIALITY_RUNTIME_CODES,
  PARANOID_SECURITY_ADVISORY_CODES,
  SECURITY_CODE_REGISTRY,
  securityClassifier,
  securityDecisionMetadata,
  wireEmitter,
} from './security-markers.js';

describe('security decision markers', () => {
  it('preserves classifier call behavior while attaching non-enumerable metadata', () => {
    const classify = securityClassifier('test.classify', (value: string) => value.toUpperCase());

    expect(classify('ok')).toBe('OK');
    expect(Object.keys(classify)).toEqual([]);
    expect(securityDecisionMetadata(classify)).toEqual({
      kind: 'classifier',
      name: 'test.classify',
    });
  });

  it('preserves wire emitter call behavior while attaching non-enumerable metadata', () => {
    const emit = wireEmitter('test.emit', (value: number) => ({ body: String(value) }));

    expect(emit(7)).toEqual({ body: '7' });
    expect(Object.keys(emit)).toEqual([]);
    expect(securityDecisionMetadata(emit)).toEqual({
      kind: 'wire-emitter',
      name: 'test.emit',
    });
  });
});

describe('DEC-D security code registry', () => {
  it('derives the paranoid advisory set from runtime chokes plus proven by-construction entries', () => {
    const derived = Object.values(SECURITY_CODE_REGISTRY)
      .filter(
        (entry) =>
          entry.enforcement === 'runtime-choke' ||
          (entry.enforcement === 'by-construction' && entry.paranoidAdvisory === true),
      )
      .map((entry) => entry.code)
      .sort();

    expect(PARANOID_SECURITY_ADVISORY_CODES).toEqual(derived);
    expect(PARANOID_SECURITY_ADVISORY_CODES).toEqual([
      'KV406',
      'KV414',
      'KV415',
      'KV422',
      'KV433',
      'KV435',
      'KV438',
    ]);
  });

  it('does not stub escape-hatch-audit or build-only residual codes under paranoid mode', () => {
    const advisoryCodes = new Set(PARANOID_SECURITY_ADVISORY_CODES);
    const excluded = Object.values(SECURITY_CODE_REGISTRY)
      .filter(
        (entry) => entry.enforcement === 'escape-hatch-audit' || entry.enforcement === 'build-only',
      )
      .map((entry) => entry.code);

    expect(excluded).toContain('KV426');
    expect(excluded).toContain('KV423');
    expect(excluded).toContain('KV431');
    expect(excluded.every((code) => !advisoryCodes.has(code))).toBe(true);
    expect(advisoryCodes.has('KV429')).toBe(false);
  });

  it('covers every currently defined security diagnostic code in the checked 4xx family', () => {
    const diagnosticSecurityCodes = Object.keys(diagnosticDefinitions).filter(
      (code) => /^KV4/u.test(code) && code >= 'KV406' && code <= 'KV439',
    );

    expect(Object.keys(SECURITY_CODE_REGISTRY).sort()).toEqual(diagnosticSecurityCodes.sort());
  });

  it('requires every build-only entry to explain why the property is build-artifact-only', () => {
    for (const entry of Object.values(SECURITY_CODE_REGISTRY)) {
      if (entry.enforcement !== 'build-only') continue;

      expect(entry.propertyDependsOn, `${entry.code} build-only property dependency`).toBe(
        'build-artifact',
      );
      expect(entry.buildOnlyRationale.trim(), `${entry.code} build-only rationale`).not.toBe('');
    }
  });

  it('prevents request-state and concurrency properties from drifting into build-only', () => {
    for (const entry of Object.values(SECURITY_CODE_REGISTRY)) {
      if (entry.propertyDependsOn === 'build-artifact') continue;

      expect(entry.enforcement, `${entry.code} depends on ${entry.propertyDependsOn}`).not.toBe(
        'build-only',
      );
    }
  });

  it('documents engine-choke wording for authorization and confidentiality registry entries', () => {
    for (const code of AUTHORIZATION_CONFIDENTIALITY_RUNTIME_CODES) {
      const property = SECURITY_CODE_REGISTRY[code].property;
      expect(property, `${code} Postgres engine choke`).toMatch(/Postgres[\s\S]*engine choke/u);
      expect(property, `${code} SQLite limitation`).toMatch(
        /SQLite[\s\S]*experimental\/non-guaranteeing/u,
      );
    }
  });

  it('keeps authorization/confidentiality guarantees off build-only classifications', () => {
    for (const code of AUTHORIZATION_CONFIDENTIALITY_RUNTIME_CODES) {
      expect(
        SECURITY_CODE_REGISTRY[code].enforcement,
        `${code} must not rely only on build-time enumeration`,
      ).not.toBe('build-only');
    }
  });

  it('requires a chokeId to name runtime-choke enforcement or a proven by-construction floor', () => {
    for (const entry of Object.values(SECURITY_CODE_REGISTRY)) {
      if (entry.chokeId === undefined) continue;

      const floor = 'byConstructionFloor' in entry ? entry.byConstructionFloor : undefined;
      const hasProvenFloor = typeof floor === 'string' && floor.trim() !== '';
      expect(
        entry.enforcement === 'runtime-choke' ||
          (entry.enforcement === 'by-construction' && hasProvenFloor),
        `${entry.code} chokeId ${entry.chokeId} contradicts ${entry.enforcement}`,
      ).toBe(true);
    }
  });

  it('keeps chokeId registry entries pointed at live branded security decisions', () => {
    const source = [
      'packages/server/src/sql-safe-handle.ts',
      'packages/server/src/response-posture.ts',
    ]
      .map((relativePath) => readRepoFile(relativePath))
      .join('\n');

    for (const entry of Object.values(SECURITY_CODE_REGISTRY)) {
      if (entry.chokeId === undefined) continue;
      expect(entry.chokeId, `${entry.code} must name a choke id`).toBeDefined();
      expect(source, `${entry.code} names a live choke ${entry.chokeId}`).toContain(
        `'${entry.chokeId}'`,
      );
      expect(source, `${entry.code} choke ${entry.chokeId} is branded`).toMatch(
        new RegExp(
          String.raw`(?:securityClassifier|wireEmitter)\(\s*['"]${escapeRegExp(
            entry.chokeId!,
          )}['"]`,
          'u',
        ),
      );
    }
  });
});

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot(), relativePath), 'utf8');
}

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}
