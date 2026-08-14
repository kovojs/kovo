import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  BROWSER_FIXTURE_IDENTITY_SCHEMA,
  browserFixtureIdentity,
  createBrowserFixtureIdentity,
} from './browser-fixture-identity.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./shared/matched-fixture.json', import.meta.url), 'utf8'),
);
const sources = {
  kovoApp: await readFile(new URL('./kovo/src/app.tsx', import.meta.url), 'utf8'),
  kovoL1: await readFile(new URL('./kovo/src/matched-l1-shell.tsx', import.meta.url), 'utf8'),
  nextContent: await readFile(
    new URL('./nextjs/app/_matched/content.tsx', import.meta.url),
    'utf8',
  ),
  nextL0: await readFile(new URL('./nextjs/app/_matched/l0-shell.tsx', import.meta.url), 'utf8'),
  nextL1: await readFile(new URL('./nextjs/app/_matched/l1-shell.tsx', import.meta.url), 'utf8'),
  sharedCss: await readFile(new URL('./shared/styles.css', import.meta.url), 'utf8'),
};

describe('capability-matched benchmark fixtures', () => {
  it('authenticates the complete catalog/CSS/route/source-shape workload identity', async () => {
    const identity = await browserFixtureIdentity();
    expect(identity).toMatchObject({
      complete: true,
      findings: [],
      schema: BROWSER_FIXTURE_IDENTITY_SCHEMA,
    });
    expect(identity.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(identity.identity.semanticCorpus).toMatchObject({
      catalogItems: 24,
      routeKinds: ['listing', 'detail'],
      routes: expect.arrayContaining([
        expect.objectContaining({ lane: 'matched-l0', route: 'listing' }),
        expect.objectContaining({ lane: 'matched-l1', route: 'detail' }),
        expect.objectContaining({ lane: 'matched-runtime', route: 'listing' }),
      ]),
    });
    expect(identity.identity.sourceProjection.kovo).toMatchObject({
      catalogPosture: 'compiler-constrained-exact-local-literal',
      moduleCount: 2,
      routeCount: 6,
    });
    expect(identity.identity.sourceProjection.nextjs).toMatchObject({
      catalogPosture: 'direct-authoritative-json-import',
      moduleCount: 9,
      routeCount: 6,
    });
    expect(identity.identity.sourceProjection.equalityPosture).toContain(
      'framework-native-module-and-authored-loc-recorded-not-normalized',
    );
  });

  it('fails closed on catalog, CSS, and entrant-route mutations', async () => {
    const mutatedCatalog = await createBrowserFixtureIdentity({
      overrides: {
        'shared/catalog.json': (await readFile(new URL('./shared/catalog.json', import.meta.url), 'utf8')).replace(
          'Linen Field Jacket',
          'Forged Field Jacket',
        ),
      },
    });
    expect(mutatedCatalog.complete).toBe(false);
    expect(mutatedCatalog.findings).toContain(
      'Kovo catalog literal does not exactly project the authoritative catalog',
    );

    const mutatedCss = await createBrowserFixtureIdentity({
      overrides: {
        'kovo/src/styles.css': `${await readFile(new URL('./kovo/src/styles.css', import.meta.url), 'utf8')}\n.forged { color: red; }\n`,
      },
    });
    expect(mutatedCss.complete).toBe(false);
    expect(mutatedCss.findings).toContain(
      'Kovo stylesheet is not byte-identical to the authoritative shared CSS',
    );

    const nextRoutePath = 'nextjs/app/(matched-l1)/matched/l1/page.tsx';
    const mutatedRoute = await createBrowserFixtureIdentity({
      overrides: {
        [nextRoutePath]: (await readFile(new URL(`./${nextRoutePath.replace('nextjs/', 'nextjs/')}`, import.meta.url), 'utf8')).replace(
          "const basePath = '/matched/l1';",
          "const basePath = '/forged';",
        ),
      },
    });
    expect(mutatedRoute.complete).toBe(false);
    expect(mutatedRoute.findings).toContain(
      'Next.js route projection (matched-l1)/matched/l1/page.tsx is absent or misbound',
    );
  });

  it('changes the workload digest for an equivalent source-topology edit', async () => {
    const baseline = await browserFixtureIdentity();
    const appSource = await readFile(new URL('./kovo/src/app.tsx', import.meta.url), 'utf8');
    const changed = await createBrowserFixtureIdentity({
      overrides: { 'kovo/src/app.tsx': `${appSource}\n// fixture identity mutation proof\n` },
    });
    expect(changed.complete).toBe(true);
    expect(changed.digest).not.toBe(baseline.digest);
  });

  it('pins identical visible content and shared assets in both entrants', () => {
    for (const text of [fixture.brand, fixture.listingHeading, fixture.listingDescription]) {
      expect(sources.kovoApp).toContain(text);
      expect(sources.nextContent + sources.nextL0 + sources.nextL1).toContain(text);
    }
    for (const text of [fixture.l0.cartDescription, fixture.l0.cartLabel, fixture.l0.cartText]) {
      expect(sources.kovoApp).toContain(text);
      expect(sources.nextL0).toContain(text);
    }
    for (const text of [
      fixture.l1.alternateEmail,
      fixture.l1.cartDescription,
      fixture.l1.initialEmail,
      fixture.l1.itemLabel,
      fixture.l1.itemPrice,
    ]) {
      expect(sources.kovoL1).toContain(text);
      expect(sources.nextL1).toContain(text);
    }
    expect(sources.kovoApp.match(/id: ["']p\d\d["']/gu)).toHaveLength(fixture.catalogItems);
  });

  it('keeps matched L0 native and zero-JS by construction (SPEC §4.4 and §7-§8)', () => {
    expect(sources.kovoApp).toContain('popovertarget="matched-l0-cart"');
    expect(sources.nextL0).toContain('popoverTarget="matched-l0-cart"');
    expect(sources.nextL0).not.toContain("'use client'");
    expect(sources.nextL0).not.toMatch(/\bon[A-Z][A-Za-z]+=/u);
    const kovoL0Source = sources.kovoApp.slice(
      sources.kovoApp.indexOf('function MatchedL0Shell'),
      sources.kovoApp.indexOf('function Shell'),
    );
    expect(kovoL0Source).not.toContain('onClick={() =>');
    expect(sources.sharedCss).toContain('[popover]:not(:popover-open)');
  });

  it('keeps matched L1 on real mutable cart/email/order state in both frameworks', () => {
    for (const state of ['count', 'email', 'open', 'ordered']) {
      expect(sources.kovoL1).toMatch(new RegExp(`\\b${state}:`));
      expect(sources.nextL1).toMatch(new RegExp(`\\[${state}, set${capitalize(state)}\\]`));
    }
    expect(sources.kovoL1).toContain('onClick={() =>');
    expect(sources.nextL1).toContain('onClick={() =>');
  });
});

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
