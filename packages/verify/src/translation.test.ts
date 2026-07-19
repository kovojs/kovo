import { describe, expect, it } from 'vitest';

import { type KovoEmittedTranslationInput, verifyEmittedTranslation } from './translation.js';

// @kovo-security-classifier-corpus finite-security-operation-ir
// @kovo-security-certifies C13 independently-reparsed-emitted-translation
describe('emitted translation validation (Plan 3 §2.2)', () => {
  it('accepts exact reviewed imports, secret-free client surfaces, covered kinds, and operation records', () => {
    expect(verifyEmittedTranslation(validTranslation())).toEqual({ findings: [], ok: true });

    const wrapped = validTranslation();
    const server = artifact(wrapped, 'server');
    server.source = `export function renderSource() { return \`${server.source.trim()}\`; }\n`;
    expect(verifyEmittedTranslation(wrapped)).toEqual({ findings: [], ok: true });
  });

  it('rejects an emitted binding absent from the KV437-reviewed import set', () => {
    const input = validTranslation();
    const client = artifact(input, 'client');
    client.source = client.source.replace(
      'safeCall as call',
      'safeCall as call, STRIPE_SECRET_KEY',
    );

    expect(verifyEmittedTranslation(input).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'client-import-unreviewed',
          relation: 'client-import-subset',
        }),
      ]),
    );
  });

  it('rejects exact secret field tokens in client or registry output without substring false positives', () => {
    const safe = validTranslation();
    artifact(safe, 'registry').source += '\ninterface Safe { passwordHashDigest: string }\n';
    expect(verifyEmittedTranslation(safe)).toMatchObject({ ok: true });

    const commented = validTranslation();
    artifact(commented, 'registry').source += '\n// passwordHash\n';
    expect(verifyEmittedTranslation(commented).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: 'registry',
          code: 'secret-field-emitted',
          relation: 'secret-field-absence',
        }),
      ]),
    );

    for (const kind of ['client', 'registry'] as const) {
      const input = validTranslation();
      artifact(input, kind).source += '\ninterface Leak { passwordHash: string }\n';
      expect(verifyEmittedTranslation(input).findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            artifactKind: kind,
            code: 'secret-field-emitted',
            relation: 'secret-field-absence',
          }),
        ]),
      );
    }
  });

  it('fails a synthetic emitted kind until the coverage policy classifies it', () => {
    const input = validTranslation();
    input.artifacts.push({ fileName: 'generated/probe.map', kind: 'source-map', source: '{}' });

    expect(verifyEmittedTranslation(input).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'artifact-kind-unreviewed',
          relation: 'artifact-coverage',
        }),
      ]),
    );
  });

  it('requires server and per-handler operation JSON to use the frozen vocabularies and decision facts', () => {
    const unknown = validTranslation();
    artifact(unknown, 'client').source = artifact(unknown, 'client').source.replace(
      'browser.state.write',
      'browser.state.shell',
    );
    expect(verifyEmittedTranslation(unknown).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'operation-kind-unreviewed',
          relation: 'operation-serialization',
        }),
      ]),
    );

    const drifted = validTranslation();
    artifact(drifted, 'server').source = artifact(drifted, 'server').source.replace(
      '"target":"users"',
      '"target":"admins"',
    );
    expect(verifyEmittedTranslation(drifted).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'operation-decision-mismatch',
          relation: 'operation-serialization',
        }),
      ]),
    );
  });

  it('rejects JavaScript object syntax where the emission contract requires own-data JSON', () => {
    const input = validTranslation();
    artifact(input, 'client').source = artifact(input, 'client').source.replace(
      '[{"door":"compiler-state","kind":"browser.state.write","target":"state.count"}]',
      "[{ door: 'compiler-state', kind: 'browser.state.write', target: 'state.count' }]",
    );

    expect(verifyEmittedTranslation(input).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'operation-json',
          relation: 'operation-serialization',
        }),
      ]),
    );
  });
});

function validTranslation(): KovoEmittedTranslationInput & {
  artifacts: { fileName: string; kind: string; source: string }[];
} {
  return {
    artifacts: [
      {
        fileName: 'generated/card.client.js',
        kind: 'client',
        source: [
          'import { securityHandler } from "@kovojs/browser/generated";',
          'import { safeCall as call } from "./safe.client.js";',
          'export const Card$button_click = securityHandler([{"door":"compiler-state","kind":"browser.state.write","target":"state.count"}], (_event, _ctx) => { return call(); });',
          '',
        ].join('\n'),
      },
      {
        fileName: 'generated/card.server.js',
        kind: 'server',
        source:
          'export const __kovoSecurityOperationManifest_v1 = Object.freeze({ operations: Object.freeze([{"door":"managed-db","kind":"server.database.read","target":"users"}]), schema: "kovo-security-operation-ir/v1", semanticGraph: undefined });\n',
      },
      {
        fileName: 'generated/registries.d.ts',
        kind: 'registry',
        source: 'export interface QueryRegistry { user: { id: string } }\n',
      },
      {
        fileName: 'generated/card.css',
        kind: 'css',
        source: '.card { color: green; }\n',
      },
    ],
    decision: {
      clientHandlers: [
        {
          exportName: 'Card$button_click',
          operations: [
            {
              door: 'compiler-state',
              kind: 'browser.state.write',
              target: 'state.count',
            },
          ],
        },
      ],
      clientImports: [
        {
          imports: [{ importedName: 'securityHandler', localName: 'securityHandler' }],
          moduleSpecifier: '@kovojs/browser/generated',
        },
        {
          imports: [{ importedName: 'safeCall', localName: 'call' }],
          moduleSpecifier: './safe.client.js',
        },
      ],
      secretFieldNames: ['passwordHash'],
      serverOperations: [{ door: 'managed-db', kind: 'server.database.read', target: 'users' }],
    },
  };
}

function artifact(
  input: ReturnType<typeof validTranslation>,
  kind: 'client' | 'registry' | 'server',
): { fileName: string; kind: string; source: string } {
  return input.artifacts.find((entry) => entry.kind === kind)!;
}
