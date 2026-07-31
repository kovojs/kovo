import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';
import { afterEach, describe, expect, it } from 'vitest';

import { formatKovoDiagnostics } from '../diagnostic.js';
import {
  runPreEvaluationStaticTrustWorkerRequest,
  staticConfigTrustFromWorkerEnvelopeForTesting,
  staticTrustFromWorkerEnvelopeForTesting,
  type StaticTrustWorkerRequest,
} from './build-export.js';

const schema = 'kovo-static-trust-worker/v1';
const temporaryRoots: string[] = [];
const request: StaticTrustWorkerRequest = {
  authenticationKey: '11'.repeat(32),
  cache: null,
  challenge: '22'.repeat(32),
  command: null,
  kind: 'app',
  modulePath: '/app/app.ts',
  paranoidStaticAdvisory: false,
  root: '/app',
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function requestDigest(expected: StaticTrustWorkerRequest): string {
  const identity = JSON.stringify({
    cache: expected.cache,
    challenge: expected.challenge,
    command: expected.command,
    kind: expected.kind,
    modulePath: expected.modulePath,
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
    { kind: expected.kind, status: 'ok', trust },
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

const configRequest: StaticTrustWorkerRequest = {
  ...request,
  cache: null,
  challenge: '55'.repeat(32),
  command: 'build',
  kind: 'config',
  modulePath: '/app/kovo.config.ts',
};

function successfulConfigTrust(): Record<string, unknown> {
  return {
    facts: {
      capabilities: [],
      cookieDowngrades: [],
      diagnostics: [],
      revealed: [],
      trustEscapes: [],
      unregisteredSinks: [],
    },
    files: [{ fileName: 'kovo.config.ts', source: 'export default {};' }],
    path: configRequest.modulePath,
  };
}

function successfulConfigEnvelope(
  trust: Record<string, unknown> = successfulConfigTrust(),
  overrides: Record<string, unknown> = {},
): string {
  const facts = trust.facts!;
  const files = Array.isArray(trust.files)
    ? (trust.files as readonly { readonly fileName: string; readonly source: string }[])
    : [];
  const sourceFrame = files
    .map(
      (file) =>
        `${Buffer.byteLength(file.fileName)}:${file.fileName}${Buffer.byteLength(file.source)}:${file.source}`,
    )
    .join('');
  return envelopeFor(
    configRequest,
    { kind: 'config', status: 'ok', trust },
    {
      factsDigest: `sha256:${createHash('sha256')
        .update(JSON.stringify(facts), 'utf8')
        .digest('hex')}`,
      sourceDigest: `sha256:${createHash('sha256').update(sourceFrame, 'utf8').digest('hex')}`,
      ...overrides,
    },
  );
}

describe('static-trust worker protocol', () => {
  it('preserves a diagnostic failure without evaluating an authored module in the parent', () => {
    const diagnostics = [
      {
        category: 'proof',
        code: 'KV235',
        help: 'Write TSX and let Kovo emit lowered IR. SPEC §5.2.',
        message: 'App source hand-authors lowered IR.',
        severity: 'error',
        source: { end: 31, file: 'app.ts', start: 17 },
        version: 'kovo-diagnostic/v1',
      },
    ];
    let thrown: unknown;
    try {
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
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      diagnostics: [
        {
          category: 'proof',
          code: 'KV235',
          source: { end: 31, file: 'app.ts', start: 17 },
          version: 'kovo-diagnostic/v1',
        },
      ],
      message: 'kovo build check preflight failed:\\nERROR KV235',
    });
    const transferred = thrown as { diagnostics: Parameters<typeof formatKovoDiagnostics>[0] };
    expect(JSON.parse(formatKovoDiagnostics(transferred.diagnostics, 'json'))).toMatchObject({
      diagnostics: [
        {
          code: 'KV235',
          source: { end: 31, file: 'app.ts', start: 17 },
        },
      ],
      version: 'kovo-diagnostic/v1',
    });
  });

  it.each([
    ['unknown code', { code: 'KV999' }],
    ['wrong severity', { severity: 'warning' }],
    ['wrong category', { category: 'usage' }],
    ['wrong version', { version: 'kovo-diagnostic/v0' }],
    ['forged source field', { source: { copied: true, end: 31, file: 'app.ts', start: 17 } }],
  ])('rejects authenticated worker diagnostics with %s', (_label, override) => {
    expect(() =>
      staticTrustFromWorkerEnvelopeForTesting(
        envelope({
          error: {
            diagnostics: [
              {
                category: 'proof',
                code: 'KV235',
                help: 'Write TSX and let Kovo emit lowered IR. SPEC §5.2.',
                message: 'App source hand-authors lowered IR.',
                severity: 'error',
                source: { end: 31, file: 'app.ts', start: 17 },
                version: 'kovo-diagnostic/v1',
                ...override,
              },
            ],
            kind: 'diagnostic',
            message: 'kovo build check preflight failed:\\nERROR KV235',
          },
          status: 'error',
        }),
        request,
      ),
    ).toThrow();
  });

  it('preserves a real KV235 code and source anchor through the authenticated worker', async () => {
    const temporaryParent = path.join(process.cwd(), 'node_modules', '.tmp');
    mkdirSync(temporaryParent, { recursive: true });
    const root = mkdtempSync(path.join(temporaryParent, 'kovo-static-trust-kv235-'));
    temporaryRoots.push(root);
    const modulePath = path.join(root, 'app.tsx');
    writeFileSync(
      path.join(root, 'package.json'),
      `${JSON.stringify({
        dependencies: { '@kovojs/core': '0.3.0' },
        name: 'kovo-static-trust-kv235',
        private: true,
        type: 'module',
      })}\n`,
      'utf8',
    );
    writeFileSync(modulePath, "export { AuthoredTsx } from './component.js';\n", 'utf8');
    writeFileSync(
      path.join(root, 'component.tsx'),
      [
        "import { component } from '@kovojs/core';",
        "import { jsx as authoredJsxRuntime } from '@kovojs/server/jsx-runtime';",
        'export const authoredLoweredIrProof = authoredJsxRuntime;',
        'export const AuthoredTsx = component({ render() { return <div>safe</div>; } });',
        '',
      ].join('\n'),
      'utf8',
    );
    const expected: StaticTrustWorkerRequest = {
      authenticationKey: '77'.repeat(32),
      cache: null,
      challenge: '88'.repeat(32),
      command: null,
      kind: 'app',
      modulePath,
      paranoidStaticAdvisory: false,
      root,
    };
    const output = await runPreEvaluationStaticTrustWorkerRequest(JSON.stringify(expected));
    const outer = JSON.parse(output) as { payload: string };
    const payload = JSON.parse(outer.payload) as {
      error: { diagnostics: { code: string; source: unknown }[] };
      status: string;
    };
    expect(payload.status, outer.payload.slice(0, 8_000)).toBe('error');
    const rawKv235 = payload.error.diagnostics?.find((diagnostic) => diagnostic.code === 'KV235');
    expect(rawKv235, outer.payload.slice(0, 8_000)).toBeDefined();
    expect(payload.error.diagnostics?.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['KV235', 'KV424']),
    );

    let thrown: unknown;
    try {
      staticTrustFromWorkerEnvelopeForTesting(output, expected);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const transferred = thrown as { diagnostics: Parameters<typeof formatKovoDiagnostics>[0] };
    const transferredKv235 = transferred.diagnostics.find(
      (diagnostic) => diagnostic.code === 'KV235',
    );
    expect(transferredKv235).toMatchObject({
      category: 'proof',
      code: 'KV235',
      source: rawKv235?.source,
      version: 'kovo-diagnostic/v1',
    });
    expect(() => formatKovoDiagnostics(transferred.diagnostics, 'json')).not.toThrow();
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

  it('authenticates config trust and rejects replay, tamper, omission, and stale source', () => {
    expect(
      staticConfigTrustFromWorkerEnvelopeForTesting(successfulConfigEnvelope(), configRequest).path,
    ).toBe(configRequest.modulePath);

    expect(() =>
      staticConfigTrustFromWorkerEnvelopeForTesting(successfulConfigEnvelope(), {
        ...configRequest,
        challenge: '66'.repeat(32),
      }),
    ).toThrow('unauthenticated envelope');

    const tampered = JSON.parse(successfulConfigEnvelope()) as Record<string, unknown>;
    const tamperedPayload = JSON.parse(tampered.payload as string) as {
      trust: { facts: { capabilities: unknown[] } };
    };
    tamperedPayload.trust.facts.capabilities.push({ forged: true });
    tampered.payload = JSON.stringify(tamperedPayload);
    tampered.digest = `sha256:${createHash('sha256')
      .update(tampered.payload as string, 'utf8')
      .digest('hex')}`;
    expect(() =>
      staticConfigTrustFromWorkerEnvelopeForTesting(JSON.stringify(tampered), configRequest),
    ).toThrow('unauthenticated envelope');

    const omitted = successfulConfigTrust();
    delete omitted.files;
    expect(() =>
      staticConfigTrustFromWorkerEnvelopeForTesting(
        successfulConfigEnvelope(omitted),
        configRequest,
      ),
    ).toThrow();

    const original = JSON.parse(successfulConfigEnvelope()) as { sourceDigest: string };
    const stale = successfulConfigTrust();
    (stale.files as { fileName: string; source: string }[])[0]!.source =
      'export default { changed: true };';
    expect(() =>
      staticConfigTrustFromWorkerEnvelopeForTesting(
        successfulConfigEnvelope(stale, { sourceDigest: original.sourceDigest }),
        configRequest,
      ),
    ).toThrow('stale config source digest');
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
            kind: 'app',
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
