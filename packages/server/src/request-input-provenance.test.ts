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
