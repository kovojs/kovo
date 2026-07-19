import { describe, expect, it } from 'vitest';

import {
  checkSecurityGuarantee,
  isParanoidRuntimeProof,
  privateVulnerabilityReportContactLine,
} from './check-security-guarantee.mjs';

const manifestPath = 'security/TCB.md';
const guaranteePath = 'SECURITY.md';

function tcbManifest(entries) {
  return `# Test TCB

\`\`\`json tcb-manifest
{
  "schema": "kovo.security.tcb/v1",
  "budgets": {
    "entryMaxLines": 150,
    "totalTcbMaxLines": 600
  },
  "entries": ${JSON.stringify(entries, null, 2)}
}
\`\`\`
`;
}

function securityRegister(overrides = {}) {
  const register = {
    schema: 'kovo.security.guarantees/v1',
    source: 'fixture',
    threatModel: {
      assumptions: ['trusted framework package'],
      inScope: ['hostile app authoring shapes'],
    },
    guarantees: [
      {
        id: 'secret-egress',
        state: 'current',
        statement: 'A runtime Secret is refused at query-wire egress in paranoid mode.',
        tcbChokes: ['server.response-posture.emit-to-wire'],
        runtimeProofs: ['runtime-secret-explicit-box-egress'],
      },
    ],
    advisories: [],
    nonGoals: ['availability'],
    ...overrides,
  };
  return `# Fixture

\`\`\`json security-guarantees
${JSON.stringify(register, null, 2)}
\`\`\`

## Report a Vulnerability

${privateVulnerabilityReportContactLine}
`;
}

function run(files, options = {}) {
  return checkSecurityGuarantee({
    exists: (relativePath) => Object.hasOwn(files, relativePath),
    proofEntries: [
      {
        claimId: 'runtime-secret-explicit-box-egress',
        requiredProofFileNeedles: ["KOVO_PARANOID: '1'"],
        testName:
          'distinguishes Postgres reader-role denials from runtime Secret wire refusal and audited reveal acceptance',
      },
      {
        claimId: 'readonly-managed-handle-prod-artifact',
        requiredNeedles: ['expectReadonlyAttemptBlocked(origin)'],
        testName:
          'rolls back default mutation transactions and executes webhook mutation composition in the production build artifact',
      },
    ],
    readText: (relativePath) => files[relativePath] ?? '',
    repoRoot: '/fixture',
    ...options,
  });
}

