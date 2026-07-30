import { createHash } from 'node:crypto';

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
