import { describe, expect, it } from 'vitest';

import {
  compilerDiagnosticFacts,
  compilerDiagnosticMessageFacts,
  compilerGeneratedQueryShapeFact,
  compilerQueryUpdatePlanFacts,
  compilerUpdateCoverageFacts,
} from './compiler-fixtures.js';

describe('@jiso/test compiler fixture facts', () => {
  it('projects diagnostics without source-offset pins', () => {
    expect(
      compilerDiagnosticFacts(
        [
          {
            code: 'FW311',
            fileName: 'components/cart.tsx',
            length: 12,
            message: 'missing update coverage',
            severity: 'warn',
            start: { column: 5, line: 9 },
          },
          {
            code: 'FW210',
            message: 'lint',
            severity: 'lint',
          },
        ],
        ['FW311'],
      ),
    ).toEqual([
      {
        code: 'FW311',
        fileName: 'components/cart.tsx',
        message: 'missing update coverage',
        severity: 'warn',
      },
    ]);
  });

  it('projects update coverage without source spans', () => {
    expect(
      compilerUpdateCoverageFacts([
        {
          componentName: 'CartBadge',
          detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
          position: 'expression',
          query: 'cart.discount',
          sourceSpan: { length: 13, start: 355 },
          status: 'UNHANDLED',
        },
      ]),
    ).toEqual([
      {
        component: 'CartBadge',
        detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
        position: 'expression',
        query: 'cart.discount',
        status: 'UNHANDLED',
      },
    ]);
  });

  it('projects diagnostic message facts without source locations', () => {
    expect(
      compilerDiagnosticMessageFacts([
        {
          code: 'FW302',
          fileName: 'cart.tsx',
          message: 'data-bind path is not present in the declared query shape. cart.count',
          severity: 'error',
          start: { column: 5, line: 9 },
        },
        {
          code: 'FW227',
          help: 'Use ?.',
          message: 'Binding path traverses a nullable segment without ?.',
          severity: 'error',
        },
      ]),
    ).toEqual([
      {
        code: 'FW302',
        message: 'data-bind path is not present in the declared query shape. cart.count',
      },
      {
        code: 'FW227',
        help: 'Use ?.',
        message: 'Binding path traverses a nullable segment without ?.',
      },
    ]);
  });

  it('builds generated query shape facts through a reusable fixture', () => {
    expect(
      compilerGeneratedQueryShapeFact({
        query: 'cart',
        shape: {
          count: 'number',
          items: [{ productId: 'string', qty: 'number' }],
        },
      }),
    ).toEqual({
      query: 'cart',
      shape: {
        count: 'number',
        items: [{ productId: 'string', qty: 'number' }],
      },
      source: 'generated/queries/cart.shape.ts',
    });
  });

  it('projects query update plans without pinning unrelated compiler fields', () => {
    expect(
      compilerQueryUpdatePlanFacts([
        {
          componentName: 'CartBadge',
          paths: ['cart.count', 'cart.items'],
          query: 'cart',
          sourceSpan: { start: 1 },
          templateStamps: [
            {
              itemBindingPlaceholders: [
                {
                  path: '.name',
                  readPath: 'name',
                  readSegments: [{ extra: 'ignored', name: 'name', optional: false }],
                  sourceSpan: { start: 2 },
                  value: 'Item',
                },
              ],
              key: 'productId',
              list: 'cart.items',
              listReadPath: 'items',
              listReadSegments: [{ extra: 'ignored', name: 'items', optional: false }],
              selector: '[data-bind-list="cart.items"]',
              template: '<li>Item</li>',
            },
          ],
        },
      ]),
    ).toEqual([
      {
        componentName: 'CartBadge',
        paths: ['cart.count', 'cart.items'],
        query: 'cart',
        templateStamps: [
          {
            itemBindingPlaceholders: [
              {
                path: '.name',
                readPath: 'name',
                readSegments: [{ name: 'name', optional: false }],
                value: 'Item',
              },
            ],
            key: 'productId',
            list: 'cart.items',
            listReadPath: 'items',
            listReadSegments: [{ name: 'items', optional: false }],
            selector: '[data-bind-list="cart.items"]',
            template: '<li>Item</li>',
          },
        ],
      },
    ]);
  });
});
