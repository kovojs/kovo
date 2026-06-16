import {
  kovoCheckAssertionFact,
  type KovoCheckAssertionFact,
  type KovoCheckResultLike,
} from './kovo-check-fixtures.ts';

export interface CompilerDiagnosticLike {
  code: string;
  fileName?: string;
  help?: string;
  message: string;
  severity: string;
  start?: unknown;
  [field: string]: unknown;
}

export interface CompilerDiagnosticFact {
  code: string;
  fileName?: string;
  help?: string;
  message: string;
  severity: string;
}

export interface CompilerUpdateCoverageLike {
  component?: string;
  componentName?: string;
  detail?: string;
  position: string;
  query: string;
  source?: string;
  status: string;
  [field: string]: unknown;
}

export interface CompilerUpdateCoverageFact {
  component: string;
  detail?: string;
  position: string;
  query: string;
  source?: string;
  status: string;
}

export interface CompilerQueryUpdatePlanLike {
  componentName: string;
  derives?: readonly CompilerDeriveLike[];
  paths: readonly string[];
  query: string;
  stamps?: readonly CompilerStampLike[];
  templateStamps?: readonly CompilerTemplateStampLike[];
  [field: string]: unknown;
}

export interface CompilerDeriveLike {
  exportName: string;
  expression: string;
  input: string;
  name: string;
  param: string;
  selector: string;
  [field: string]: unknown;
}

export interface CompilerStampLike {
  attr: string;
  derive: CompilerDeriveLike;
  selector: string;
  [field: string]: unknown;
}

export interface CompilerTemplateStampLike {
  itemBindingPlaceholders?: readonly CompilerTemplateStampPlaceholderLike[];
  key: string;
  list: string;
  listReadPath?: string;
  listReadSegments?: readonly CompilerBindingPathSegmentLike[];
  selector: string;
  template: string;
  [field: string]: unknown;
}

export interface CompilerTemplateStampPlaceholderLike {
  path: string;
  readPath?: string;
  readSegments?: readonly CompilerBindingPathSegmentLike[];
  value: string;
  [field: string]: unknown;
}

export interface CompilerBindingPathSegmentLike {
  name: string;
  optional: boolean;
  [field: string]: unknown;
}

export interface CompilerQueryUpdatePlanFact {
  componentName: string;
  derives?: CompilerDeriveFact[];
  paths: string[];
  query: string;
  stamps?: CompilerStampFact[];
  templateStamps: CompilerTemplateStampFact[];
}

export interface CompilerDeriveFact {
  exportName: string;
  expression: string;
  input: string;
  name: string;
  param: string;
  selector: string;
}

export interface CompilerStampFact {
  attr: string;
  derive: CompilerDeriveFact;
  selector: string;
}

export interface CompilerTemplateStampFact {
  itemBindingPlaceholders: CompilerTemplateStampPlaceholderFact[];
  key: string;
  list: string;
  listReadPath?: string;
  listReadSegments?: CompilerBindingPathSegmentFact[];
  selector: string;
  template: string;
}

export interface CompilerTemplateStampPlaceholderFact {
  path: string;
  readPath?: string;
  readSegments?: CompilerBindingPathSegmentFact[];
  value: string;
}

export interface CompilerBindingPathSegmentFact {
  name: string;
  optional: boolean;
}

export type CompilerQueryShape =
  | string
  | readonly CompilerQueryShape[]
  | {
      kind?: string;
      shape?: CompilerQueryShape;
      [field: string]: unknown;
    };

export interface CompilerQueryShapeFact {
  query: string;
  shape: CompilerQueryShape;
  source: string;
}

export type CompilerDiagnosticMessageFact = Pick<
  CompilerDiagnosticFact,
  'code' | 'help' | 'message'
>;

export interface CompilerDataBindDiagnosticDefinitions {
  KV227: { help: string };
  KV302: { message: string };
}

export interface CompilerDataBindCompileResult {
  diagnostics: readonly CompilerDiagnosticLike[];
  queryUpdatePlans: readonly CompilerQueryUpdatePlanLike[];
}

export interface CompilerDataBindBehaviorOptions {
  compileComponentModule(options: {
    fileName: string;
    queryShapeFacts?: readonly CompilerQueryShapeFact[];
    source: string;
  }): CompilerDataBindCompileResult;
  diagnosticDefinitions: CompilerDataBindDiagnosticDefinitions;
  queryShapesFromFacts(facts: readonly CompilerQueryShapeFact[]): unknown;
}

