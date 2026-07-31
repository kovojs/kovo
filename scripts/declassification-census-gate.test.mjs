import { describe, expect, it } from 'vitest';

import {
  DECLASSIFICATION_DOORS,
  collectDeclassificationSitesFromSource,
  declassificationCensusSchema,
  renderDeclassificationCensus,
  validateDeclassificationCensus,
} from './declassification-census-gate.mjs';

const fixtureFile = 'packages/example/src/declassify.ts';
const fixtureSource = `
import {
  publishToClient,
  revealSecret as exposeSecret,
  revealUntrusted,
  trustedReveal,
} from '@kovojs/core';
import * as server from '@kovojs/server';

export function expose(value) {
  value.reveal('reviewed member reveal');
  exposeSecret(value, 'reviewed secret reveal');
  trustedReveal(value, { justification: 'reviewed projection' });
  revealUntrusted(value, 'validated request value');
  server.serverValue(value, 'server provenance');
  server.trustedAssign(value, 'privileged assignment');
  return publishToClient('public', { reason: 'public protocol label' });
}
`;

function collect(source = fixtureSource, file = fixtureFile) {
  return collectDeclassificationSitesFromSource(file, source);
}

describe('declassification census gate (C13 anchor)', () => {
  it('derives every closed door and its exact lexical capability identity', () => {
    const sites = collect();

    expect(DECLASSIFICATION_DOORS).toEqual([
      '.reveal',
      'publishToClient',
      'revealSecret',
      'revealUntrusted',
      'serverValue',
      'trustedAssign',
      'trustedReveal',
    ]);
    expect(sites.map(({ door, identity }) => [door, identity])).toEqual([
      ['.reveal', 'member:.reveal'],
      ['revealSecret', 'import:@kovojs/core#revealSecret'],
      ['trustedReveal', 'import:@kovojs/core#trustedReveal'],
      ['revealUntrusted', 'import:@kovojs/core#revealUntrusted'],
      ['serverValue', 'import:@kovojs/server#serverValue'],
      ['trustedAssign', 'import:@kovojs/server#trustedAssign'],
      ['publishToClient', 'import:@kovojs/core#publishToClient'],
    ]);
    expect(new Set(sites.map((site) => site.site)).size).toBe(sites.length);
  });

  it('recognizes the exact public security subpaths without accepting lookalikes', () => {
    const sites = collect(`
import * as security from '@kovojs/core/security';
import { revealUntrusted as revealRequest } from '@kovojs/core/security';
import { serverValue, trustedAssign as assignReviewed } from '@kovojs/server/write-safety';
import { revealSecret as foreignReveal } from '@kovojs/core/security/internal';
import { trustedAssign as foreignAssign } from '@kovojs/server/write-safety-extra';

export function run(value) {
  security.publishToClient(value, { reason: 'public projection' });
  revealRequest(value, { justification: 'validated input' });
  serverValue(value, 'server provenance');
  assignReviewed(value, { reason: 'reviewed assignment' });
  foreignReveal(value, 'lookalike subpath');
  foreignAssign(value, { reason: 'lookalike subpath' });
}
`);

    expect(sites.map(({ door, identity }) => [door, identity])).toEqual([
      ['publishToClient', 'import:@kovojs/core/security#publishToClient'],
      ['revealUntrusted', 'import:@kovojs/core/security#revealUntrusted'],
      ['serverValue', 'import:@kovojs/server/write-safety#serverValue'],
      ['trustedAssign', 'import:@kovojs/server/write-safety#trustedAssign'],
    ]);
  });

  it('follows an immutable one-hop alias and rejects comments, strings, and foreign same-name imports', () => {
    const sites = collect(`
import { revealSecret } from '@kovojs/core';
import { trustedReveal } from 'foreign-package';
const expose = revealSecret;
const text = "publishToClient(value, { reason: 'not code' })";
// trustedAssign(value, 'not code');
export function run(value) {
  expose(value, 'one-hop reviewed reveal');
  trustedReveal(value, { justification: 'foreign function' });
  return text;
}
export function shadowed(revealSecret, value) {
  return revealSecret(value, 'parameter is not the imported capability');
}
`);

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      callee: 'expose',
      door: 'revealSecret',
      identity: 'import:@kovojs/core#revealSecret',
    });
  });

  it('recognizes the authoritative same-file reveal helper identity', () => {
    const sites = collect(
      `
export function revealSecret(value, reason) { return value; }
export function use(value) { return revealSecret(value, 'reviewed'); }
`,
      'packages/core/src/secret.ts',
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      door: 'revealSecret',
      identity: 'local:packages/core/src/secret.ts#revealSecret',
    });
  });

  it('accepts only the exact versioned source-derived census', () => {
    const sites = collect();
    const artifact = renderDeclassificationCensus(sites);

    expect(artifact.schema).toBe(declassificationCensusSchema);
    expect(artifact.summary.total).toBe(7);
    expect(validateDeclassificationCensus({ artifact, sites })).toEqual({
      findings: [],
      ok: true,
    });
  });

  it('fails closed when a source site is added or deleted', () => {
    const sites = collect();
    const artifact = renderDeclassificationCensus(sites);
    const added = collect(`${fixtureSource}\nconst extra = value.reveal('new reveal');\n`);
    const deleted = sites.slice(0, -1);

    expect(validateDeclassificationCensus({ artifact, sites: added }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('unclassified declassification site')]),
    );
    expect(validateDeclassificationCensus({ artifact, sites: deleted }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('inventoried site is absent')]),
    );
  });

  it('fails closed when call code, capability identity, or door is swapped', () => {
    const sites = collect();
    const artifact = renderDeclassificationCensus(sites);

    const codeSwapped = collect(
      fixtureSource.replace('reviewed member reveal', 'laundered member reveal'),
    );
    expect(validateDeclassificationCensus({ artifact, sites: codeSwapped }).findings).toContain(
      `${sites[0].site} has stale expressionSha256`,
    );

    const identitySwapped = structuredClone(artifact);
    identitySwapped.sites[0].identity = 'unresolved:reveal';
    expect(validateDeclassificationCensus({ artifact: identitySwapped, sites }).findings).toContain(
      `${sites[0].site} has stale identity`,
    );

    const doorSwapped = structuredClone(artifact);
    doorSwapped.sites[0].door = 'trustedReveal';
    expect(validateDeclassificationCensus({ artifact: doorSwapped, sites }).findings).toContain(
      `${sites[0].site} has stale door`,
    );
  });

  it('rejects schema and closed-door vocabulary drift', () => {
    const sites = collect();
    const artifact = renderDeclassificationCensus(sites);

    expect(
      validateDeclassificationCensus({
        artifact: { ...artifact, schema: 'kovo-declassification-census/v2' },
        sites,
      }).findings,
    ).toContain(`schema must be ${declassificationCensusSchema}`);
    expect(
      validateDeclassificationCensus({
        artifact: { ...artifact, doors: artifact.doors.slice(1) },
        sites,
      }).findings,
    ).toContain('doors must match the closed declassification vocabulary');
  });
});
