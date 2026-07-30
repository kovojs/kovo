import { createHash, createHmac } from 'node:crypto';

import { isRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import {
  staticTrustFromWorkerEnvelopeForTesting,
  type StaticTrustWorkerRequest,
} from './build-export.js';

const schema = 'kovo-static-trust-worker/v1';
const request: StaticTrustWorkerRequest = {
  appModulePath: '/app/app.ts',
  authenticationKey: '11'.repeat(32),
  cache: null,
  challenge: '22'.repeat(32),
  paranoidStaticAdvisory: false,
  root: '/app',
};

function requestDigest(expected: StaticTrustWorkerRequest): string {
  const identity = JSON.stringify({
    appModulePath: expected.appModulePath,
    cache: expected.cache,
    challenge: expected.challenge,
    paranoidStaticAdvisory: expected.paranoidStaticAdvisory,
    root: expected.root,
  });
  return `sha256:${createHash('sha256').update(identity, 'utf8').digest('hex')}`;
}

function envelopeFor(
  expected: StaticTrustWorkerRequest,
  payloadValue: unknown,
  overrides: Record<string, unknown> = {},
): string {
  const payload = JSON.stringify(payloadValue);
  const boundRequestDigest = requestDigest(expected);
  return JSON.stringify({
    authentication: `hmac-sha256:${createHmac(
      'sha256',
      Buffer.from(expected.authenticationKey, 'hex'),
    )
      .update(boundRequestDigest, 'utf8')
      .update('\0', 'utf8')
      .update(payload, 'utf8')
      .digest('hex')}`,
    digest: `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`,
    payload,
    requestDigest: boundRequestDigest,
    schema,
    ...overrides,
  });
}

function envelope(payloadValue: unknown, overrides: Record<string, unknown> = {}): string {
  return envelopeFor(request, payloadValue, overrides);
}

function successfulTrust(
  components: readonly unknown[],
  expected: StaticTrustWorkerRequest = request,
): Record<string, unknown> {
  const facts = {
    capabilities: [],
    cookieDowngrades: [],
    diagnostics: [],
    revealed: [],
    trustEscapes: [],
    unregisteredSinks: [],
  };
  const approvedSourceFiles = [{ fileName: 'app.ts', source: 'export default {};' }];
  return {
    approvedSourceFiles,
    capabilityClosure: {
      dependencyManifest: {},
      diagnostics: [],
      facts: [],
      packageRequests: [],
    },
    ...(expected.cache === null
      ? {}
      : {
          derivedProof: {
            browserPosture: {},
            dataPlaneFacts: {
              grants: [],
              massAssignmentFacts: [],
              ownerDomains: [],
              queries: [],
              queryWriteReachability: [],
              scopeAudits: [],
              sqlSafetyDiagnostics: [],
              toctouFacts: [],
            },
            queryShapeFacts: [],
          },
        }),
    facts,
    files: approvedSourceFiles,
    sourceGraphFacts: {
      components,
      domainDeclarationNames: [],
      registryDeclarationAnchors: [],
      routeOutcomes: [],
      routePages: [],
      sourceDerivedRegistryTransforms: [
        { code: null, fileName: 'app.ts', source: 'export default {};' },
      ],
    },
  };
}

function successfulEnvelopeForTrust(
  expected: StaticTrustWorkerRequest,
  trust: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): string {
  const facts = trust.facts!;
  const approvedSourceFiles = trust.approvedSourceFiles as readonly {
    fileName: string;
    source: string;
  }[];
  const clientEntry = trust.clientEntry as
    | { readonly fileName: string; readonly source: string }
    | undefined;
  const sourceFiles =
    clientEntry === undefined ? approvedSourceFiles : [...approvedSourceFiles, clientEntry];
  const sourceFrame = sourceFiles
    .map(
      (file) =>
        `${Buffer.byteLength(file.fileName)}:${file.fileName}${Buffer.byteLength(file.source)}:${file.source}`,
    )
    .join('');
  return envelopeFor(
    expected,
    { status: 'ok', trust },
    {
      factsDigest: `sha256:${createHash('sha256')
        .update(JSON.stringify(facts), 'utf8')
        .digest('hex')}`,
      sourceDigest: `sha256:${createHash('sha256').update(sourceFrame, 'utf8').digest('hex')}`,
      ...overrides,
    },
  );
}

function successfulEnvelope(
  components: readonly unknown[],
  expected: StaticTrustWorkerRequest = request,
): string {
  const trust = successfulTrust(components, expected);
  return successfulEnvelopeForTrust(expected, trust);
}

describe('static-trust worker protocol', () => {
  it('preserves a diagnostic failure without evaluating an authored module in the parent', () => {
    const diagnostics = [
      {
        category: 'error',
        code: 'KV235',
        message: 'Authored lowered IR is forbidden.',
      },
    ];
    expect(() =>
      staticTrustFromWorkerEnvelopeForTesting(
        envelope({
          error: {
            diagnostics,
            kind: 'diagnostic',
            message: 'kovo build check preflight failed:\\nERROR KV235',
          },
          status: 'error',
        }),
        request,
      ),
    ).toThrow('kovo build check preflight failed:\\nERROR KV235');
  });

  it.each([
    ['wrong schema', envelope({ status: 'error' }, { schema: 'kovo-static-trust-worker/v0' })],
    ['wrong digest', envelope({ status: 'error' }, { digest: 'sha256:00' })],
    ['truncated JSON', '{"schema":'],
    ['multiple documents', `${envelope({ status: 'error' })}${envelope({ status: 'error' })}`],
  ])('rejects %s output before trusting facts', (_label, output) => {
    expect(() => staticTrustFromWorkerEnvelopeForTesting(output, request)).toThrow();
  });

  it('rejects a signed envelope replayed into a different request challenge', () => {
    const replayed = successfulEnvelope([]);
    expect(() =>
      staticTrustFromWorkerEnvelopeForTesting(replayed, {
        ...request,
        challenge: '33'.repeat(32),
      }),
    ).toThrow('unauthenticated envelope');
  });

  it('rejects nested payload tampering even when the plain digest is recomputed', () => {
    const outer = JSON.parse(successfulEnvelope([])) as Record<string, unknown>;
    const payload = JSON.parse(outer.payload as string) as {
      trust: { capabilityClosure: { dependencyManifest: Record<string, unknown> } };
    };
    payload.trust.capabilityClosure.dependencyManifest = { forged: true };
    outer.payload = JSON.stringify(payload);
    outer.digest = `sha256:${createHash('sha256')
      .update(outer.payload as string, 'utf8')
      .digest('hex')}`;
    expect(() => staticTrustFromWorkerEnvelopeForTesting(JSON.stringify(outer), request)).toThrow(
      'unauthenticated envelope',
    );
  });

  it.each(['browserPosture', 'dataPlaneFacts', 'queryShapeFacts'] as const)(
    'rejects an authenticated derived proof that omits %s',
    (field) => {
      const proofRequest: StaticTrustWorkerRequest = {
        ...request,
        cache: false,
        challenge: '44'.repeat(32),
      };
      const trust = successfulTrust([], proofRequest);
      const proof = trust.derivedProof as Record<string, unknown>;
      delete proof[field];
      expect(() =>
        staticTrustFromWorkerEnvelopeForTesting(
          successfulEnvelopeForTrust(proofRequest, trust),
          proofRequest,
        ),
      ).toThrow('derived proof');
    },
  );

  it('rejects re-signed facts whose source bytes do not match the source digest', () => {
    const original = JSON.parse(successfulEnvelope([])) as { sourceDigest: string };
    const trust = successfulTrust([]);
    const changedSource = 'export default { changed: true };';
    const approvedSourceFiles = trust.approvedSourceFiles as {
      fileName: string;
      source: string;
    }[];
    approvedSourceFiles[0]!.source = changedSource;
    const sourceGraphFacts = trust.sourceGraphFacts as {
      sourceDerivedRegistryTransforms: { code: null; fileName: string; source: string }[];
    };
    sourceGraphFacts.sourceDerivedRegistryTransforms[0]!.source = changedSource;
    expect(() =>
      staticTrustFromWorkerEnvelopeForTesting(
        successfulEnvelopeForTrust(request, trust, {
          sourceDigest: original.sourceDigest,
        }),
        request,
      ),
    ).toThrow('stale source digest');
  });

  it.each([
    ['unknown file', { end: 1, file: 'copy.ts', start: 0 }],
    ['out-of-range end', { end: 19, file: 'app.ts', start: 0 }],
    ['surplus field', { copied: true, end: 1, file: 'app.ts', start: 0 }],
  ])('rejects an authenticated registry anchor with an %s', (_label, anchor) => {
    const trust = successfulTrust([]);
    const sourceGraphFacts = trust.sourceGraphFacts as {
      registryDeclarationAnchors: (readonly [string, unknown])[];
    };
    sourceGraphFacts.registryDeclarationAnchors = [[`page\0/`, anchor]];
    expect(() =>
      staticTrustFromWorkerEnvelopeForTesting(successfulEnvelopeForTrust(request, trust), request),
    ).toThrow('registry declaration anchors contains an invalid entry');
  });

  it('rejects an authenticated registry anchor with an unrecognized declaration key', () => {
    const trust = successfulTrust([]);
    const sourceGraphFacts = trust.sourceGraphFacts as {
      registryDeclarationAnchors: (readonly [string, unknown])[];
    };
    sourceGraphFacts.registryDeclarationAnchors = [
      [`copied\0/`, { end: 1, file: 'app.ts', start: 0 }],
    ];
    expect(() =>
      staticTrustFromWorkerEnvelopeForTesting(successfulEnvelopeForTrust(request, trust), request),
    ).toThrow('registry declaration anchors contains an invalid entry');
  });

  it('rehydrates exact compiler diagnostics into the parent registry', () => {
    const trust = staticTrustFromWorkerEnvelopeForTesting(
      successfulEnvelope([
        {
          agentGraphFacts: [],
          componentGraphFacts: [],
          diagnostics: [
            {
              code: 'KV210',
              fileName: 'app.ts',
              help: 'Name the handler for stable generated identity.',
              length: 5,
              message: 'Anonymous handler; name it for stable identity.',
              severity: 'lint',
              source: { end: 20, file: 'app.ts', start: 15 },
              start: { column: 16, line: 1 },
            },
          ],
          handlerWriteSinkFacts: [],
          publishToClientFacts: [],
          taskGraphFacts: [],
          updateCoverage: [],
        },
      ]),
      request,
    );

    const diagnostic = trust.sourceGraphFacts.components[0]!.diagnostics[0];
    expect(isRegisteredDiagnostic(diagnostic)).toBe(true);
    expect(diagnostic).toMatchObject({
      code: 'KV210',
      fileName: 'app.ts',
      severity: 'lint',
    });
  });

  it('rejects forged compiler diagnostic fields before parent rehydration', () => {
    const component = {
      agentGraphFacts: [],
      componentGraphFacts: [],
      diagnostics: [
        {
          code: 'KV210',
          fileName: 'app.ts',
          message: 'forged',
          severity: 'error',
        },
      ],
      handlerWriteSinkFacts: [],
      publishToClientFacts: [],
      taskGraphFacts: [],
      updateCoverage: [],
    };

    expect(() =>
      staticTrustFromWorkerEnvelopeForTesting(successfulEnvelope([component]), request),
    ).toThrow(/severity does not match/u);
    component.diagnostics[0]!.severity = 'lint';
    Object.assign(component.diagnostics[0]!, { forgedAuthority: true });
    expect(() =>
      staticTrustFromWorkerEnvelopeForTesting(successfulEnvelope([component]), request),
    ).toThrow(/not a compiler diagnostic field/u);
  });

  it('rejects duplicate map keys even when the envelope digest is valid', () => {
    const facts = {
      capabilities: [],
      cookieDowngrades: [],
      diagnostics: [],
      revealed: [],
      trustEscapes: [],
      unregisteredSinks: [],
    };
    const approvedSourceFiles = [{ fileName: 'app.ts', source: 'export default {};' }];
    const sourceFrame = `${Buffer.byteLength('app.ts')}:app.ts${Buffer.byteLength(
      'export default {};',
    )}:export default {};`;
    expect(() =>
      staticTrustFromWorkerEnvelopeForTesting(
        envelope(
          {
            status: 'ok',
            trust: {
              approvedSourceFiles,
              capabilityClosure: {
                dependencyManifest: {},
                diagnostics: [],
                facts: [],
                packageRequests: [],
              },
              facts,
              files: approvedSourceFiles,
              sourceGraphFacts: {
                components: [],
                domainDeclarationNames: [],
                registryDeclarationAnchors: [
                  ['route', null],
                  ['route', null],
                ],
                routeOutcomes: [],
                routePages: [],
                sourceDerivedRegistryTransforms: [],
              },
            },
          },
          {
            factsDigest: `sha256:${createHash('sha256')
              .update(JSON.stringify(facts), 'utf8')
              .digest('hex')}`,
            sourceDigest: `sha256:${createHash('sha256')
              .update(sourceFrame, 'utf8')
              .digest('hex')}`,
          },
        ),
        request,
      ),
    ).toThrow('invalid entry');
  });
});