export interface CompilerValidationDiagnosticDefinitions {
  KV211: { message: string };
  KV212: { message: string };
  KV221: { message: string };
  KV224: { message: string };
  KV225: { message: string };
  KV226: { message: string };
}

export interface CompilerValidationCompileResult {
  diagnostics: readonly CompilerDiagnosticLike[];
}

export interface CompilerValidationBehaviorOptions {
  compileComponentModule(options: {
    fileName: string;
    registryFacts?: { components?: readonly string[] };
    source: string;
  }): CompilerValidationCompileResult;
  diagnosticDefinitions: CompilerValidationDiagnosticDefinitions;
}

export interface CompilerLoweredIrKovoCheckCompileResult {
  diagnostics: readonly CompilerDiagnosticLike[];
}

export interface CompilerLoweredIrKovoCheckBehaviorOptions {
  compileComponentModule(options: {
    fileName: string;
    source: string;
  }): CompilerLoweredIrKovoCheckCompileResult;
  kovoCheck(input: {
    diagnostics: readonly {
      code: string;
      message: string;
      site?: string;
      start?: unknown;
    }[];
  }): KovoCheckResultLike;
}

export interface CompilerDataBindBehaviorFact {
  diagnostics: {
    KV227Help: string;
    KV302Message: string;
  };
  generatedCartShapeFacts: CompilerQueryShapeFact[];
  invalidListStampDiagnostics: CompilerDiagnosticMessageFact[];
  nullableQueryShapes: unknown;
  optionalNullablePathDiagnostics: CompilerDiagnosticMessageFact[];
  queryShapes: unknown;
  staleGeneratedShapeDiagnostics: CompilerDiagnosticMessageFact[];
  unsafeNullablePathDiagnostics: CompilerDiagnosticMessageFact[];
  validCartBindingDiagnostics: CompilerDiagnosticMessageFact[];
  validCartBindingPlans: CompilerQueryUpdatePlanFact[];
}

export interface CompilerValidationBehaviorFact {
  diagnostics: Record<keyof CompilerValidationDiagnosticDefinitions, string>;
  invalidContentModelDiagnostics: CompilerDiagnosticFact[];
  invalidExecutionTriggerDiagnostics: CompilerDiagnosticFact[];
  invalidIdrefDiagnostics: CompilerDiagnosticFact[];
  invalidResidualStampDiagnostics: CompilerDiagnosticFact[];
  invalidStaticIdDiagnostics: CompilerDiagnosticFact[];
  validContentModelDiagnostics: CompilerDiagnosticFact[];
  validExecutionTriggerDiagnostics: CompilerDiagnosticFact[];
  validIdrefDiagnostics: CompilerDiagnosticFact[];
  validResidualStampDiagnostics: CompilerDiagnosticFact[];
}

export interface CompilerLoweredIrKovoCheckBehaviorFact {
  compilerDiagnostics: CompilerDiagnosticFact[];
  kovoCheck: KovoCheckAssertionFact;
  sourceFileName: string;
  specSection: 'SPEC §5.2';
}

export function compilerDiagnosticFacts(
  diagnostics: readonly CompilerDiagnosticLike[],
  codes?: readonly string[],
): CompilerDiagnosticFact[] {
  const codeSet = codes ? new Set(codes) : undefined;
  return diagnostics
    .filter((diagnostic) => codeSet === undefined || codeSet.has(diagnostic.code))
    .map((diagnostic) => ({
      code: diagnostic.code,
      ...(diagnostic.fileName === undefined ? {} : { fileName: diagnostic.fileName }),
      ...(diagnostic.help === undefined ? {} : { help: diagnostic.help }),
      message: diagnostic.message,
      severity: diagnostic.severity,
    }));
}

export function compilerDiagnosticMessageFacts(
  diagnostics: readonly CompilerDiagnosticLike[],
  codes?: readonly string[],
): CompilerDiagnosticMessageFact[] {
  return compilerDiagnosticFacts(diagnostics, codes).map(({ code, help, message }) => ({
    code,
    ...(help === undefined ? {} : { help }),
    message,
  }));
}

