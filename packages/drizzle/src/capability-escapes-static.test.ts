import { describe, expect, it } from 'vitest';

import {
  collectCapabilityEscapesFromProject,
  collectCookieDowngradesFromProject,
  collectRuntimeRevealFactsFromProject,
  collectStaticBuildTrustFactsFromProject,
  collectUnregisteredSinksFromProject,
} from '@kovojs/drizzle/internal/static';
import type { TrustEscapeSourceFileInput } from '@kovojs/drizzle/internal/static';

// SPEC §6.6 (audit-only), threat-matrix-plan.md M3: these drive the REAL static producer that
// `kovo explain --capabilities` reads — the collector detects each app-authored escape at its CALL
// SITE from source, so a merely-built app surfaces its whole escape-hatch surface without a live run.

function capabilitiesFor(source: string, fileName = 'app.tsx') {
  return collectCapabilityEscapesFromProject({ files: [{ fileName, source }] });
}

function capabilitiesForFiles(files: readonly TrustEscapeSourceFileInput[]) {
  return collectCapabilityEscapesFromProject({ files });
}

describe('@kovojs/drizzle capability-escape collector (SPEC §6.6, audit-only, M3)', () => {
  it('surfaces the write-governance escapes serverValue and trustedAssign', () => {
    const capabilities = capabilitiesFor(`
      import { serverValue, trustedAssign } from '@kovojs/server';
      export function grant(input: { role: string }) {
        const a = serverValue(generatedId, 'server-generated key');
        const b = trustedAssign(input.role, 'admin role grant');
        return [a, b];
      }
    `);

    expect(capabilities).toEqual([
      expect.objectContaining({
        justification: 'server-generated key',
        kind: 'serverValue',
        site: 'app.tsx:4',
        target: 'serverValue',
      }),
      expect.objectContaining({
        justification: 'admin role grant',
        kind: 'serverValue',
        site: 'app.tsx:5',
        target: 'trustedAssign',
      }),
    ]);
  });

  it('surfaces an unsafeRegex ReDoS-risk acceptance with its source and justification (KV434)', () => {
    const capabilities = capabilitiesFor(`
      import { unsafeRegex } from '@kovojs/server';
      export const re = unsafeRegex(/(a+)+$/, 'legacy importer format is trusted');
    `);

    expect(capabilities).toEqual([
      expect.objectContaining({
        justification: 'legacy importer format is trusted',
        kind: 'unsafeRegex',
        site: 'app.tsx:3',
        target: '/(a+)+$/',
      }),
    ]);
  });

  it('surfaces declarePublicRelation with its relation and reason', () => {
    const capabilities = capabilitiesFor(`
      import { declarePublicRelation } from '@kovojs/server';
      export const rel = declarePublicRelation({
        relation: 'public.kovo_order_totals_mv',
        reason: 'aggregate totals contain no tenant identifiers',
      });
    `);

    expect(capabilities).toEqual([
      expect.objectContaining({
        justification: 'aggregate totals contain no tenant identifiers',
        kind: 'publicRelation',
        site: 'app.tsx:3',
        target: 'public.kovo_order_totals_mv',
      }),
    ]);
  });

  it('surfaces usePostgresSystemDb with a leading justification comment', () => {
    const capabilities = capabilitiesFor(`
      import { usePostgresSystemDb } from '@kovojs/server/internal/postgres-capability';
      // justification: framework-owned system DB capability remains opaque
      export const run = usePostgresSystemDb(capability, (db) => db);
    `);

    expect(capabilities).toEqual([
      expect.objectContaining({
        justification: 'framework-owned system DB capability remains opaque',
        kind: 'systemDb',
        site: 'app.tsx:4',
        target: 'capability',
      }),
    ]);
  });

  it('surfaces accept.unverified upload escapes', () => {
    const capabilities = capabilitiesFor(`
      import { accept } from '@kovojs/server';
      export const zip = accept.unverified(['application/zip'], 'legacy importer trusts client type');
    `);

    expect(capabilities).toEqual([
      expect.objectContaining({
        justification: 'legacy importer trusts client type',
        kind: 'acceptUnverified',
        site: 'app.tsx:3',
        target: "['application/zip']",
      }),
    ]);
  });

  it('surfaces unsafeInline response escapes', () => {
    const capabilities = capabilitiesFor(`
      import { unsafeInline } from '@kovojs/server';
      export const receipt = unsafeInline('framework-rasterized image stream');
    `);

    expect(capabilities).toEqual([
      expect.objectContaining({
        justification: 'framework-rasterized image stream',
        kind: 'unsafeInline',
        site: 'app.tsx:3',
        target: 'unsafeInline',
      }),
    ]);
  });

  it('surfaces an unsafeCookie downgrade capability with its weakened floor', () => {
    const capabilities = capabilitiesFor(`
      import { serializeCookie, unsafeCookie } from '@kovojs/server';
      export const header = serializeCookie('embed_sid', value, {
        class: 'session',
        sameSite: 'none',
        unsafe: unsafeCookie({ downgrade: { sameSite: 'none' }, justification: 'third-party embed' }),
      });
    `);

    expect(capabilities).toEqual([
      expect.objectContaining({
        justification: 'third-party embed',
        kind: 'unsafeCookie',
        site: 'app.tsx:6',
        target: 'sameSite=none',
      }),
    ]);
  });

  it('surfaces managed-DB reader method escapes crossOwnerRead and rawRead by method name', () => {
    const capabilities = capabilitiesFor(`
      export async function support(reader: any) {
        const a = await reader.crossOwnerRead({
          relation: 'public.orders',
          reason: 'admin support export across owners',
        });
        const b = await reader.rawRead({ reason: 'reporting view join' });
        return [a, b];
      }
    `);

    expect(capabilities).toEqual([
      expect.objectContaining({
        justification: 'admin support export across owners',
        kind: 'crossOwnerRead',
        site: 'app.tsx:3',
        target: 'public.orders',
      }),
      expect.objectContaining({
        justification: 'reporting view join',
        kind: 'rawRead',
        site: 'app.tsx:7',
      }),
    ]);
  });

  it('does not classify inherited Object.prototype method names as capabilities', () => {
    const capabilities = capabilitiesFor(`
      export function ordinaryCalls(value: object) {
        value.valueOf();
        value.toString();
        value.constructor();
        value.__proto__();
      }
    `);

    expect(capabilities).toEqual([]);
  });

  it('surfaces non-request principal elevations actAs, declareSystemRead, declareSystemWrite (DEC-G)', () => {
    const capabilities = capabilitiesFor(`
      export async function job(ctx: any) {
        const s1 = ctx.actAs('user_42');
        const s2 = ctx.declareSystemRead('nightly rollup reads all tenants');
        const s3 = ctx.declareSystemWrite('nightly rollup writes aggregates');
        return [s1, s2, s3];
      }
    `);

    expect(capabilities).toEqual([
      expect.objectContaining({ kind: 'actAs', site: 'app.tsx:3', target: 'user_42' }),
      expect.objectContaining({
        justification: 'nightly rollup reads all tenants',
        kind: 'declareSystemRead',
        site: 'app.tsx:4',
      }),
      expect.objectContaining({
        justification: 'nightly rollup writes aggregates',
        kind: 'declareSystemWrite',
        site: 'app.tsx:5',
      }),
    ]);
  });

  it('surfaces one egress allowInternal entry per host:port', () => {
    const capabilities = capabilitiesFor(`
      import { createApp } from '@kovojs/server';
      export const app = createApp({
        egress: {
          allowInternal: ['10.0.0.5:9090', '10.0.0.6:9091'],
          allowInternalJustification: 'internal metrics sidecar on the pod network',
        },
      });
    `);

    expect(capabilities).toEqual([
      expect.objectContaining({
        justification: 'internal metrics sidecar on the pod network',
        kind: 'egressAllowInternal',
        target: '10.0.0.5:9090',
      }),
      expect.objectContaining({
        justification: 'internal metrics sidecar on the pod network',
        kind: 'egressAllowInternal',
        target: '10.0.0.6:9091',
      }),
    ]);
  });

  it('does not false-positive on a local same-named helper (import provenance is required)', () => {
    const capabilities = capabilitiesFor(`
      function serverValue(v: unknown, _reason: string) { return v; }
      export const x = serverValue(1, 'not the framework escape');
    `);

    expect(capabilities).toEqual([]);
  });

  it('resolves aliased imports back to the original escape name', () => {
    const capabilities = capabilitiesFor(`
      import { unsafeRegex as ur } from '@kovojs/server';
      export const re = ur(/(a+)+$/, 'aliased still audited');
    `);

    expect(capabilities).toEqual([
      expect.objectContaining({ kind: 'unsafeRegex', justification: 'aliased still audited' }),
    ]);
  });

  it('emits escapes with no justification (audit surfaces them either way)', () => {
    const capabilities = capabilitiesFor(`
      import { serverValue } from '@kovojs/server';
      export const x = serverValue(id);
    `);

    expect(capabilities).toEqual([
      expect.objectContaining({ kind: 'serverValue', target: 'serverValue' }),
    ]);
    expect(capabilities[0]?.justification).toBeUndefined();
  });
});

