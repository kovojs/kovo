import { describe, expect, it } from 'vitest';

import {
  modelBoundarySchema,
  SPEC_BOUNDARY_MARKER,
  validateModelHonestyBoundary,
} from './check-model-honesty-boundary.mjs';

const protocol = Object.freeze({
  actions: ['jobs.claimDue', 'replay.abort', 'replay.reserve'],
  schema: 'kovo-protocol-alphabet/v1',
});

const boundary = Object.freeze({
  schema: modelBoundarySchema,
  id: 'replay-reservation/v1',
  status: 'registered-not-model-checked',
  atomicityAxiom: {
    classification: 'human-assumption',
    detail: 'Each registered transition CTE is modeled as one atomic action.',
    id: 'postgres-cte-atomicity',
    justification:
      'The watermark row uses FOR UPDATE; this is reviewed Postgres reasoning, not machine verification.',
    verified: false,
  },
  bounds: {
    backwardClockSteps: 1,
    crashPoints: 1,
    identities: 2,
    replicas: 2,
    slots: 2,
  },
  modeledActions: ['replay.abort'],
  notModeledActions: ['jobs.claimDue', 'replay.reserve'],
  notModeledPhenomena: [
    {
      detail: 'Postgres implements the transaction and row-lock semantics assumed by the model.',
      id: 'postgres-lock-implementation',
    },
  ],
});

const specText = `${SPEC_BOUNDARY_MARKER}
Postgres-CTE atomicity axiom: each registered transition CTE is one atomic action. This is a human
assumption justified by FOR UPDATE, not a machine-verified Postgres implementation claim.
<!-- kovo-not-modeled:postgres-lock-implementation -->
`;

function validate(overrides = {}) {
  return validateModelHonestyBoundary({ boundary, protocol, specText, ...overrides });
}

describe('model honesty-boundary gate (Plan 3 §6 C13 anchor)', () => {
  it('accepts an exact disjoint modeled/not-modeled complement with honest SPEC markers', () => {
    expect(validate()).toEqual({ findings: [], ok: true });
  });

  it('fails when an action is omitted from or duplicated across the partition', () => {
    const omitted = structuredClone(boundary);
    omitted.notModeledActions = ['jobs.claimDue'];
    const duplicated = structuredClone(boundary);
    duplicated.modeledActions = ['replay.abort', 'replay.reserve'];

    expect(validate({ boundary: omitted }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('complement')]),
    );
    expect(validate({ boundary: duplicated }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('both modeled and not modeled')]),
    );
  });

  it('fails on an invented action or an unbounded model dimension', () => {
    const invented = structuredClone(boundary);
    invented.modeledActions = ['replay.abort', 'replay.invented'];
    const unbounded = structuredClone(boundary);
    unbounded.bounds.replicas = 'unbounded';

    expect(validate({ boundary: invented }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('not registered in the protocol alphabet')]),
    );
    expect(validate({ boundary: unbounded }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('bounds must equal')]),
    );
  });

  it('rejects laundering the Postgres axiom into a verified claim', () => {
    const dishonest = structuredClone(boundary);
    dishonest.atomicityAxiom.classification = 'verified';
    dishonest.atomicityAxiom.verified = true;
    dishonest.atomicityAxiom.justification = 'TLC proved Postgres.';

    expect(validate({ boundary: dishonest }).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('human-assumption'),
        expect.stringContaining('verified must remain false'),
        expect.stringContaining('FOR UPDATE'),
      ]),
    );
  });

  it('requires SPEC coverage for the boundary and every excluded phenomenon', () => {
    expect(validate({ specText: 'Postgres replay is safe.' }).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(SPEC_BOUNDARY_MARKER),
        expect.stringContaining('postgres-lock-implementation'),
      ]),
    );
  });
});