export function compilerQueryUpdatePlanFacts(
  plans: readonly CompilerQueryUpdatePlanLike[],
): CompilerQueryUpdatePlanFact[] {
  return plans.map((plan) => ({
    componentName: plan.componentName,
    ...(plan.derives === undefined ? {} : { derives: compilerDeriveFacts(plan.derives) }),
    paths: [...plan.paths],
    query: plan.query,
    ...(plan.stamps === undefined ? {} : { stamps: compilerStampFacts(plan.stamps) }),
    templateStamps: (plan.templateStamps ?? []).map((stamp) => ({
      itemBindingPlaceholders: (stamp.itemBindingPlaceholders ?? []).map((placeholder) => ({
        path: placeholder.path,
        ...(placeholder.readPath === undefined ? {} : { readPath: placeholder.readPath }),
        ...(placeholder.readSegments === undefined
          ? {}
          : { readSegments: compilerBindingPathSegmentFacts(placeholder.readSegments) }),
        value: placeholder.value,
      })),
      key: stamp.key,
      list: stamp.list,
      ...(stamp.listReadPath === undefined ? {} : { listReadPath: stamp.listReadPath }),
      ...(stamp.listReadSegments === undefined
        ? {}
        : { listReadSegments: compilerBindingPathSegmentFacts(stamp.listReadSegments) }),
      selector: stamp.selector,
      template: stamp.template,
    })),
  }));
}

function compilerDeriveFacts(derives: readonly CompilerDeriveLike[]): CompilerDeriveFact[] {
  return derives.map((derive) => ({
    exportName: derive.exportName,
    expression: derive.expression,
    input: derive.input,
    name: derive.name,
    param: derive.param,
    selector: derive.selector,
  }));
}

function compilerStampFacts(stamps: readonly CompilerStampLike[]): CompilerStampFact[] {
  return stamps.map((stamp) => ({
    attr: stamp.attr,
    derive: compilerDeriveFacts([stamp.derive])[0]!,
    selector: stamp.selector,
  }));
}

function compilerBindingPathSegmentFacts(
  segments: readonly CompilerBindingPathSegmentLike[],
): CompilerBindingPathSegmentFact[] {
  return segments.map((segment) => ({
    name: segment.name,
    optional: segment.optional,
  }));
}

export function compilerUpdateCoverageFacts(
  coverage: readonly CompilerUpdateCoverageLike[],
): CompilerUpdateCoverageFact[] {
  return coverage.map((entry) => ({
    component: entry.component ?? entry.componentName ?? '',
    ...(entry.detail === undefined ? {} : { detail: entry.detail }),
    position: entry.position,
    query: entry.query,
    ...(entry.source === undefined ? {} : { source: entry.source }),
    status: entry.status,
  }));
}

export function compilerGeneratedQueryShapeFact(options: {
  query: string;
  shape: CompilerQueryShape;
  source?: string;
}): CompilerQueryShapeFact {
  return {
    query: options.query,
    shape: options.shape,
    source: options.source ?? `generated/queries/${options.query}.shape.ts`,
  };
}

export function compilerDataBindBehaviorFact(
  options: CompilerDataBindBehaviorOptions,
): CompilerDataBindBehaviorFact {
  const generatedCartShapeFacts = [
    compilerGeneratedQueryShapeFact({
      query: 'cart',
      shape: {
        count: 'number',
        empty: 'boolean',
        items: [{ name: 'string', productId: 'string', qty: 'number' }],
      },
    }),
  ];
  const queryShapes = options.queryShapesFromFacts(generatedCartShapeFacts);

  const validCartBindings = options.compileComponentModule({
    fileName: 'cart-badge.tsx',
    queryShapeFacts: generatedCartShapeFacts,
    source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">2</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
      <ul data-bind-list="cart.items" kovo-key="productId">
        <template kovo-stamp>
          <li><span data-bind=".qty">0</span> x <span data-bind=".name">Item</span></li>
        </template>
      </ul>
    </cart-badge>
  ),
});
`,
  });

  const staleGeneratedShape = options.compileComponentModule({
    fileName: 'cart-badge.tsx',
    queryShapeFacts: [
      compilerGeneratedQueryShapeFact({
        query: 'cart',
        shape: { itemCount: 'number' },
      }),
    ],
    source: `
