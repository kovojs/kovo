import { createHash } from 'node:crypto';

import { isRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import { staticTrustFromWorkerEnvelopeForTesting } from './build-export.js';

const schema = 'kovo-static-trust-worker/v1';

function envelope(payloadValue: unknown, overrides: Record<string, unknown> = {}): string {
  const payload = JSON.stringify(payloadValue);
  return JSON.stringify({
    digest: `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`,
    payload,
    schema,
    ...overrides,
  });
}

function successfulEnvelope(components: readonly unknown[]): string {
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
  return envelope(
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
          appContractStaticFacts: [],
          compilerDependencies: [],
          compilerSecuritySemanticSources: [],
          compilerTaskBFiniteVerdict: {},
          components,
          domainDeclarationNames: [],
          registryDeclarationAnchors: [],
          routeOutcomes: [],
          routePages: [],
          sourceDerivedRegistryTransforms: [
            { code: null, fileName: 'app.ts', source: 'export default {};' },
          ],
        },
      },
    },
    {
      factsDigest: `sha256:${createHash('sha256')
        .update(JSON.stringify(facts), 'utf8')
        .digest('hex')}`,
      sourceDigest: `sha256:${createHash('sha256').update(sourceFrame, 'utf8').digest('hex')}`,
    },
  );
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
      ),
    ).toThrow('kovo build check preflight failed:\\nERROR KV235');
  });

  it.each([
    ['wrong schema', envelope({ status: 'error' }, { schema: 'kovo-static-trust-worker/v0' })],
    ['wrong digest', envelope({ status: 'error' }, { digest: 'sha256:00' })],
    ['truncated JSON', '{"schema":'],
    ['multiple documents', `${envelope({ status: 'error' })}${envelope({ status: 'error' })}`],
  ])('rejects %s output before trusting facts', (_label, output) => {
    expect(() => staticTrustFromWorkerEnvelopeForTesting(output)).toThrow();
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

    expect(() => staticTrustFromWorkerEnvelopeForTesting(successfulEnvelope([component]))).toThrow(
      /severity does not match/u,
    );
    component.diagnostics[0]!.severity = 'lint';
    Object.assign(component.diagnostics[0]!, { forgedAuthority: true });
    expect(() => staticTrustFromWorkerEnvelopeForTesting(successfulEnvelope([component]))).toThrow(
      /not a compiler diagnostic field/u,
    );
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
                appContractStaticFacts: [],
                compilerDependencies: [],
                compilerSecuritySemanticSources: [],
                compilerTaskBFiniteVerdict: {},
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
      ),
    ).toThrow('invalid entry');
  });
});
