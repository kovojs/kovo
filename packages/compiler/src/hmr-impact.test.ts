import { describe, expect, it } from 'vitest';

import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { compileComponentModule, classifyHmrImpact } from './index.js';
import type { HmrImpactMetadata } from './types.js';

describe('compiler HMR impact facts', () => {
  it('classifies proven live-target handler-only edits as component refreshes', () => {
    const previous = compile(hmrSource()).hmrImpact;
    const next = previous ? { ...previous, clientHref: `${previous.clientHref}-next` } : null;

    expect(previous?.clientHref).not.toBe(next?.clientHref);
    expect(previous?.queryUpdatePlanHash).toBe(next?.queryUpdatePlanHash);
    expect(previous?.liveTargetFactsHash).toBe(next?.liveTargetFactsHash);
    expect(classifyHmrImpact(previous, next)).toEqual({
      impact: 'componentRefresh',
      reasons: ['handler-only'],
    });
  });

  it('classifies render-output-only edits on a live-target component as component refreshes', () => {
    // plans/good-perf.md O6 ground truth (browser-verified 2026-08-08 on examples/stackoverflow):
    // a non-entry component edit that only changes render output must patch through the
    // live-target refresh instead of a full reload, so client state survives the save.
    const previous = compile(hmrSource({ visibleText: 'Cart' })).hmrImpact;
    const next = compile(hmrSource({ visibleText: 'Cart updated' })).hmrImpact;

    expect(previous?.renderOutputHash).not.toBe(next?.renderOutputHash);
    expect(previous?.liveTargetFacts.length).toBeGreaterThan(0);
    expect(previous?.liveTargetFactsHash).toBe(next?.liveTargetFactsHash);
    expect(classifyHmrImpact(previous, next)).toEqual({
      impact: 'componentRefresh',
      reasons: ['render-output'],
    });
  });

  it('ignores pure byte-offset shifts above style declarations (no anchors in HMR facts)', () => {
    // plans/good-perf.md O6: styleRuleUsages leaked `generatedFrom` source anchors into
    // stylesheetAssetsHash, so ANY insertion above a style.create block (a comment, an import,
    // a new prop) reclassified the save as a style change and forced a full page reload.
    // HmrImpactStylesheetFact deliberately carries no positions.
    const previous = compile(styleUsageSource('// one-line note')).hmrImpact;
    const next = compile(
      styleUsageSource('// a considerably longer leading comment that shifts every byte offset'),
    ).hmrImpact;

    expect(previous?.stylesheetAssetsHash).toBe(next?.stylesheetAssetsHash);
    expect(previous?.liveTargetFactsHash).toBe(next?.liveTargetFactsHash);
    expect(previous?.queryUpdatePlanHash).toBe(next?.queryUpdatePlanHash);
    expect(previous?.liveTargetFacts.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(previous);
    expect(serialized).not.toContain('generatedFrom');
    expect(serialized).not.toContain('queryKeySpan');
    expect(classifyHmrImpact(previous, next)).toEqual({
      impact: 'componentRefresh',
      reasons: [],
    });
  });

  it('classifies query-plan edits as route refreshes', () => {
    const previous = compile(hmrSource({ bindingPath: 'cart.count' })).hmrImpact;
    const next = compile(hmrSource({ bindingPath: 'cart.total' })).hmrImpact;

    expect(previous?.queryUpdatePlanHash).not.toBe(next?.queryUpdatePlanHash);
    expect(classifyHmrImpact(previous, next)).toEqual({
      impact: 'routeRefresh',
      reasons: ['query-plan'],
    });
  });

  it('classifies stylesheet edits from emitted stylesheet facts', () => {
    const previous = compile(hmrSource({ css: 'button { color: red; }' })).hmrImpact;
    const next = compile(hmrSource({ css: 'button { color: blue; }' })).hmrImpact;

    expect(previous?.stylesheetAssetsHash).not.toBe(next?.stylesheetAssetsHash);
    expect(classifyHmrImpact(previous, next)).toEqual({
      impact: 'routeRefresh',
      reasons: ['style'],
    });
  });

  it('classifies style-derived query-plan edits from typed fact hashes', () => {
    const previous = compile(styleToggleSource({ condition: 'cart.count > 0' })).hmrImpact;
    const next = compile(styleToggleSource({ condition: 'cart.ready' })).hmrImpact;

    expect(previous?.queryUpdatePlanHash).not.toBe(next?.queryUpdatePlanHash);
    expect(classifyHmrImpact(previous, next)).toEqual({
      impact: 'routeRefresh',
      reasons: ['query-plan'],
    });
  });

  it('classifies compiler errors as diagnostic HMR impact', () => {
    const previous = compile(hmrSource()).hmrImpact;
    const next = withDiagnostic(previous, 'KV201');

    expect(classifyHmrImpact(previous, next)).toEqual({
      impact: 'diagnosticError',
      reasons: ['diagnostics'],
    });
  });

  it('falls back to full reload when live-target facts are missing', () => {
    const previous = compile(nonRefreshableHandlerSource()).hmrImpact;
    const next = previous ? { ...previous, clientHref: `${previous.clientHref}-next` } : null;

    expect(previous?.liveTargetFacts).toEqual([]);
    expect(classifyHmrImpact(previous, next)).toEqual({
      impact: 'fullReload',
      reasons: ['missing-facts'],
    });
  });

  it('keeps HMR facts source-string agnostic under SPEC §5.2 rule 9', () => {
    const misleadingSourceText = 'queries: fake; css: button color hotpink;';
    const withoutMisleadingText = compile(hmrSource({ visibleText: 'plain text' })).hmrImpact;
    const withMisleadingText = compile(hmrSource({ visibleText: misleadingSourceText })).hmrImpact;

    expect(withMisleadingText?.queryUpdatePlanHash).toBe(
      withoutMisleadingText?.queryUpdatePlanHash,
    );
    expect(JSON.stringify(withMisleadingText)).not.toContain(misleadingSourceText);
  });
});

function compile(source: string): ReturnType<typeof compileComponentModule> {
  return compileComponentModule({
    fileName: 'components/cart/cart-badge.tsx',
    source,
  });
}

function hmrSource({
  bindingPath = 'cart.count',
  css = '',
  visibleText = 'Cart',
}: {
  bindingPath?: string;
  css?: string;
  visibleText?: string;
} = {}): string {
  return `
import { component } from '@kovojs/core';
import { tabsTriggerClick as removeItem } from '@kovojs/headless-ui/tabs';

export const CartBadge = component({
  queries: { cart: {} },
  ${css ? `css: \`${css}\`,` : ''}
  render: ({ cart }) => (
    <button onClick={removeItem}>
      <span>{${bindingPath}}</span>
      <span>${JSON.stringify(visibleText)}</span>
    </button>
  ),
});
`;
}

function nonRefreshableHandlerSource(): string {
  return `
