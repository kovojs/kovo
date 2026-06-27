import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { htmlElementFacts, type HtmlElementSelector } from '@kovojs/test/html-fragment';
import {
  generatedHandlerReferenceFact,
  generatedHandlerReferenceSummaryFact,
} from './generated-module-fixtures.ts';

import type {
  GeneratedHandlerReferenceFact,
  GeneratedHandlerReferenceSummaryFact,
  GeneratedRenderedElementFact,
} from './generated-module-fixtures.ts';

const execFileAsync = promisify(execFile);

export interface ViteTransformResultLike {
  code: string;
  map?: unknown;
}

export interface VitePluginLike {
  configureServer?: (server: {
    config: { root: string };
    middlewares: { use(handler: ViteMiddlewareLike): void };
  }) => void;
  name?: string;
  transform?: (
    source: string,
    id: string,
  ) =>
    | Promise<ViteTransformResultLike | null | undefined>
    | ViteTransformResultLike
    | null
    | undefined;
}

export type ViteMiddlewareLike = (
  request: { url?: string },
  response: {
    end(value: string): void;
    setHeader(name: string, value: string): void;
    statusCode?: number;
  },
  next: () => void,
) => void;

export interface VitePluginMiddlewareFact {
  middleware: ViteMiddlewareLike;
  pluginName: string;
}

export interface ViteTransformElementFact {
  elements: GeneratedRenderedElementFact[];
  mapIsNull: boolean;
}

export interface ViteHandlerTransformFact extends ViteTransformElementFact {
  handlerReference: GeneratedHandlerReferenceFact;
  handlerSummary: GeneratedHandlerReferenceSummaryFact;
}

export interface ViteGeneratedHandlerMiddlewareFact {
  body: string;
  contentType: string | undefined;
  handlerName: string;
  invocationResult: unknown;
  nextCallsAfterHit: number;
  nextCallsAfterStale: number;
  statusCode: number | undefined;
}

export interface ViteRedGreenBuildFixtureOptions {
  coreAlias: string;
  entrypoint: string;
  fileName: string;
  fixtureParent?: string;
  fixturePrefix?: string;
  greenSource: string;
  jsxRuntimeAlias?: string;
  packageName?: string;
  projectRoot: string;
  redSource: string;
  vitePluginImportUrl: string;
  vpExecutable: string;
}

export interface ViteRedGreenBuildFixtureFact {
  greenDistEntries: string[];
  redOutput: string;
}

export interface ViteProductionEmitContractFact {
  handlerSummary: GeneratedHandlerReferenceSummaryFact;
  mapIsNull: boolean;
  middleware: {
    cartEvents: unknown[];
    contentType: string | undefined;
    invocationResult: unknown;
    nextCallsAfterHit: number;
    nextCallsAfterStale: number;
    statusCode: number | undefined;
  };
  pluginName: string;
  prodEmit: {
    stderr: string;
    stdoutLines: string[];
  };
  renderedButtonAttrs: Record<string, string>;
}

export interface ViteProductionEmitContractOptions {
  componentId?: string;
  context?: Record<string, unknown>;
  createPlugin: () => VitePluginLike;
  executeClientModule: (
    source: string,
    options: { context?: Record<string, unknown>; runtime: Record<string, unknown> },
  ) => Record<string, unknown>;
  invocation?: { ctx: unknown; event: unknown };
  prodEmit?: {
    args?: string[];
    command?: string;
    cwd?: string;
  };
  projectRoot: string;
  runtime: Record<string, unknown>;
  source?: string;
}