describe('@kovojs/drizzle cookie-downgrade collector (SPEC §6.6/§9.1, audit-only, M3)', () => {
  it('produces a CookieDowngradeExplain from a serializeCookie + unsafeCookie call', () => {
    const downgrades = collectCookieDowngradesFromProject({
      files: [
        {
          fileName: 'app.tsx',
          source: `
            import { serializeCookie, unsafeCookie } from '@kovojs/server';
            export const header = serializeCookie('embed_sid', value, {
              class: 'session',
              sameSite: 'none',
              unsafe: unsafeCookie({
                downgrade: { sameSite: 'none' },
                justification: 'third-party embed login',
              }),
            });
          `,
        },
      ],
    });

    expect(downgrades).toEqual([
      {
        class: 'session',
        downgrade: { sameSite: 'none' },
        justification: 'third-party embed login',
        name: 'embed_sid',
        site: 'app.tsx:3',
      },
    ]);
  });

  it('captures an httpOnly downgrade on an auth-class cookie', () => {
    const downgrades = collectCookieDowngradesFromProject({
      files: [
        {
          fileName: 'app.tsx',
          source: `
            import { serializeCookie, unsafeCookie } from '@kovojs/server';
            export const header = serializeCookie('legacy_token', value, {
              class: 'auth',
              httpOnly: false,
              unsafe: unsafeCookie({
                downgrade: { httpOnly: false },
                justification: 'legacy JS reads the token',
              }),
            });
          `,
        },
      ],
    });

    expect(downgrades).toEqual([
      {
        class: 'auth',
        downgrade: { httpOnly: false },
        justification: 'legacy JS reads the token',
        name: 'legacy_token',
        site: 'app.tsx:3',
      },
    ]);
  });
});