import { component } from '@kovojs/core';
import { tabsTriggerClick as removeItem } from '@kovojs/headless-ui/tabs';

export const ActionButton = component({
  render: () => <button onClick={removeItem}>Run</button>,
});
`;
}

function styleUsageSource(leadingComment: string): string {
  return `${leadingComment}
import { component } from '@kovojs/core';
import { tabsTriggerClick as removeItem } from '@kovojs/headless-ui/tabs';
import * as style from '@kovojs/style';

const badgeStyles = style.create({
  badge: { color: 'red' },
});

export const CartBadge = component({
  queries: { cart: {} },
  render: ({ cart }) => (
    <button onClick={removeItem} style={badgeStyles.badge}>
      <span>{cart.count}</span>
    </button>
  ),
});
`;
}

function styleToggleSource({ condition }: { condition: string }): string {
  return `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const buttonStates = style.create({
  empty: { color: 'gray' },
  ready: { color: 'green' },
});

export const CartButton = component({
  queries: { cart: true },
  render: ({ cart }) => (
    <button style={${condition} ? buttonStates.ready : buttonStates.empty}>Cart</button>
  ),
});
`;
}

function withDiagnostic(
  metadata: HmrImpactMetadata | null,
  code: keyof typeof diagnosticDefinitions,
): HmrImpactMetadata | null {
  if (!metadata) return null;
  const definition = diagnosticDefinitions[code];

  return {
    ...metadata,
    diagnostics: [
      {
        code,
        message: definition.message,
        severity: definition.severity,
      },
    ],
  };
}