export function vitePluginMiddlewareFact(
  plugin: VitePluginLike,
  options: { root: string },
): VitePluginMiddlewareFact {
  let middleware: ViteMiddlewareLike | undefined;
  plugin.configureServer?.({
    config: { root: options.root },
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
  });

  if (!middleware) {
    throw new Error('Vite plugin registered middleware');
  }

  return {
    middleware,
    pluginName: plugin.name ?? '',
  };
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export function viteTransformElementFact(
  plugin: VitePluginLike,
  options: { id: string; selector?: { tag?: string }; source: string },
): ViteTransformElementFact {
  const transformed = plugin.transform?.(options.source, options.id);
  if (isPromiseLike(transformed)) {
    throw new Error('Vite plugin transform returned a Promise; use viteTransformElementFactAsync.');
  }
  return viteTransformElementFactFromResult(transformed, options);
}

export async function viteTransformElementFactAsync(
  plugin: VitePluginLike,
  options: { id: string; selector?: { tag?: string }; source: string },
): Promise<ViteTransformElementFact> {
  const transformed = await plugin.transform?.(options.source, options.id);
  return viteTransformElementFactFromResult(transformed, options);
}

function viteTransformElementFactFromResult(
  transformed: Awaited<ReturnType<NonNullable<VitePluginLike['transform']>>>,
  options: { selector?: HtmlElementSelector },
): ViteTransformElementFact {
  if (!transformed) {
    throw new Error('Vite plugin transformed component source');
  }

  return {
    elements: htmlElementFacts(transformed.code, options.selector).map(
      ({ attrs, innerHtml, tag }) => ({
        attrs,
        innerHtml,
        tag,
      }),
    ),
    mapIsNull: transformed.map === null,
  };
}

export function viteHandlerTransformFact(
  plugin: VitePluginLike,
  options: {
    expectedElementCount?: number;
    handlerAttribute?: string;
    id: string;
    selector?: { tag?: string };
    source: string;
  },
): ViteHandlerTransformFact {
  const transformFact = viteTransformElementFact(plugin, options);
  const expectedElementCount = options.expectedElementCount ?? 1;
  if (transformFact.elements.length !== expectedElementCount) {
    throw new Error(
      `Expected ${expectedElementCount} generated element(s); found ${transformFact.elements.length}`,
    );
  }

  const handlerAttribute = options.handlerAttribute ?? 'on:click';
  const handlerRef = transformFact.elements[0]?.attrs[handlerAttribute] ?? '';

  return {
    ...transformFact,
    handlerReference: generatedHandlerReferenceFact(handlerRef),
    handlerSummary: generatedHandlerReferenceSummaryFact(handlerRef),
  };
}

export async function viteHandlerTransformFactAsync(
  plugin: VitePluginLike,
  options: {
    expectedElementCount?: number;
    handlerAttribute?: string;
    id: string;
    selector?: { tag?: string };
    source: string;
  },
): Promise<ViteHandlerTransformFact> {
  const transformFact = await viteTransformElementFactAsync(plugin, options);
  const expectedElementCount = options.expectedElementCount ?? 1;
  if (transformFact.elements.length !== expectedElementCount) {
    throw new Error(
      `Expected ${expectedElementCount} generated element(s); found ${transformFact.elements.length}`,
    );
  }

  const handlerAttribute = options.handlerAttribute ?? 'on:click';
  const handlerRef = transformFact.elements[0]?.attrs[handlerAttribute] ?? '';

  return {
    ...transformFact,
    handlerReference: generatedHandlerReferenceFact(handlerRef),
    handlerSummary: generatedHandlerReferenceSummaryFact(handlerRef),
  };
}

export function viteGeneratedHandlerMiddlewareFact(options: {
  context?: Record<string, unknown>;
  executeClientModule: (
    source: string,
    options: { context?: Record<string, unknown>; runtime: Record<string, unknown> },
  ) => Record<string, unknown>;
  handlerReference: GeneratedHandlerReferenceFact;
  invocation: { ctx: unknown; event: unknown };
  middleware: ViteMiddlewareLike;
  runtime: Record<string, unknown>;
}): ViteGeneratedHandlerMiddlewareFact {
  const headers = new Map<string, string>();
  let body = '';
  let nextCalls = 0;
  const response: {
    end(value: string): void;
    setHeader(name: string, value: string): void;
    statusCode?: number;
  } = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    end(value: string) {
      body = value;
    },
  };

  options.middleware({ url: options.handlerReference.requestPath }, response, () => {
    nextCalls += 1;
  });
  const nextCallsAfterHit = nextCalls;
  const executeOptions: { context?: Record<string, unknown>; runtime: Record<string, unknown> } = {
    runtime: options.runtime,
  };
  if (options.context !== undefined) executeOptions.context = options.context;
  const clientExports = options.executeClientModule(body, executeOptions);
  const handlerExport = clientExports[options.handlerReference.handlerName];
  if (typeof handlerExport !== 'function') {
    throw new Error(`Generated client export is callable: ${options.handlerReference.handlerName}`);
  }
  const invocationResult = handlerExport(options.invocation.event, options.invocation.ctx);

  options.middleware({ url: options.handlerReference.staleVersionRequestPath }, response, () => {
    nextCalls += 1;
  });

  return {
    body,
    contentType: headers.get('Content-Type'),
    handlerName: options.handlerReference.handlerName,
    invocationResult,
    nextCallsAfterHit,
    nextCallsAfterStale: nextCalls,
    statusCode: response.statusCode,
  };
}