describe('@kovojs/drizzle static build trust-fact aggregate', () => {
  it('projects the exact individual collector facts from one immutable syntactic project', () => {
    const files = [
      {
        fileName: 'app.mjs',
        source: `
          import { execFileSync } from 'node:child_process';
          import { mutation, serializeCookie, serverValue, unsafeCookie } from '@kovojs/server';
          export const header = serializeCookie('embed_sid', value, {
            class: 'session',
            unsafe: unsafeCookie({
              downgrade: { sameSite: 'none' },
              justification: 'third-party embed login',
            }),
          });
          export const generated = serverValue(value, 'server generated');
          export const unsafe = mutation({ handler(input) { execFileSync(input.value); } });
        `,
      },
    ];

    expect(collectStaticBuildTrustFactsFromProject({ files })).toEqual({
      capabilities: collectCapabilityEscapesFromProject({ files }),
      cookieDowngrades: collectCookieDowngradesFromProject({ files }),
      revealed: collectRuntimeRevealFactsFromProject({ files }),
      unregisteredSinks: collectUnregisteredSinksFromProject({ files }),
    });
  });

  it('keeps the aggregate closed for an otherwise unmarked opaque call', () => {
    const facts = collectStaticBuildTrustFactsFromProject({
      files: [
        {
          fileName: 'app.mjs',
          source: `
            import { mutation } from '@kovojs/server';
            export const unsafe = mutation({
              handler(input) { return input.callback(input.value); },
            });
          `,
        },
      ],
    });

    expect(facts.unregisteredSinks).toEqual([
      expect.objectContaining({
        sink: 'request-handler.opaque-call',
        source: 'input.callback',
      }),
    ]);
  });

  // SPEC §6.6 / C13: the build aggregate and the standalone TASK B collector consume the same
  // immutable source snapshot. Root spelling is never a sound reason to skip authoritative analysis.
  it.each([
    {
      files: [
        {
          fileName: 'server-barrel.ts',
          source: `export { mutation as defineWrite } from '@kovojs/server';`,
        },
        {
          fileName: 'app.ts',
          source: `
            import { defineWrite } from './server-barrel.js';
            export const unsafe = defineWrite({
              handler() { return globalThis['pro\\u0063ess'].env.SECRET; },
            });
          `,
        },
      ],
      label: 'a local framework-factory re-export',
    },
    {
      files: [
        {
          fileName: 'app.ts',
          source: `
            import * as server from '@kovojs/server';
            const api = server;
            export const unsafe = api.mutation({
              handler() { return globalThis['pro\\u0063ess'].env.SECRET; },
            });
          `,
        },
      ],
      label: 'a namespace alias',
    },
    {
      files: [
        {
          fileName: 'app.ts',
          source: `
            import { mutation } from '@kovojs/server';
            export const unsafe = mutation({
              ['handler']() { return globalThis['pro\\u0063ess'].env.SECRET; },
            });
          `,
        },
      ],
      label: 'a computed callback property',
    },
    {
      files: [
        {
          fileName: 'server-barrel.ts',
          source: `export { mut\\u0061tion as defineWrite } from '@kovojs/server';`,
        },
        {
          fileName: 'app.ts',
          source: `
            import { defineWrite } from './server-barrel.js';
            const callbacks = {
              handler() { return globalThis['pro\\u0063ess'].env.SECRET; },
            };
            export const unsafe = defineWrite({ ...callbacks });
          `,
        },
      ],
      label: 'a spread callback record',
    },
    {
      files: [
        {
          fileName: 'app.ts',
          source: `
            import { query as frameworkQuery } from '@kovojs/server';
            const defineRead = true ? frameworkQuery : frameworkQuery;
            export const unsafe = defineRead({
              load() { return globalThis['pro\\u0063ess'].env.SECRET; },
            });
          `,
        },
      ],
      label: 'a conditionally projected root factory',
    },
  ])('matches standalone TASK B facts through $label', ({ files }) => {
    const standalone = {
      capabilities: collectCapabilityEscapesFromProject({ files }),
      cookieDowngrades: collectCookieDowngradesFromProject({ files }),
      revealed: collectRuntimeRevealFactsFromProject({ files }),
      unregisteredSinks: collectUnregisteredSinksFromProject({ files }),
    };

    expect(standalone.unregisteredSinks).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'node:process.env' })]),
    );
    expect(collectStaticBuildTrustFactsFromProject({ files })).toEqual(standalone);
  });
});

// silence unused-import lint if the helper is not exercised in every file iteration path.
void capabilitiesForFiles;
