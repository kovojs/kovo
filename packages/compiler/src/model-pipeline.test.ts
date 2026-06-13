import { describe, expect, it } from 'vitest';

import {
  applyModelPatchPass,
  applyTerminalEmitPatches,
  componentPipelineState,
} from './model-pipeline.js';

describe('compiler model pipeline', () => {
  it('carries an empty patch pass through the same parsed model', () => {
    const previousModel = { spans: ['original-render'] };
    const state = componentPipelineState(
      'cart-badge.tsx',
      'export const CartBadge = component({ render: () => <span /> });',
      previousModel,
    );
    const parses: string[] = [];

    const lowered = applyModelPatchPass(state, [], (fileName, source) => {
      parses.push(`${fileName}:${source}`);
      return { spans: ['reparsed'] };
    });

    expect(lowered.state).toEqual({
      fileName: 'cart-badge.tsx',
      model: previousModel,
      source: 'export const CartBadge = component({ render: () => <span /> });',
    });
    expect(lowered.state.model).toBe(previousModel);
    expect(lowered.sourceOffsetMap.segments).toEqual([
      { generatedStart: 0, length: state.source.length, originalStart: 0 },
    ]);
    expect(parses).toEqual([]);
  });

  it('rebuilds the parsed model once when a patch pass changes source', () => {
    const state = componentPipelineState(
      'cart-badge.tsx',
      'export const CartBadge = component({ render: () => <Link href="/cart" /> });',
      { spans: ['link'] },
    );
    const parses: string[] = [];

    const lowered = applyModelPatchPass(
      state,
      [
        {
          end: state.source.indexOf('/>') + 2,
          replacement: '<a href="/cart" />',
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

    const lowered = applyModelPatchPass(
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
    const lowered = applyModelPatchPass(
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

  it('applies terminal emit-only source patches without reparsing a model', () => {
    const state = componentPipelineState(
      'cart-badge.tsx',
      'export const CartBadge = component({ render: () => <button onClick={save}>Save</button> });',
      { spans: ['button'] },
    );
    const start = state.source.indexOf('onClick={save}');

    const lowered = applyTerminalEmitPatches(state, [
      {
        end: start + 'onClick={save}'.length,
        replacement: 'on:click="/c/cart-badge.client.js#CartBadge$button_click"',
        start,
      },
    ]);

    expect(lowered).toBe(
      'export const CartBadge = component({ render: () => <button on:click="/c/cart-badge.client.js#CartBadge$button_click">Save</button> });',
    );
  });
});