export async function viteRedGreenBuildFixtureFact(
  options: ViteRedGreenBuildFixtureOptions,
): Promise<ViteRedGreenBuildFixtureFact> {
  const fixtureRoot = await mkdtemp(
    join(options.fixtureParent ?? tmpdir(), options.fixturePrefix ?? 'kovo-vite-build-'),
  );
  const sourcePath = join(fixtureRoot, options.fileName);

  try {
    await mkdir(join(fixtureRoot, 'routes'), { recursive: true });
    await writeFile(
      join(fixtureRoot, 'package.json'),
      JSON.stringify({
        name: options.packageName ?? 'kovo-vite-build-fixture',
        private: true,
        type: 'module',
      }),
      'utf8',
    );
    await writeFile(
      join(fixtureRoot, 'index.html'),
      '<!doctype html><div id="app"></div><script type="module" src="/main.tsx"></script>\n',
      'utf8',
    );
    await writeFile(
      join(fixtureRoot, 'vite.config.mjs'),
      [
        `import { kovoVitePlugin } from ${JSON.stringify(options.vitePluginImportUrl)};`,
        '',
        `const jsxRuntimeAlias = ${JSON.stringify(
          options.jsxRuntimeAlias ??
            join(options.projectRoot, 'packages/server/src/jsx-runtime.ts'),
        )};`,
        '',
        'export default {',
        "  plugins: [Object.assign(kovoVitePlugin(), { enforce: 'pre' })],",
        '  resolve: {',
        '    alias: {',
        `      '@kovojs/core/internal/security-url': ${JSON.stringify(
          join(options.projectRoot, 'dist/core/src/internal/security-url.mjs'),
        )},`,
        `      '@kovojs/core/internal/sql-safety': ${JSON.stringify(
          join(options.projectRoot, 'dist/core/src/internal/sql-safety.mjs'),
        )},`,
        `      '@kovojs/core/internal/sink-policy': ${JSON.stringify(
          join(options.projectRoot, 'dist/core/src/internal/sink-policy.mjs'),
        )},`,
        `      '@kovojs/core/internal/diagnostics': ${JSON.stringify(
          join(options.projectRoot, 'dist/core/src/internal/diagnostics.mjs'),
        )},`,
        `      '@kovojs/core/internal/query-delta': ${JSON.stringify(
          join(options.projectRoot, 'dist/core/src/internal/query-delta.mjs'),
        )},`,
        `      '@kovojs/core': ${JSON.stringify(options.coreAlias)},`,
        "      'react/jsx-dev-runtime': jsxRuntimeAlias,",
        "      'react/jsx-runtime': jsxRuntimeAlias,",
        '    },',
        '  },',
        '};',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(join(fixtureRoot, 'main.tsx'), options.entrypoint, 'utf8');
    await writeFile(sourcePath, options.redSource, 'utf8');

    let redOutput = '';
    try {
      await execFileAsync(options.vpExecutable, ['build'], { cwd: fixtureRoot });
      throw new Error('Expected red Vite build fixture to fail');
    } catch (error) {
      redOutput = commandErrorOutput(error);
    }

    await writeFile(sourcePath, options.greenSource, 'utf8');
    await execFileAsync(options.vpExecutable, ['build'], { cwd: fixtureRoot });
    const greenDistEntries = (await readdir(join(fixtureRoot, 'dist'))).toSorted((left, right) =>
      left.localeCompare(right),
    );

    return { greenDistEntries, redOutput };
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

export async function viteProductionEmitContractFact(
  options: ViteProductionEmitContractOptions,
): Promise<ViteProductionEmitContractFact> {
  const prodEmit = await execFileAsync(
    options.prodEmit?.command ?? 'node',
    options.prodEmit?.args ?? ['scripts/prod-emit-check.mjs'],
    {
      cwd: options.prodEmit?.cwd ?? options.projectRoot,
      maxBuffer: 1024 * 1024 * 10,
    },
  );
  const plugin = options.createPlugin();
  const middlewareFact = vitePluginMiddlewareFact(plugin, { root: options.projectRoot });
  const cartEvents: unknown[] = [];
  const context =
    options.context ??
    ({
      addToCart(id: unknown) {
        cartEvents.push(id);
        return `added:${String(id)}`;
      },
    } satisfies Record<string, unknown>);
  const handlerTransform = await viteHandlerTransformFactAsync(plugin, {
    id: options.componentId ?? join(options.projectRoot, 'routes/products/product-card.tsx'),
    selector: { tag: 'button' },
    source: options.source ?? productCardSourceFixture,
  });
  const middlewareResult = viteGeneratedHandlerMiddlewareFact({
    context,
    executeClientModule: options.executeClientModule,
    handlerReference: handlerTransform.handlerReference,
    invocation: options.invocation ?? { ctx: { params: { id: 'p1' } }, event: 'click' },
    middleware: middlewareFact.middleware,
    runtime: options.runtime,
  });

  return {
    handlerSummary: handlerTransform.handlerSummary,
    mapIsNull: handlerTransform.mapIsNull,
    middleware: {
      cartEvents,
      contentType: middlewareResult.contentType,
      invocationResult: middlewareResult.invocationResult,
      nextCallsAfterHit: middlewareResult.nextCallsAfterHit,
      nextCallsAfterStale: middlewareResult.nextCallsAfterStale,
      statusCode: middlewareResult.statusCode,
    },
    pluginName: middlewareFact.pluginName,
    prodEmit: {
      stderr: prodEmit.stderr,
      stdoutLines: commandOutputLines(prodEmit.stdout),
    },
    renderedButtonAttrs: handlerTransform.elements[0]?.attrs ?? {},
  };
}

const productCardSourceFixture = `
import { component } from '@kovojs/core';
import { addToCart } from './cart-actions';

export const ProductCard = component({
  render: () => (
    <article>
      <button onClick={() => addToCart(product.id)}>Add</button>
    </article>
  ),
});
`;

function commandOutputLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function commandErrorOutput(error: unknown): string {
  const result = error as { message?: unknown; stderr?: unknown; stdout?: unknown };
  return [result.stdout, result.stderr, result.message].map(commandOutputPart).join('\n');
}

function commandOutputPart(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Error) return value.message;
  return JSON.stringify(value);
}
