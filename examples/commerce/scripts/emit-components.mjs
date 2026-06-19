import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// `kovo compile`. Normal mode writes ignored inspection artifacts under
// src/generated/; `--check` compiles to a temp dir with the SPEC.md section
// 5.2.3 fixpoint and render-equivalence gates and never reads committed output.

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

    if (!checkMode) {
      mkdirSync(dirname(generatedPath), { recursive: true });
      writeFileSync(generatedPath, generated);
    }
  }

  const liveTargetsPath = resolve(commerceRoot, 'src/generated/live-targets.ts');
  const liveTargetsSource = `// @kovojs-ir - generated live-target registry for Commerce components (SPEC.md section 9.1). Do not edit; regenerate with \`pnpm run emit-components\`.
import {
  collectGeneratedLiveTargetRenderers,
  type LiveTargetRenderer,
} from '@kovojs/server/internal/wire';

import type { CommerceRequest } from '../domain.js';
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

  if (!checkMode) {
    mkdirSync(dirname(liveTargetsPath), { recursive: true });
    writeFileSync(liveTargetsPath, liveTargetsSource);
  }

  const routeSourcePath = resolve(commerceRoot, 'src/app.tsx');
  const routeGeneratedPath = checkMode
    ? resolve(tempRoot, 'app.kovo-route.tsx')
    : resolve(commerceRoot, 'src/generated/app.kovo-route.tsx');
  const routeFileName = 'examples/commerce/src/app.tsx';
  const routeArtifactFileName = 'examples/commerce/src/generated/app.kovo-route.tsx';
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
    resolve(tempRoot, 'app.kovo-route.tsx'),
  );

  if (!checkMode) {
    mkdirSync(dirname(routeGeneratedPath), { recursive: true });
    writeFileSync(routeGeneratedPath, routeGenerated);
  }
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
