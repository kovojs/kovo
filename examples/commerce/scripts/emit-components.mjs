import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
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

// Compiles the authored TSX components (src/components/*.tsx) through
// `kovo compile` and commits the lowered IR modules to src/generated/ — the
// SPEC.md section 3 pipeline with the section 5.2.3 fixpoint gate and committed
// lowered-source freshness applied to every component. The app imports the
// committed IR at runtime, so served HTML carries the compiler-derived stamps
// (kovo-c, kovo-deps, data-bind — SPEC.md sections 4.2 and 4.8) instead of
// hand-written ones. `--check` verifies the committed IR is not stale.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const commerceRoot = resolve(scriptDir, '..');
const componentNames = ['cart-badge', 'order-history', 'product-grid'];
const checkMode = process.argv.includes('--check');
const registryFacts = {
  mutationInputs: {
    'cart/add': [
      {
        coercion: 'string',
        defaulted: false,
        name: 'productId',
        optional: false,
        provenance: 'registry',
        required: true,
      },
      {
        coercion: 'number',
        defaulted: true,
        name: 'quantity',
        optional: false,
        provenance: 'registry',
        required: false,
      },
    ],
  },
  mutations: { 'cart/add': 'typeof addToCart' },
};
const tempRoot = mkdtempSync(resolve(tmpdir(), 'kovo-commerce-emit-'));
const registryFactsPath = resolve(tempRoot, 'registry-facts.json');
writeFileSync(registryFactsPath, JSON.stringify(registryFacts, null, 2));

function compileArtifact(args, outputPath) {
  execFileSync('kovo', ['compile', ...args, '--out', outputPath], {
    cwd: commerceRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return readFileSync(outputPath, 'utf8');
}

try {
  for (const name of componentNames) {
    const sourcePath = resolve(commerceRoot, `src/components/${name}.tsx`);
    const generatedPath = resolve(commerceRoot, `src/generated/${name}.tsx`);
    const loweredPath = resolve(tempRoot, `${name}.tsx`);
    const fileName = `examples/commerce/src/components/${name}.tsx`;
    const source = readFileSync(sourcePath, 'utf8');

    // SPEC.md section 4.8: stamps are derived, never required in sugar.
    assert.doesNotMatch(
      source,
      /(?:data-bind|kovo-deps|kovo-c|kovo-fragment-target|kovo-state|data-p-[\w-]+)=/,
      `${fileName} hand-writes stamps`,
    );

    const lowered = compileArtifact(
      [
        'component',
        sourcePath,
        '--file-name',
        fileName,
        '--registry-facts',
        registryFactsPath,
        '--fixpoint',
        '--render-equivalence',
      ],
      loweredPath,
    );
    const generated = `// @kovojs-ir — lowered from ${fileName} by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with \`pnpm run emit-components\`.\n${lowered}`;

    if (checkMode) {
      assert.equal(
        readFileSync(generatedPath, 'utf8'),
        generated,
        `generated ${name}.tsx is stale; run \`pnpm --filter @kovojs/example-commerce run emit-components\``,
      );
    } else {
      writeFileSync(generatedPath, generated);
    }
  }

  const liveTargetsPath = resolve(commerceRoot, 'src/generated/live-targets.ts');
  const liveTargetsSource = `// @kovojs-ir - generated live-target registry for Commerce components (SPEC.md section 9.1). Do not edit; regenerate with \`pnpm run emit-components\`.
import {
  collectGeneratedLiveTargetRenderers,
  type LiveTargetRenderer,
} from '@kovojs/server/internal/wire';

import type { CommerceRequest } from '../app.js';
import * as cartBadgeModule from './cart-badge.js';
import * as orderHistoryModule from './order-history.js';
import * as productGridModule from './product-grid.js';

export const liveTargetRenderers: readonly LiveTargetRenderer<CommerceRequest>[] = [
  ...collectGeneratedLiveTargetRenderers<CommerceRequest>([
    cartBadgeModule,
    orderHistoryModule,
    productGridModule,
  ]),
];
`;

  if (checkMode) {
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
  const routeGenerated = compileArtifact(
    [
      'route',
      routeSourcePath,
      '--file-name',
      routeFileName,
      '--artifact-file-name',
      routeArtifactFileName,
      '--rewrite',
      'CartBadge=./cart-badge.js',
      '--rewrite',
      'OrderHistory=./order-history.js',
      '--rewrite',
      'ProductGrid=./product-grid.js',
    ],
    resolve(tempRoot, 'app-shell.kovo-route.tsx'),
  );

  if (checkMode) {
    assert.equal(
      readFileSync(routeGeneratedPath, 'utf8'),
      routeGenerated,
      'generated app-shell.kovo-route.tsx is stale; run `pnpm --filter @kovojs/example-commerce run emit-components`',
    );
  } else {
    writeFileSync(routeGeneratedPath, routeGenerated);
  }
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
