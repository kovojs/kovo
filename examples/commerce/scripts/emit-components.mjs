import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { assertFixpoint, assertRenderEquivalence, compileComponentModule, compileRouteModule } =
  await import('@kovojs/compiler');

// Compiles the authored TSX components (src/components/*.tsx) through
// @kovojs/compiler and commits the lowered IR modules to src/generated/ — the
// SPEC.md section 3 pipeline with the section 5.2.3 fixpoint gate and committed
// lowered-source freshness applied to every component. The app imports the
// committed IR at runtime, so served HTML carries the compiler-derived stamps
// (kovo-c, kovo-deps, data-bind — SPEC.md sections 4.2 and 4.8) instead of
// hand-written ones. `--check` verifies the committed IR is not stale.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const commerceRoot = resolve(scriptDir, '..');
const componentNames = ['cart-badge', 'order-history', 'product-grid'];
const registryFacts = { mutations: { 'cart/add': 'typeof addToCart' } };

for (const name of componentNames) {
  const sourcePath = resolve(commerceRoot, `src/components/${name}.tsx`);
  const generatedPath = resolve(commerceRoot, `src/generated/${name}.tsx`);
  const fileName = `examples/commerce/src/components/${name}.tsx`;
  const source = readFileSync(sourcePath, 'utf8');

  // SPEC.md section 4.8: stamps are derived, never required in sugar.
  assert.doesNotMatch(
    source,
    /(?:data-bind|kovo-deps|kovo-c|kovo-fragment-target|kovo-state|data-p-[\w-]+)=/,
    `${fileName} hand-writes stamps`,
  );

  const result = compileComponentModule({ fileName, registryFacts, source });

  assert.deepEqual(
    result.diagnostics,
    [],
    `${fileName} has compiler diagnostics: ${JSON.stringify(result.diagnostics, null, 2)}`,
  );
  // SPEC.md section 5.2.3 / Constitution #3: compiling the output is a no-op.
  // Real authored-vs-lowered render equivalence is tracked separately in plans/compiler-hardening.md.
  assertFixpoint(result);
  assertRenderEquivalence(result);

  const lowered = result.loweredSource;
  assert.ok(lowered, `${fileName} produced no lowered render source`);

  let generated = `// @kovojs-ir — lowered from ${fileName} by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with \`pnpm run emit-components\`.\n${lowered}`;
  if (name === 'product-grid') generated = withCommerceProductGridLiveTargetAdapter(generated);

  if (process.argv.includes('--check')) {
    assert.equal(
      readFileSync(generatedPath, 'utf8'),
      generated,
      `generated ${name}.tsx is stale; run \`pnpm --filter @kovojs/example-commerce run emit-components\``,
    );
  } else {
    writeFileSync(generatedPath, generated);
  }
}

function withCommerceProductGridLiveTargetAdapter(source) {
  const sourceWithTypes = source.replace(
    "import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';",
    "import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer, type LiveTargetRenderContext, type LiveTargetRenderer } from '@kovojs/server/internal/wire';",
  );

  return `${sourceWithTypes.trimEnd()}

const ProductGrid$commerceLiveTargetRenderer: LiveTargetRenderer<CommerceRequest> = {
  ...ProductGrid$liveTargetRenderer,
  errorBoundary: {
    render(error: unknown) {
      return \`<section role="alert" class="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">Product grid failed: \${escapeText((error as Error).message)}</section>\`;
    },
  },
  render(context: LiveTargetRenderContext<CommerceRequest>) {
    const productGridError = context.request.renderFaults?.productGrid?.();
    if (productGridError) throw productGridError;
    return ProductGrid$liveTargetRenderer.render(context);
  },
};

registerGeneratedLiveTargetRenderer(ProductGrid$commerceLiveTargetRenderer);
`;
}

const liveTargetsPath = resolve(commerceRoot, 'src/generated/live-targets.ts');
const liveTargetsSource = `// @kovojs-ir - generated live-target registry for Commerce components (SPEC.md section 9.1). Do not edit; regenerate with \`pnpm run emit-components\`.
import {
  collectGeneratedLiveTargetRenderers,
  componentLiveTargetRenderer,
  type LiveTargetRenderContext,
  type LiveTargetRenderer,
} from '@kovojs/server/internal/wire';
import { escapeHtml } from '@kovojs/server/internal/html';

import type { CommerceRequest } from '../app.js';
import { productGridQuery } from '../queries.js';
import * as cartBadgeModule from './cart-badge.js';
import * as orderHistoryModule from './order-history.js';
import { ProductGrid } from './product-grid.js';

const productGridRenderer = componentLiveTargetRenderer({
  component: ProductGrid,
  componentId: 'components/product-grid/product-grid',
  queries: [
    {
      name: 'productGrid',
      query: productGridQuery,
    },
  ],
  slots(context: LiveTargetRenderContext<CommerceRequest>) {
    return {
      forms: { addToCart: { failure: null } },
      request: context.request,
    };
  },
}) satisfies LiveTargetRenderer<CommerceRequest>;

const productGridLiveTargetRenderer: LiveTargetRenderer<CommerceRequest> = {
  ...productGridRenderer,
  errorBoundary: {
    render(error) {
      return \`<section role="alert" class="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">Product grid failed: \${escapeHtml((error as Error).message)}</section>\`;
    },
  },
  render(context) {
    const productGridError = context.request.renderFaults?.productGrid?.();
    if (productGridError) throw productGridError;
    return productGridRenderer.render(context);
  },
};

export const liveTargetRenderers: readonly LiveTargetRenderer<CommerceRequest>[] = [
  ...collectGeneratedLiveTargetRenderers<CommerceRequest>([
    cartBadgeModule,
    orderHistoryModule,
  ]),
  productGridLiveTargetRenderer,
];
`;

if (process.argv.includes('--check')) {
  assert.equal(
    readFileSync(liveTargetsPath, 'utf8'),
    liveTargetsSource,
    'generated live-targets.ts is stale; run `pnpm --filter @kovojs/example-commerce run emit-components`',
  );
} else {
  writeFileSync(liveTargetsPath, liveTargetsSource);
}

const routeSourcePath = resolve(commerceRoot, 'src/app-shell.tsx');
const routeGeneratedPath = resolve(commerceRoot, 'src/generated/app-shell.kovo-route.tsx');
const routeFileName = 'examples/commerce/src/app-shell.tsx';
const routeArtifactFileName = 'examples/commerce/src/generated/app-shell.kovo-route.tsx';
const routeResult = compileRouteModule({
  artifactFileName: routeArtifactFileName,
  fileName: routeFileName,
  source: readFileSync(routeSourcePath, 'utf8'),
});

assert.deepEqual(
  routeResult.diagnostics,
  [],
  `${routeFileName} has compiler diagnostics: ${JSON.stringify(routeResult.diagnostics, null, 2)}`,
);
assert.equal(routeResult.files.length, 1, `${routeFileName} produced no generated route IR`);
const routeGenerated = routeResult.files[0].source;

if (process.argv.includes('--check')) {
  assert.equal(
    readFileSync(routeGeneratedPath, 'utf8'),
    routeGenerated,
    'generated app-shell.kovo-route.tsx is stale; run `pnpm --filter @kovojs/example-commerce run emit-components`',
  );
} else {
  writeFileSync(routeGeneratedPath, routeGenerated);
}
