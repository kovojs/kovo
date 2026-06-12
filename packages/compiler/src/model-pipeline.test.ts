import { describe, expect, it } from 'vitest';

import {
  componentPipelineState,
  lowerComponentPipelineSource,
  modelForSourceChange,
} from './model-pipeline.js';

describe('compiler model pipeline', () => {
  it('reuses the previous model when a lowering pass leaves source unchanged', () => {
    const previousModel = { parsed: 'original' };
    const parses: string[] = [];

    const model = modelForSourceChange({
      fileName: 'cart-badge.tsx',
      nextSource: 'export const CartBadge = component({});',
      parse: (fileName, source) => {
        parses.push(`${fileName}:${source}`);
        return { parsed: 'next' };
      },
      previousModel,
      previousSource: 'export const CartBadge = component({});',
    });

    expect(model).toBe(previousModel);
    expect(parses).toEqual([]);
  });

  it('parses changed source once with the author file name', () => {
    const parses: string[] = [];

    const model = modelForSourceChange({
      fileName: 'cart-badge.tsx',
      nextSource: 'export const CartBadge = component({ render: () => <a href="/cart" /> });',
      parse: (fileName, source) => {
        parses.push(`${fileName}:${source}`);
        return { parsed: source };
      },
      previousModel: { parsed: 'original' },
      previousSource:
        'export const CartBadge = component({ render: () => <Link href="/cart" /> });',
    });

    expect(model).toEqual({
      parsed: 'export const CartBadge = component({ render: () => <a href="/cart" /> });',
    });
    expect(parses).toEqual([
      'cart-badge.tsx:export const CartBadge = component({ render: () => <a href="/cart" /> });',
    ]);
  });

  it('carries unchanged lowering through the same parsed model', () => {
    const previousModel = { spans: ['original-render'] };
    const state = componentPipelineState(
      'cart-badge.tsx',
      'export const CartBadge = component({ render: () => <span /> });',
      previousModel,
    );
    const parses: string[] = [];

    const lowered = lowerComponentPipelineSource(state, state.source, (fileName, source) => {
      parses.push(`${fileName}:${source}`);
      return { spans: ['reparsed'] };
    });

    expect(lowered).toEqual({
      fileName: 'cart-badge.tsx',
      model: previousModel,
      source: 'export const CartBadge = component({ render: () => <span /> });',
    });
    expect(lowered.model).toBe(previousModel);
    expect(parses).toEqual([]);
  });

  it('rebuilds the parsed model once when a lowering pass changes source', () => {
    const state = componentPipelineState(
      'cart-badge.tsx',
      'export const CartBadge = component({ render: () => <Link href="/cart" /> });',
      { spans: ['link'] },
    );
    const parses: string[] = [];

    const lowered = lowerComponentPipelineSource(
      state,
      'export const CartBadge = component({ render: () => <a href="/cart" /> });',
      (fileName, source) => {
        parses.push(`${fileName}:${source}`);
        return { spans: ['anchor'] };
      },
    );

    expect(lowered).toEqual({
      fileName: 'cart-badge.tsx',
      model: { spans: ['anchor'] },
      source: 'export const CartBadge = component({ render: () => <a href="/cart" /> });',
    });
    expect(parses).toEqual([
      'cart-badge.tsx:export const CartBadge = component({ render: () => <a href="/cart" /> });',
    ]);
  });
});
