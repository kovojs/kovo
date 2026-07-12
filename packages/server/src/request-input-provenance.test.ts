import { describe, expect, it } from 'vitest';
import {
  markPrivilegedRequestInputAssignment,
  requestInputProvenanceForValue,
  runWithRequestInputProvenance,
} from './request-input-provenance.js';

describe('request input provenance tracking', () => {
  it('tracks primitive property reads from parsed input', () => {
    runWithRequestInputProvenance({ role: 'admin' }, (input) => {
      const role = input.role;

      expect(requestInputProvenanceForValue(role)).toEqual({ path: '<input>.role' });
    });
  });

  it('pins the provenance tracker against late global Proxy replacement', () => {
    const source = { role: 'admin' };
    const NativeProxy = globalThis.Proxy;
    let proxyHits = 0;
    try {
      globalThis.Proxy = class BypassProxy {
        constructor(target: object) {
          if (target === source) proxyHits += 1;
          return target;
        }
      } as unknown as ProxyConstructor;
      runWithRequestInputProvenance(source, (input) => {
        expect(requestInputProvenanceForValue(input.role)).toEqual({ path: '<input>.role' });
      });
    } finally {
      globalThis.Proxy = NativeProxy;
    }

    expect(proxyHits).toBe(0);
  });

  it('tracks object identity and spread reads', () => {
    runWithRequestInputProvenance({ profile: { name: 'Ada' }, role: 'admin' }, (input) => {
      const profile = input.profile;
      const spread = { ...input };

      expect(requestInputProvenanceForValue(profile)).toEqual({ path: '<input>.profile' });
      expect(requestInputProvenanceForValue(spread.role)).toEqual({ path: '<input>.role' });
    });
  });

  it('lets the audited privileged assignment discharge one request-input value', () => {
    runWithRequestInputProvenance({ role: 'admin' }, (input) => {
      const role = input.role;
      markPrivilegedRequestInputAssignment(role);

      expect(requestInputProvenanceForValue(role)).toBeUndefined();
    });
  });
});
