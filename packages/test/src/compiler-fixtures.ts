export interface CompilerDiagnosticLike {
  code: string;
  fileName?: string;
  help?: string;
  message: string;
  severity: string;
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
  status: string;
  [field: string]: unknown;
}

export interface CompilerUpdateCoverageFact {
  component: string;
  detail?: string;
  position: string;
  query: string;
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
  FW227: { help: string };
  FW302: { message: string };
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

export interface CompilerDataBindBehaviorFact {
  diagnostics: {
    FW227Help: string;
    FW302Message: string;
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
      <ul data-bind-list="cart.items" fw-key="productId">
        <template fw-stamp>
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
    <ul data-bind-list="cart.items" fw-key="sku">
      <template fw-stamp>
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
      FW227Help: options.diagnosticDefinitions.FW227.help,
      FW302Message: options.diagnosticDefinitions.FW302.message,
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