export const CartBadge = component('cart-badge', {
  render: () => <span data-bind="cart.count">2</span>,
});
`,
  });

  const invalidListStamp = options.compileComponentModule({
    fileName: 'cart-badge.tsx',
    queryShapeFacts: generatedCartShapeFacts,
    source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <ul data-bind-list="cart.items" kovo-key="sku">
      <template kovo-stamp>
        <li><span data-bind=".missing">0</span></li>
      </template>
    </ul>
  ),
});
`,
  });

  const nullableFacts = [
    compilerGeneratedQueryShapeFact({
      query: 'product',
      shape: {
        name: 'string',
        review: {
          kind: 'nullable',
          shape: {
            rating: {
              kind: 'nullable',
              shape: 'number',
            },
          },
        },
      },
    }),
  ];
  const nullableQueryShapes = options.queryShapesFromFacts(nullableFacts);

  const optionalNullablePath = options.compileComponentModule({
    fileName: 'product-card.tsx',
    queryShapeFacts: nullableFacts,
    source: `
export const ProductCard = component('product-card', {
  render: () => <span data-bind="product.review?.rating">5</span>,
});
`,
  });

  const unsafeNullablePath = options.compileComponentModule({
    fileName: 'product-card.tsx',
    queryShapeFacts: nullableFacts,
    source: `
export const ProductCard = component('product-card', {
  render: () => <span data-bind="product.review.rating">5</span>,
});
`,
  });

  return {
    diagnostics: {
      KV227Help: options.diagnosticDefinitions.KV227.help,
      KV302Message: options.diagnosticDefinitions.KV302.message,
    },
    generatedCartShapeFacts,
    invalidListStampDiagnostics: compilerDiagnosticMessageFacts(invalidListStamp.diagnostics),
    nullableQueryShapes,
    optionalNullablePathDiagnostics: compilerDiagnosticMessageFacts(
      optionalNullablePath.diagnostics,
    ),
    queryShapes,
    staleGeneratedShapeDiagnostics: compilerDiagnosticMessageFacts(staleGeneratedShape.diagnostics),
    unsafeNullablePathDiagnostics: compilerDiagnosticMessageFacts(unsafeNullablePath.diagnostics),
    validCartBindingDiagnostics: compilerDiagnosticMessageFacts(validCartBindings.diagnostics),
    validCartBindingPlans: compilerQueryUpdatePlanFacts(validCartBindings.queryUpdatePlans),
  };
}

