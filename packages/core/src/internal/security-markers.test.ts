import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { diagnosticDefinitions } from '../diagnostics.js';
import {
  AUTHORIZATION_CONFIDENTIALITY_RUNTIME_CODES,
  createBoundedRuntimeAuditCollector,
  hasFrameworkDurableReplayStoreReceipt,
  mintFrameworkDurableReplayStoreReceipt,
  PARANOID_SECURITY_ADVISORY_CODES,
  propagateFrameworkDurableReplayStoreReceipt,
  SECURITY_CODE_REGISTRY,
  type SecurityBoundaryProof,
  securityClassifier,
  securityDecisionMetadata,
  wireEmitter,
} from './security-markers.js';

describe('durable replay store receipts (SPEC §10.3)', () => {
  it('authenticates the exact surface and carries the opaque receipt through snapshots', () => {
    const store = {};
    const snapshot = {};

    mintFrameworkDurableReplayStoreReceipt(store, 'mutation');

    expect(hasFrameworkDurableReplayStoreReceipt(store, 'mutation')).toBe(true);
    expect(hasFrameworkDurableReplayStoreReceipt(store, 'webhook')).toBe(false);
    expect(hasFrameworkDurableReplayStoreReceipt(store, 'capability')).toBe(false);
    expect(propagateFrameworkDurableReplayStoreReceipt(store, snapshot, 'mutation')).toBe(true);
    expect(hasFrameworkDurableReplayStoreReceipt(snapshot, 'mutation')).toBe(true);
  });

  it('rejects structural and global-symbol lookalikes', () => {
    const forged = {
      kind: 'framework-durable-replay-store',
      [Symbol.for('kovo.durable-replay-store')]: true,
    };

    expect(hasFrameworkDurableReplayStoreReceipt(forged, 'mutation')).toBe(false);
    expect(propagateFrameworkDurableReplayStoreReceipt(forged, {}, 'mutation')).toBe(false);
  });

  it('uses pinned WeakMap controls after ambient prototype poisoning', () => {
    const store = {};
    const snapshot = {};
    const originalGet = WeakMap.prototype.get;
    const originalSet = WeakMap.prototype.set;
    let propagated = false;
    let authenticated = false;
    try {
      WeakMap.prototype.get = () => {
        throw new Error('poisoned WeakMap.get');
      };
      WeakMap.prototype.set = () => {
        throw new Error('poisoned WeakMap.set');
      };

      mintFrameworkDurableReplayStoreReceipt(store, 'webhook');
      propagated = propagateFrameworkDurableReplayStoreReceipt(store, snapshot, 'webhook');
      authenticated = hasFrameworkDurableReplayStoreReceipt(snapshot, 'webhook');
    } finally {
      WeakMap.prototype.get = originalGet;
      WeakMap.prototype.set = originalSet;
    }
    expect(propagated).toBe(true);
    expect(authenticated).toBe(true);
  });
});

describe('bounded runtime audit collectors (SPEC §9.5)', () => {
  it('retains the newest fixed window, drains in order, and is reusable', () => {
    const collector = createBoundedRuntimeAuditCollector<number>(3);
    for (let value = 0; value < 10_000; value += 1) collector.record(value);

    expect(collector.drain()).toEqual([9_997, 9_998, 9_999]);
    expect(collector.drain()).toEqual([]);
    collector.record(10_000);
    expect(collector.drain()).toEqual([10_000]);
  });

  it('isolates collectors and stays bounded in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const left = createBoundedRuntimeAuditCollector<string>(2);
      const right = createBoundedRuntimeAuditCollector<string>(2);
      left.record('left-1');
      right.record('right-1');
      left.record('left-2');
      left.record('left-3');

      expect(left.drain()).toEqual(['left-2', 'left-3']);
      expect(right.drain()).toEqual(['right-1']);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('rejects invalid capacities', () => {
    expect(() => createBoundedRuntimeAuditCollector(0)).toThrow(/integer from 1 to 256/);
    expect(() => createBoundedRuntimeAuditCollector(257)).toThrow(/integer from 1 to 256/);
    expect(() => createBoundedRuntimeAuditCollector(Number.POSITIVE_INFINITY)).toThrow(
      /integer from 1 to 256/,
    );
  });
});

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

  it('pins collector sealing and decision identity against ambient object controls', () => {
    const originalDefineProperties = Object.defineProperties;
    const originalFreeze = Object.freeze;
    const originalIsSafeInteger = Number.isSafeInteger;
    let collector: { drain(): string[]; record(fact: string): void } | undefined;
    let classify: ((value: string) => string) | undefined;
    try {
      Object.defineProperties = ((value: object) => value) as typeof Object.defineProperties;
      Object.freeze = ((value: object) => ({ attacker: value })) as typeof Object.freeze;
      Number.isSafeInteger = () => true;
      collector = createBoundedRuntimeAuditCollector<string>(2);
      collector.record('first');
      collector.record('second');
      classify = securityClassifier('test.pinned-classifier', (value: string) => value);
    } finally {
      Object.defineProperties = originalDefineProperties;
      Object.freeze = originalFreeze;
      Number.isSafeInteger = originalIsSafeInteger;
    }

    expect(collector?.drain()).toEqual(['first', 'second']);
    expect(Object.isFrozen(collector)).toBe(true);
    expect(securityDecisionMetadata(classify)).toEqual({
      kind: 'classifier',
      name: 'test.pinned-classifier',
    });
    expect(securityDecisionMetadata(() => undefined)).toBeUndefined();
  });
});

