import { describe, expect, it } from 'vitest';

import {
  compilerDataBindBehaviorFact,
  compilerDiagnosticFacts,
  compilerDiagnosticMessageFacts,
  compilerGeneratedQueryShapeFact,
  compilerLoweredIrKovoCheckBehaviorFact,
  compilerQueryUpdatePlanFacts,
  compilerUpdateCoverageFacts,
  compilerValidationBehaviorFact,
} from './compiler-fixtures.js';

describe('@kovojs/test compiler fixture facts', () => {
  it('projects diagnostics without source-offset pins', () => {
    expect(
      compilerDiagnosticFacts(
        [
          {
            code: 'KV311',
            fileName: 'components/cart.tsx',
            length: 12,
            message: 'missing update coverage',
            severity: 'warn',
            start: { column: 5, line: 9 },
          },
          {
            code: 'KV210',
            message: 'lint',
            severity: 'lint',
          },
        ],
        ['KV311'],
      ),
    ).toEqual([
      {
        code: 'KV311',
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
          source: 'query',
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
        source: 'query',
        status: 'UNHANDLED',
      },
    ]);
  });

  it('projects diagnostic message facts without source locations', () => {
    expect(
      compilerDiagnosticMessageFacts([
        {
          code: 'KV302',
          fileName: 'cart.tsx',
          message: 'data-bind path is not present in the declared query shape. cart.count',
          severity: 'error',
          start: { column: 5, line: 9 },
        },
        {
          code: 'KV227',
          help: 'Use ?.',
          message: 'Binding path traverses a nullable segment without ?.',
          severity: 'error',
        },
      ]),
    ).toEqual([
      {
        code: 'KV302',
        message: 'data-bind path is not present in the declared query shape. cart.count',
      },
      {
        code: 'KV227',
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

  it('owns the data-bind query-shape fixture assembly for kovo-check', () => {
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
                  code: 'KV302',
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
                code: 'KV302',
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
                code: 'KV227',
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
        KV227: {
          help: 'Fixes: use optional traversal.\nSPEC §4.8 requires explicit null handling.',
        },
        KV302: { message: 'data-bind path is not present in the declared query shape.' },
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
        code: 'KV302',
        message: 'data-bind path is not present in the declared query shape. cart.count',
      },
    ]);
    expect(fact.invalidListStampDiagnostics).toEqual([
      {
        code: 'KV302',
        message: 'data-bind path is not present in the declared query shape. cart.items',
      },
    ]);
    expect(fact.optionalNullablePathDiagnostics).toEqual([]);
    expect(fact.unsafeNullablePathDiagnostics).toEqual([
      {
        code: 'KV227',
        help: 'Fixes: use optional traversal.\nSPEC §4.8 requires explicit null handling.',
        message:
          'Binding path traverses a nullable segment without ?. product.review.rating (segment: review)',
      },
    ]);
  });

  it('owns reusable compiler validation fixture assembly for kovo-check', () => {
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
                code: 'KV221',
                fileName,
                message: 'IDREF references an id not present in component scope. missing-label',
                severity: 'error',
              },
              {
                code: 'KV221',
                fileName,
                message: 'IDREF references an id not present in component scope. missing-help',
                severity: 'error',
              },
              {
                code: 'KV221',
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
                code: 'KV224',
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
                code: 'KV224',
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
                code: 'KV225',
                fileName,
                message:
                  'JSX nesting violates the HTML content model. <div> cannot appear inside <p>',
                severity: 'error',
              },
              {
                code: 'KV225',
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
                code: 'KV211',
                fileName,
                message: 'on:load eager trigger requires a justification comment. on:load',
                severity: 'lint',
              },
              {
                code: 'KV212',
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
                code: 'KV226',
                fileName,
                message:
                  'kovo-deps or kovo-c names an unknown query instance or component. kovo-c="unknown-component"',
                severity: 'error',
              },
              {
                code: 'KV226',
                fileName,
                message:
                  'kovo-deps or kovo-c names an unknown query instance or component. kovo-deps="missingQuery:p1"',
                severity: 'error',
              },
            ],
          };
        }

        return { diagnostics: [] };
      },
      diagnosticDefinitions: {
        KV211: { message: 'on:load eager trigger requires a justification comment.' },
        KV212: { message: 'Unknown on:* event or execution trigger name.' },
        KV221: { message: 'IDREF references an id not present in component scope.' },
        KV224: {
          message: 'Static id appears in a repeatable component or duplicate page composition.',
        },
        KV225: { message: 'JSX nesting violates the HTML content model.' },
        KV226: { message: 'kovo-deps or kovo-c names an unknown query instance or component.' },
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
      'KV224',
      'KV224',
    ]);
    expect(fact.invalidContentModelDiagnostics).toHaveLength(2);
    expect(fact.invalidExecutionTriggerDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'KV211',
      'KV212',
    ]);
    expect(fact.invalidResidualStampDiagnostics).toHaveLength(2);
  });

  it('projects app-authored lowered IR through compiler and kovo-check facts', () => {
    const compiledSources: string[] = [];
    const fact = compilerLoweredIrKovoCheckBehaviorFact({
      compileComponentModule({ fileName, source }) {
        compiledSources.push(`${fileName}:${source.includes('data-bind="cart.count"')}`);

        return {
          diagnostics: [
            {
              code: 'KV235',
              fileName,
              message:
                'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
              severity: 'error',
              start: { column: 25, line: 4 },
            },
          ],
        };
      },
      kovoCheck({ diagnostics }) {
        const diagnostic = diagnostics[0];

        return {
          exitCode: 1,
          output: `kovo-check/v1\nERROR ${diagnostic?.code} ${diagnostic?.site}:4:25 ${diagnostic?.message}\n`,
        };
      },
    });

    expect(compiledSources).toEqual(['cart-badge.tsx:true']);
    expect(fact).toEqual({
      compilerDiagnostics: [
        {
          code: 'KV235',
          fileName: 'cart-badge.tsx',
          message:
            'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
          severity: 'error',
        },
      ],
      kovoCheck: {
        coverage: [],
        diagnostics: [
          {
            code: 'KV235',
            message:
              'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
            properties: {},
            severity: 'ERROR',
            target: 'cart-badge.tsx:4:25',
          },
        ],
        exitCode: 1,
        status: 'issues',
        version: 'kovo-check/v1',
      },
      sourceFileName: 'cart-badge.tsx',
      specSection: 'SPEC §5.2',
    });
  });

  it('fails loudly when the lowered IR fixture stops producing KV235', () => {
    expect(() =>
      compilerLoweredIrKovoCheckBehaviorFact({
        compileComponentModule() {
          return { diagnostics: [] };
        },
        kovoCheck() {
          return { exitCode: 0, output: 'kovo-check/v1\nOK\n' };
        },
      }),
    ).toThrow('Expected exactly one KV235 diagnostic; found 0');
  });
});
