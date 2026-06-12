import { describe, expect, it } from 'vitest';

import {
  componentPipelineState,
  lowerComponentPipelinePatches,
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

  it('applies source patches through the pipeline state and keeps an offset map', () => {
    const state = componentPipelineState(
      'cart-badge.tsx',
      'export const CartBadge = component({ render: () => <Link to="/cart">Cart</Link> });',
      { spans: ['link'] },
    );
    const parses: string[] = [];

    const lowered = lowerComponentPipelinePatches(
      state,
      [
        {
          end: state.source.indexOf('</Link>') + '</Link>'.length,
          replacement: '<a href="/cart">Cart</a>',
          start: state.source.indexOf('<Link'),
        },
      ],
      (fileName, source) => {
        parses.push(`${fileName}:${source}`);
        return { spans: ['anchor'] };
      },
    );

    expect(lowered.state).toEqual({
      fileName: 'cart-badge.tsx',
      model: { spans: ['anchor'] },
      source: 'export const CartBadge = component({ render: () => <a href="/cart">Cart</a> });',
    });
    expect(lowered.sourceOffsetMap.originalLength).toBe(state.source.length);
    expect(lowered.sourceOffsetMap.generatedLength).toBe(lowered.state.source.length);
    expect(lowered.sourceOffsetMap.segments).toEqual([
      { generatedStart: 0, length: state.source.indexOf('<Link'), originalStart: 0 },
      {
        generatedStart: state.source.indexOf('<Link') + '<a href="/cart">Cart</a>'.length,
        length: ' });'.length,
        originalStart: state.source.indexOf('</Link>') + '</Link>'.length,
      },
    ]);
    expect(parses).toEqual([
      'cart-badge.tsx:export const CartBadge = component({ render: () => <a href="/cart">Cart</a> });',
    ]);
  });

  it('applies generated prefixes through the pipeline state and offset map', () => {
    const state = componentPipelineState(
      'cart-badge.tsx',
      'export const CartBadge = component({ render: () => <button disabled={cart.empty}>Checkout</button> });',
      { spans: ['button'] },
    );
    const prefix =
      'export const CartBadge$button_disabled_derive = derive(["cart"], (cart) => cart.empty);\n\n';
    const parses: string[] = [];
    const attributeStart = state.source.indexOf('disabled={cart.empty}');
    const lowered = lowerComponentPipelinePatches(
      state,
      [
        {
          end: attributeStart + 'disabled={cart.empty}'.length,
          replacement:
            'data-derive="cart.CartBadge$button_disabled_derive" data-derive-attr="disabled"',
          start: attributeStart,
        },
      ],
      (fileName, source) => {
        parses.push(`${fileName}:${source}`);
        return { spans: ['derived-button'] };
      },
      { prefix },
    );

    expect(lowered.state).toEqual({
      fileName: 'cart-badge.tsx',
      model: { spans: ['derived-button'] },
      source:
        'export const CartBadge$button_disabled_derive = derive(["cart"], (cart) => cart.empty);\n\n' +
        'export const CartBadge = component({ render: () => <button data-derive="cart.CartBadge$button_disabled_derive" data-derive-attr="disabled">Checkout</button> });',
    });
    expect(lowered.sourceOffsetMap.originalLength).toBe(state.source.length);
    expect(lowered.sourceOffsetMap.generatedLength).toBe(lowered.state.source.length);
    expect(lowered.sourceOffsetMap.segments[0]).toEqual({
      generatedStart: prefix.length,
      length: attributeStart,
      originalStart: 0,
    });
    expect(parses).toEqual([`cart-badge.tsx:${lowered.state.source}`]);
  });
});