export function compilerValidationBehaviorFact(
  options: CompilerValidationBehaviorOptions,
): CompilerValidationBehaviorFact {
  const validIdrefs = options.compileComponentModule({
    fileName: 'components/cart/cart-search.tsx',
    source: `
import { component } from '@kovojs/core';

export const CartSearch = component('cart-search', {
  render: () => (
    <section>
      <label for="cart-query">Search</label>
      <input id="cart-query" aria-describedby="cart-help" />
      <p id="cart-help">Help</p>
    </section>
  ),
});
`,
  });

  const invalidIdrefs = options.compileComponentModule({
    fileName: 'components/cart/cart-search.tsx',
    source: `
import { component } from '@kovojs/core';

export const CartSearch = component('cart-search', {
  render: () => (
    <section>
      <label for="missing-label">Search</label>
      <input id="cart-query" aria-describedby="cart-help missing-help" />
      <p id="cart-help">Help</p>
      <button popovertarget="missing-popover">Filters</button>
    </section>
  ),
});
`,
  });

  const duplicateStaticId = options.compileComponentModule({
    fileName: 'components/cart/cart-shell.tsx',
    source: `
import { component } from '@kovojs/core';

export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <h2 id="cart-title">Cart</h2>
      <output id="cart-title">2 items</output>
    </section>
  ),
});
`,
  });

  const repeatableStaticId = options.compileComponentModule({
    fileName: 'components/cart/cart-list.tsx',
    source: `
import { component } from '@kovojs/core';

export const CartList = component('cart-list', {
  render: () => (
    <ul data-bind-list="cart.items" kovo-key="productId">
      <template kovo-stamp>
        <li id="cart-row"><span data-bind=".name">Mug</span></li>
      </template>
    </ul>
  ),
});
`,
  });

  const validContentModel = options.compileComponentModule({
    fileName: 'components/cart/cart-table.tsx',
    registryFacts: {
      components: ['cart-row'],
    },
    source: `
import { component } from '@kovojs/core';

export const CartTable = component('cart-table', {
  render: () => (
    <table>
      <tbody>
        <tr kovo-c="cart-row">
          <td>Cart row</td>
        </tr>
      </tbody>
    </table>
  ),
});
`,
  });

  const invalidContentModel = options.compileComponentModule({
    fileName: 'components/cart/cart-shell.tsx',
    source: `
import { component } from '@kovojs/core';

export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <p>
        Cart intro
        <div>Parser closes the paragraph before this div.</div>
      </p>
      <tr>
        <td>Detached row</td>
      </tr>
    </section>
  ),
});
`,
  });

  const validExecutionTriggers = options.compileComponentModule({
    fileName: 'components/execution-triggers.tsx',
    source: `
import { component } from '@kovojs/core';

export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      <button on:click="/c/cart.client.js#Cart$add">Add</button>
      <search-index on:idle="/c/search.client.js#Search$warm"></search-index>
      <sales-chart on:visible="/c/chart.client.js#SalesChart$mount"></sales-chart>
      {/* KV211: stock ticker intentionally starts at parse for market-open pages. */}
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`,
  });

  const invalidExecutionTriggers = options.compileComponentModule({
    fileName: 'components/execution-triggers.tsx',
    source: `
import { component } from '@kovojs/core';

export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
      <video-player on:media="/c/video.client.js#Video$mount"></video-player>
    </section>
  ),
});
`,
  });

  const validResidualStamp = options.compileComponentModule({
    fileName: 'components/recommendations.tsx',
    source: `
import { component } from '@kovojs/core';

export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section kovo-c="recommendations" kovo-deps="cart">{cart.count}</section>
  ),
});
`,
  });

  const invalidResidualStamp = options.compileComponentModule({
    fileName: 'components/recommendations.tsx',
    source: `
import { component } from '@kovojs/core';

export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section kovo-c="unknown-component" kovo-deps="cart missingQuery:p1">{cart.count}</section>
  ),
});
`,
  });

  return {
    diagnostics: {
      KV211: options.diagnosticDefinitions.KV211.message,
      KV212: options.diagnosticDefinitions.KV212.message,
      KV221: options.diagnosticDefinitions.KV221.message,
      KV224: options.diagnosticDefinitions.KV224.message,
      KV225: options.diagnosticDefinitions.KV225.message,
      KV226: options.diagnosticDefinitions.KV226.message,
    },
    invalidContentModelDiagnostics: compilerDiagnosticFacts(invalidContentModel.diagnostics, [
      'KV225',
    ]),
    invalidExecutionTriggerDiagnostics: compilerDiagnosticFacts(
      invalidExecutionTriggers.diagnostics,
      ['KV211', 'KV212'],
    ),
    invalidIdrefDiagnostics: compilerDiagnosticFacts(invalidIdrefs.diagnostics, ['KV221']),
    invalidResidualStampDiagnostics: compilerDiagnosticFacts(invalidResidualStamp.diagnostics, [
      'KV226',
    ]),
    invalidStaticIdDiagnostics: [
      ...compilerDiagnosticFacts(duplicateStaticId.diagnostics, ['KV224']),
      ...compilerDiagnosticFacts(repeatableStaticId.diagnostics, ['KV224']),
    ],
    validContentModelDiagnostics: compilerDiagnosticFacts(validContentModel.diagnostics),
    validExecutionTriggerDiagnostics: compilerDiagnosticFacts(validExecutionTriggers.diagnostics),
    validIdrefDiagnostics: compilerDiagnosticFacts(validIdrefs.diagnostics),
    validResidualStampDiagnostics: compilerDiagnosticFacts(validResidualStamp.diagnostics),
  };
}

export function compilerLoweredIrKovoCheckBehaviorFact(
  options: CompilerLoweredIrKovoCheckBehaviorOptions,
): CompilerLoweredIrKovoCheckBehaviorFact {
  const sourceFileName = 'cart-badge.tsx';
  const result = options.compileComponentModule({
    fileName: sourceFileName,
    source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => \`<cart-badge kovo-deps="cart"><span data-bind="cart.count">\${cart.count}</span></cart-badge>\`,
});
`,
  });
  const diagnostics = result.diagnostics.filter((entry) => entry.code === 'KV235');

  if (diagnostics.length !== 1) {
    throw new Error(`Expected exactly one KV235 diagnostic; found ${diagnostics.length}`);
  }

  return {
    compilerDiagnostics: compilerDiagnosticFacts(diagnostics),
    kovoCheck: kovoCheckAssertionFact(
      options.kovoCheck({
        diagnostics: diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          message: diagnostic.message,
          ...(diagnostic.fileName === undefined ? {} : { site: diagnostic.fileName }),
          ...(diagnostic.start === undefined ? {} : { start: diagnostic.start }),
        })),
      }),
    ),
    sourceFileName,
    specSection: 'SPEC §5.2',
  };
}