describe('DEC-D security code registry', () => {
  it('does not expose mutable security classification authority', () => {
    const enforcement = SECURITY_CODE_REGISTRY.KV414.enforcement;
    const firstRuntimeCode = AUTHORIZATION_CONFIDENTIALITY_RUNTIME_CODES[0];
    const changedEnforcement = Reflect.set(
      SECURITY_CODE_REGISTRY.KV414,
      'enforcement',
      'build-only',
    );
    const changedRuntimeCode = Reflect.set(AUTHORIZATION_CONFIDENTIALITY_RUNTIME_CODES, 0, 'KV407');

    try {
      expect(Object.isFrozen(SECURITY_CODE_REGISTRY)).toBe(true);
      expect(Object.isFrozen(SECURITY_CODE_REGISTRY.KV414)).toBe(true);
      expect(Object.isFrozen(AUTHORIZATION_CONFIDENTIALITY_RUNTIME_CODES)).toBe(true);
      expect(changedEnforcement).toBe(false);
      expect(changedRuntimeCode).toBe(false);
      expect(SECURITY_CODE_REGISTRY.KV414.enforcement).toBe(enforcement);
      expect(AUTHORIZATION_CONFIDENTIALITY_RUNTIME_CODES[0]).toBe(firstRuntimeCode);
    } finally {
      if (changedEnforcement) {
        Reflect.set(SECURITY_CODE_REGISTRY.KV414, 'enforcement', enforcement);
      }
      if (changedRuntimeCode) {
        Reflect.set(AUTHORIZATION_CONFIDENTIALITY_RUNTIME_CODES, 0, firstRuntimeCode);
      }
    }
  });

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

  it('classifies request-state security codes by a non-proxy boundary proof', () => {
    for (const code of ['KV406', 'KV414', 'KV415', 'KV422', 'KV428', 'KV433', 'KV435', 'KV438']) {
      const entry = SECURITY_CODE_REGISTRY[code];

      expect(entry.boundaryProof, `${entry.code} boundary proof`).toBeDefined();
      expect([
        'boxed-egress',
        'engine-enumerated-door',
        'framework-owned-door',
        'static-provenance',
      ] satisfies SecurityBoundaryProof[]).toContain(entry.boundaryProof!);
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

  it('documents KV414 authorization as privilege/principal/runtime chokes, not set_config alone', () => {
    const property = SECURITY_CODE_REGISTRY.KV414.property;

    expect(property).toContain('unassumeable privilege roles');
    expect(property).toContain('classified role-attribute allowlist');
    expect(property).toContain('runtime-login/assumable-role closure');
    expect(property).toContain('confined statement surface');
    expect(property).toContain('per-request principal GUCs');
    expect(property).toContain('scrubbed connections');
    expect(property).toContain('side-effect-inclusive engine-closure-audited reachable objects');
    expect(property).not.toMatch(/set_config/u);
  });

  it('documents KV435 confidentiality as boxed egress plus engine-computed identity and reachability sets', () => {
    const property = SECURITY_CODE_REGISTRY.KV435.property;

    expect(property).toContain('runtime Secret values cannot cross client-readable wire egress');
    expect(property).toContain('classified role-attribute allowlist');
    expect(property).toContain('runtime-login/assumable-role closure');
    expect(property).toContain('engine-closure-audited reachable objects');
  });

  it('keeps authorization/confidentiality guarantees off build-only classifications', () => {
    for (const code of AUTHORIZATION_CONFIDENTIALITY_RUNTIME_CODES) {
      expect(
        SECURITY_CODE_REGISTRY[code].enforcement,
        `${code} must not rely only on build-time enumeration`,
      ).not.toBe('build-only');
      expect(
        SECURITY_CODE_REGISTRY[code].boundaryProof,
        `${code} must name a non-proxy boundary proof`,
      ).toMatch(/engine-enumerated-door|boxed-egress/u);
    }
  });

  it('keeps governed-column write provenance classified as static provenance, not a proxy-only floor', () => {
    expect(SECURITY_CODE_REGISTRY.KV438.boundaryProof).toBe('static-provenance');
    expect(SECURITY_CODE_REGISTRY.KV438.property).toContain('managed write boundary');
    expect(SECURITY_CODE_REGISTRY.KV438.property).toContain('never a runtime proxy-only check');
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
