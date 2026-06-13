import { describe, expect, it } from 'vitest';

import {
  compilerDataBindBehaviorFact,
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
          derives: [
            {
              exportName: 'CartBadge$isEmpty',
              expression: 'cart.count === 0',
              input: 'cart',
              name: 'CartBadge$isEmpty',
              param: 'cart',
              selector: '[data-derive="cart.CartBadge$isEmpty"]',
              sourceSpan: { start: 3 },
            },
          ],
          paths: ['cart.count', 'cart.items'],
          query: 'cart',
          sourceSpan: { start: 1 },
          stamps: [
            {
              attr: 'disabled',
              derive: {
                exportName: 'CartBadge$button_disabled_derive',
                expression: 'cart.count === 0',
                input: 'cart',
                name: 'CartBadge$button_disabled_derive',
                param: 'cart',
                selector: '[data-derive="cart.CartBadge$button_disabled_derive"]',
                sourceSpan: { start: 4 },
              },
              selector: '[data-derive="cart.CartBadge$button_disabled_derive"]',
              sourceSpan: { start: 5 },
            },
          ],
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
        derives: [
          {
            exportName: 'CartBadge$isEmpty',
            expression: 'cart.count === 0',
            input: 'cart',
            name: 'CartBadge$isEmpty',
            param: 'cart',
            selector: '[data-derive="cart.CartBadge$isEmpty"]',
          },
        ],
        paths: ['cart.count', 'cart.items'],
        query: 'cart',
        stamps: [
          {
            attr: 'disabled',
            derive: {
              exportName: 'CartBadge$button_disabled_derive',
              expression: 'cart.count === 0',
              input: 'cart',
              name: 'CartBadge$button_disabled_derive',
              param: 'cart',
              selector: '[data-derive="cart.CartBadge$button_disabled_derive"]',
            },
            selector: '[data-derive="cart.CartBadge$button_disabled_derive"]',
          },
        ],
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

  it('owns the data-bind query-shape fixture assembly for fw-check', () => {
    const compiledSources: string[] = [];
    const fact = compilerDataBindBehaviorFact({
      compileComponentModule({ queryShapeFacts, source }) {
        compiledSources.push(source);

        if (source.includes('cart.count">2</span>') && queryShapeFacts?.[0]?.query === 'cart') {
          const cartShape = queryShapeFacts[0]?.shape as { count?: string; items?: unknown };
          if (cartShape.count !== 'number') {
            return {
              diagnostics: [
                {
                  code: 'FW302',
                  message: 'data-bind path is not present in the declared query shape. cart.count',
                  severity: 'error',
                },
              ],
              queryUpdatePlans: [],
            };
          }

          return {
            diagnostics: [],
            queryUpdatePlans: [
              {
                componentName: 'CartBadge',
                paths: ['cart.count', 'cart.empty', 'cart.items'],
                query: 'cart',
                templateStamps: [
                  {
                    itemBindingPlaceholders: [
                      {
                        path: '.qty',
                        readPath: 'qty',
                        readSegments: [{ name: 'qty', optional: false }],
                        value: '0',
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
            ],
          };
        }

        if (source.includes('data-bind=".missing"')) {
          return {
            diagnostics: [
              {
                code: 'FW302',
                message: 'data-bind path is not present in the declared query shape. cart.items',
                severity: 'error',
              },
            ],
            queryUpdatePlans: [],
          };
        }

        if (source.includes('product.review.rating')) {
          return {
            diagnostics: [
              {
                code: 'FW227',
                help: 'Fixes: use optional traversal.\nSPEC §4.8 requires explicit null handling.',
                message:
                  'Binding path traverses a nullable segment without ?. product.review.rating (segment: review)',
                severity: 'error',
              },
            ],
            queryUpdatePlans: [],
          };
        }

        return { diagnostics: [], queryUpdatePlans: [] };
      },
      diagnosticDefinitions: {
        FW227: {
          help: 'Fixes: use optional traversal.\nSPEC §4.8 requires explicit null handling.',
        },
        FW302: { message: 'data-bind path is not present in the declared query shape.' },
      },
      queryShapesFromFacts(facts) {
        return Object.fromEntries(facts.map((entry) => [entry.query, entry.shape]));
      },
    });

    expect(compiledSources).toHaveLength(5);
    expect(fact.queryShapes).toEqual({
      cart: {
        count: 'number',
        empty: 'boolean',
        items: [{ name: 'string', productId: 'string', qty: 'number' }],
      },
    });
    expect(fact.validCartBindingDiagnostics).toEqual([]);
    expect(fact.validCartBindingPlans).toEqual([
      {
        componentName: 'CartBadge',
        paths: ['cart.count', 'cart.empty', 'cart.items'],
        query: 'cart',
        templateStamps: [
          {
            itemBindingPlaceholders: [
              {
                path: '.qty',
                readPath: 'qty',
                readSegments: [{ name: 'qty', optional: false }],
                value: '0',
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
    expect(fact.staleGeneratedShapeDiagnostics).toEqual([
      {
        code: 'FW302',
        message: 'data-bind path is not present in the declared query shape. cart.count',
      },
    ]);
    expect(fact.invalidListStampDiagnostics).toEqual([
      {
        code: 'FW302',
        message: 'data-bind path is not present in the declared query shape. cart.items',
      },
    ]);
    expect(fact.optionalNullablePathDiagnostics).toEqual([]);
    expect(fact.unsafeNullablePathDiagnostics).toEqual([
      {
        code: 'FW227',
        help: 'Fixes: use optional traversal.\nSPEC §4.8 requires explicit null handling.',
        message:
          'Binding path traverses a nullable segment without ?. product.review.rating (segment: review)',
      },
    ]);
  });
});
