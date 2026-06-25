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
import { removeItem } from './actions';

export const CartBadge = component({
  queries: { cart: {} },
  ${css ? `css: \`${css}\`,` : ''}
  render: () => (
    <button onClick={removeItem}>
      <span data-bind="${bindingPath}">2</span>
      <span>${JSON.stringify(visibleText)}</span>
    </button>
  ),
});
`;
}

function nonRefreshableHandlerSource(): string {
  return `
import { component } from '@kovojs/core';
import { removeItem } from './actions';

export const ActionButton = component({
  render: () => <button onClick={removeItem}>Run</button>,
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