describe('security guarantee gate', () => {
  it('accepts a guarantee backed by a TCB choke and paranoid runtime proof', () => {
    const result = run({
      [guaranteePath]: securityRegister(),
      [manifestPath]: tcbManifest([
        {
          classification: 'tcb',
          file: 'packages/server/src/response-posture.ts',
          id: 'server.response-posture.emit-to-wire',
          kind: 'wire-emitter',
          name: 'emitToWire',
        },
      ]),
    });

    expect(result.findings).toEqual([]);
    expect(result.summary).toContain('OK 1 security guarantee');
  });

  it('requires the published threat model and non-goals', () => {
    const result = run({
      [guaranteePath]: securityRegister({
        nonGoals: [],
        threatModel: { assumptions: [], inScope: [] },
      }),
      [manifestPath]: tcbManifest([]),
    });

    expect(result.findings).toContain(
      'SECURITY.md: threatModel.inScope must list at least one in-scope threat',
    );
    expect(result.findings).toContain(
      'SECURITY.md: threatModel.assumptions must list at least one assumption',
    );
    expect(result.findings).toContain(
      'SECURITY.md: nonGoals must list at least one explicit non-goal',
    );
  });

  it('fails if the private vulnerability reporting contact line disappears', () => {
    const result = run({
      [guaranteePath]: securityRegister().replace(privateVulnerabilityReportContactLine, ''),
      [manifestPath]: tcbManifest([]),
    });

    expect(result.findings).toContain(
      `SECURITY.md: ## Report a Vulnerability must retain the private contact line ${privateVulnerabilityReportContactLine}`,
    );
  });

  it('rejects a guarantee without a TCB choke', () => {
    const result = run({
      [guaranteePath]: securityRegister({
        guarantees: [
          {
            id: 'secret-egress',
            state: 'current',
            statement: 'A runtime Secret is refused at query-wire egress in paranoid mode.',
            tcbChokes: [],
            runtimeProofs: ['runtime-secret-explicit-box-egress'],
          },
        ],
      }),
      [manifestPath]: tcbManifest([]),
    });

    expect(result.findings).toContain(
      'SECURITY.md: secret-egress.tcbChokes must name at least one TCB choke',
    );
  });

  it('rejects an unknown TCB choke reference', () => {
    const result = run({
      [guaranteePath]: securityRegister(),
      [manifestPath]: tcbManifest([]),
    });

    expect(result.findings).toContain(
      'SECURITY.md: secret-egress references unknown TCB choke server.response-posture.emit-to-wire',
    );
  });

  it('rejects a non-TCB manifest classification as guarantee backing', () => {
    const result = run({
      [guaranteePath]: securityRegister(),
      [manifestPath]: tcbManifest([
        {
          classification: 'delegating-wire-emitter',
          file: 'packages/server/src/response.ts',
          id: 'server.response-posture.emit-to-wire',
          kind: 'wire-emitter',
          name: 'emitToWire',
        },
      ]),
    });

    expect(result.findings).toContain(
      'SECURITY.md: secret-egress references server.response-posture.emit-to-wire, but it is classified delegating-wire-emitter instead of tcb',
    );
  });

  it('rejects a retired runtime read-boundary claim after its honest proof rename', () => {
    const result = run({
      [guaranteePath]: securityRegister({
        guarantees: [
          {
            id: 'secret-egress',
            state: 'current',
            statement: 'A runtime Secret is refused at query-wire egress in paranoid mode.',
            tcbChokes: ['server.response-posture.emit-to-wire'],
            runtimeProofs: ['runtime-secret-db-read-boundary'],
          },
        ],
      }),
      [manifestPath]: tcbManifest([
        {
          classification: 'tcb',
          file: 'packages/server/src/response-posture.ts',
          id: 'server.response-posture.emit-to-wire',
          kind: 'wire-emitter',
          name: 'emitToWire',
        },
      ]),
    });

    expect(result.findings).toContain(
      'SECURITY.md: secret-egress references unknown runtime/paranoid proof runtime-secret-db-read-boundary',
    );
  });

  it('rejects runtime proofs that are not enrolled under KOVO_PARANOID', () => {
    const result = run({
      [guaranteePath]: securityRegister({
        guarantees: [
          {
            id: 'readonly',
            state: 'current',
            statement: 'A reader handle performs no writes.',
            tcbChokes: ['server.response-posture.emit-to-wire'],
            runtimeProofs: ['readonly-managed-handle-prod-artifact'],
          },
        ],
      }),
      [manifestPath]: tcbManifest([
        {
          classification: 'tcb',
          file: 'packages/server/src/response-posture.ts',
          id: 'server.response-posture.emit-to-wire',
          kind: 'wire-emitter',
          name: 'emitToWire',
        },
      ]),
    });

    expect(result.findings).toContain(
      'SECURITY.md: readonly proof readonly-managed-handle-prod-artifact is not enrolled as a KOVO_PARANOID runtime proof',
    );
  });

  it('recognizes paranoid runtime proof entries mechanically', () => {
    expect(
      isParanoidRuntimeProof({
        claimId: 'runtime-secret-explicit-box-egress',
        requiredProofFileNeedles: ["KOVO_PARANOID: '1'"],
        testName: 'refuses an explicit runtime Secret value in paranoid mode',
      }),
    ).toBe(true);

    expect(
      isParanoidRuntimeProof({
        claimId: 'readonly-managed-handle-prod-artifact',
        requiredNeedles: ['expectReadonlyAttemptBlocked(origin)'],
        testName: 'blocks a readonly mutation attempt',
      }),
    ).toBe(false);
  });

  it('rejects silently reasserting a current guarantee over an open advisory', () => {
    const result = run({
      [guaranteePath]: securityRegister({
        advisories: [
          {
            id: 'GHSA-test-open',
            retracts: ['secret-egress'],
            status: 'open',
          },
        ],
      }),
      [manifestPath]: tcbManifest([
        {
          classification: 'tcb',
          file: 'packages/server/src/response-posture.ts',
          id: 'server.response-posture.emit-to-wire',
          kind: 'wire-emitter',
          name: 'emitToWire',
        },
      ]),
    });

    expect(result.findings).toContain(
      'SECURITY.md: current guarantee secret-egress is retracted by open advisory GHSA-test-open',
    );
  });

  it('requires withdrawn guarantees to retain their advisory retracts binding', () => {
    const result = run({
      [guaranteePath]: securityRegister({
        guarantees: [
          {
            id: 'secret-egress',
            state: 'withdrawn',
            statement: 'The former runtime Secret egress guarantee is withdrawn.',
          },
        ],
      }),
      [manifestPath]: tcbManifest([]),
    });

    expect(result.findings).toContain(
      'SECURITY.md: withdrawn guarantee secret-egress must be bound by an advisory retracts entry',
    );
  });

  it('accepts an advisory-bound withdrawal without requiring stale proof references', () => {
    const result = run({
      [guaranteePath]: securityRegister({
        advisories: [
          {
            id: 'GHSA-test-open',
            retracts: ['secret-egress'],
            status: 'open',
          },
        ],
        guarantees: [
          {
            id: 'secret-egress',
            state: 'withdrawn',
            statement: 'The former runtime Secret egress guarantee is withdrawn.',
          },
        ],
      }),
      [manifestPath]: tcbManifest([]),
    });

    expect(result.findings).toEqual([]);
    expect(result.summary).toContain('OK 0 security guarantee');
  });

  it('requires a superseded guarantee to bind to an advisory and a current replacement', () => {
    const result = run({
      [guaranteePath]: securityRegister({
        advisories: [
          {
            id: 'GHSA-test-resolved',
            retracts: ['secret-egress-v1'],
            status: 'resolved',
          },
        ],
        guarantees: [
          {
            id: 'secret-egress-v1',
            state: 'superseded',
            statement: 'The original runtime Secret egress guarantee was incomplete.',
            supersededBy: 'secret-egress-v2',
          },
          {
            id: 'secret-egress-v2',
            state: 'withdrawn',
            statement: 'The replacement has not become current.',
          },
        ],
      }),
      [manifestPath]: tcbManifest([]),
    });

    expect(result.findings).toContain(
      'SECURITY.md: superseded guarantee secret-egress-v1 replacement secret-egress-v2 must be current',
    );
  });

  it('accepts a resolved advisory with a superseded guarantee and current replacement', () => {
    const result = run({
      [guaranteePath]: securityRegister({
        advisories: [
          {
            id: 'GHSA-test-resolved',
            retracts: ['secret-egress-v1'],
            status: 'resolved',
          },
        ],
        guarantees: [
          {
            id: 'secret-egress-v1',
            state: 'superseded',
            statement: 'The original runtime Secret egress guarantee was incomplete.',
            supersededBy: 'secret-egress-v2',
          },
          {
            id: 'secret-egress-v2',
            state: 'current',
            statement: 'The corrected runtime Secret is refused at query-wire egress.',
            tcbChokes: ['server.response-posture.emit-to-wire'],
            runtimeProofs: ['runtime-secret-explicit-box-egress'],
          },
        ],
      }),
      [manifestPath]: tcbManifest([
        {
          classification: 'tcb',
          file: 'packages/server/src/response-posture.ts',
          id: 'server.response-posture.emit-to-wire',
          kind: 'wire-emitter',
          name: 'emitToWire',
        },
      ]),
    });

    expect(result.findings).toEqual([]);
    expect(result.summary).toContain('OK 1 security guarantee');
  });
});
