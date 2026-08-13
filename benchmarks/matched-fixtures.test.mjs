import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

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
};

describe('capability-matched benchmark fixtures', () => {
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
