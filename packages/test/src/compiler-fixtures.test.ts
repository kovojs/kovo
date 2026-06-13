import { describe, expect, it } from 'vitest';

import {
  compilerDataBindBehaviorFact,
  compilerDiagnosticFacts,
  compilerDiagnosticMessageFacts,
  compilerGeneratedQueryShapeFact,
  compilerQueryUpdatePlanFacts,
  compilerUpdateCoverageFacts,
  compilerValidationBehaviorFact,
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

  it('owns reusable compiler validation fixture assembly for fw-check', () => {
    const compiled: Array<{ fileName: string; hasCartRowRegistry: boolean; source: string }> = [];
    const fact = compilerValidationBehaviorFact({
      compileComponentModule({ fileName, registryFacts, source }) {
        compiled.push({
          fileName,
          hasCartRowRegistry: registryFacts?.components?.includes('cart-row') ?? false,
          source,
        });

        if (source.includes('missing-label')) {
          return {
            diagnostics: [
              {
                code: 'FW221',
                fileName,
                message: 'IDREF references an id not present in component scope. missing-label',
                severity: 'error',
              },
              {
                code: 'FW221',
                fileName,
                message: 'IDREF references an id not present in component scope. missing-help',
                severity: 'error',
              },
              {
                code: 'FW221',
                fileName,
                message: 'IDREF references an id not present in component scope. missing-popover',
                severity: 'error',
              },
            ],
          };
        }

        if (source.includes('id="cart-title"')) {
          return {
            diagnostics: [
              {
                code: 'FW224',
                fileName,
                message:
                  'Static id appears in a repeatable component or duplicate page composition. duplicate id="cart-title"',
                severity: 'error',
              },
            ],
          };
        }

        if (source.includes('id="cart-row"')) {
          return {
            diagnostics: [
              {
                code: 'FW224',
                fileName,
                message:
                  'Static id appears in a repeatable component or duplicate page composition. repeatable id="cart-row"',
                severity: 'error',
              },
            ],
          };
        }

        if (source.includes('Parser closes the paragraph')) {
          return {
            diagnostics: [
              {
                code: 'FW225',
                fileName,
                message:
                  'JSX nesting violates the HTML content model. <div> cannot appear inside <p>',
                severity: 'error',
              },
              {
                code: 'FW225',
                fileName,
                message:
                  'JSX nesting violates the HTML content model. <tr> must be inside a table section or table',
                severity: 'error',
              },
            ],
          };
        }

        if (source.includes('on:media')) {
          return {
            diagnostics: [
              {
                code: 'FW211',
                fileName,
                message: 'on:load eager trigger requires a justification comment. on:load',
                severity: 'lint',
              },
              {
                code: 'FW212',
                fileName,
                message: 'Unknown on:* event or execution trigger name. on:media',
                severity: 'lint',
              },
            ],
          };
        }

        if (source.includes('unknown-component')) {
          return {
            diagnostics: [
              {
                code: 'FW226',
                fileName,
                message:
                  'fw-deps or fw-c names an unknown query instance or component. fw-c="unknown-component"',
                severity: 'error',
              },
              {
                code: 'FW226',
                fileName,
                message:
                  'fw-deps or fw-c names an unknown query instance or component. fw-deps="missingQuery:p1"',
                severity: 'error',
              },
            ],
          };
        }

        return { diagnostics: [] };
      },
      diagnosticDefinitions: {
        FW211: { message: 'on:load eager trigger requires a justification comment.' },
        FW212: { message: 'Unknown on:* event or execution trigger name.' },
        FW221: { message: 'IDREF references an id not present in component scope.' },
        FW224: {
          message: 'Static id appears in a repeatable component or duplicate page composition.',
        },
        FW225: { message: 'JSX nesting violates the HTML content model.' },
        FW226: { message: 'fw-deps or fw-c names an unknown query instance or component.' },
      },
    });

    expect(compiled).toHaveLength(10);
    expect(compiled.map(({ fileName }) => fileName)).toEqual([
      'components/cart/cart-search.tsx',
      'components/cart/cart-search.tsx',
      'components/cart/cart-shell.tsx',
      'components/cart/cart-list.tsx',
      'components/cart/cart-table.tsx',
      'components/cart/cart-shell.tsx',
      'components/execution-triggers.tsx',
      'components/execution-triggers.tsx',
      'components/recommendations.tsx',
      'components/recommendations.tsx',
    ]);
    expect(compiled.filter(({ hasCartRowRegistry }) => hasCartRowRegistry)).toHaveLength(1);
    expect(fact.validIdrefDiagnostics).toEqual([]);
    expect(fact.validContentModelDiagnostics).toEqual([]);
    expect(fact.validExecutionTriggerDiagnostics).toEqual([]);
    expect(fact.validResidualStampDiagnostics).toEqual([]);
    expect(fact.invalidIdrefDiagnostics).toHaveLength(3);
    expect(fact.invalidStaticIdDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'FW224',
      'FW224',
    ]);
    expect(fact.invalidContentModelDiagnostics).toHaveLength(2);
    expect(fact.invalidExecutionTriggerDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'FW211',
      'FW212',
    ]);
    expect(fact.invalidResidualStampDiagnostics).toHaveLength(2);
  });
});
