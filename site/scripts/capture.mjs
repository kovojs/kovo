import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/**
 * Artifact-capture harness (plan W3). Every landing/docs visual is regenerated
 * from the real toolchain on every build; a capture whose source cannot
 * produce output throws, which fails the site build — drift-proof by
 * construction (plan exit criterion 2). Styled presentation, verbatim content.
 */

// SPEC §4.4 / S2 gate: the always-loaded bootstrap stays ≤8KB gzipped — the
// same measurement packages/browser/src/index.test.ts pins.
const LOADER_BUDGET_BYTES = 8192;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(scriptDir, '..');
const kovoBin = resolve(siteRoot, 'node_modules/.bin/kovo');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsFile(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function artifactFrame(title, bodyHtml) {
  return `<figure class="artifact">
  <figcaption class="artifact-title">${escapeHtml(title)}</figcaption>
  <pre class="artifact-body">${bodyHtml}</pre>
</figure>`;
}

/**
 * The KV227 golden teaching error (SPEC §4.8), produced by the real compiler
 * against the same nullable-shape fixture the compiler test suite pins.
 */
export function captureTeachingError() {
  const source = `
export const ProductCard = component({
  render: () => <span data-bind="product.details.name">Coffee</span>,
});
`;

  const compiled = compileComponentCapture({
    allowedDiagnostics: ['KV227'],
    fileName: 'src/product-card.tsx',
    queryShapeFacts: [
      {
        query: 'product',
        shape: { details: { kind: 'nullable', shape: { name: 'string' } } },
        source: 'generated/queries/product.shape.ts',
      },
    ],
    source,
  });
  const diagnostic = compiled.warnings.find((entry) => entry.code === 'KV227');
  if (!diagnostic) {
    throw new Error(
      'capture: the KV227 fixture no longer produces its teaching error — update the capture or the landing claim',
    );
  }

  const lines = [
    `<span class="tok-dim">$ vp check</span>`,
    '',
    `<span class="tok-dim">${escapeHtml(diagnostic.fileName)}</span> — <span class="tok-error">${escapeHtml(diagnostic.code)}</span> warning`,
    '',
    `  ${escapeHtml(diagnostic.message)}`,
  ];

  return artifactFrame('vp check — compiled against the real query shape', lines.join('\n'));
}

/** The pinned enhanced-mutation wire fixture (SPEC §9.1), rendered verbatim. */
export async function captureWireTrace(repoRoot) {
  const fixture = await readFile(new URL('fixtures/wire/enhanced-mutation.http', repoRoot), 'utf8');

  const exchange = fixture.split('>>> REQUEST')[1];
  if (!exchange) throw new Error('capture: enhanced-mutation.http fixture shape changed');
  const [request, response] = exchange.split('<<< RESPONSE');
  if (!request || !response) {
    throw new Error('capture: enhanced-mutation.http fixture shape changed');
  }

  const renderBlock = (block) =>
    block
      .trim()
      .split('\n')
      .map((line) => {
        if (/^(POST|GET|HTTP\/)/.test(line))
          return `<span class="tok-code">${escapeHtml(line)}</span>`;
        if (/^[A-Za-z-]+:/.test(line)) return `<span class="tok-header">${escapeHtml(line)}</span>`;
        return escapeHtml(line);
      })
      .join('\n');

  const body = `<span class="tok-dim">&gt;&gt;&gt; what the Network panel shows when you click "Add to cart"</span>\n\n${renderBlock(request)}\n\n<span class="tok-dim">&lt;&lt;&lt; the response — readable HTML and query JSON, not a JSON RPC blob</span>\n\n${renderBlock(response)}`;

  return artifactFrame('fixtures/wire/enhanced-mutation.http — pinned byte-for-byte in CI', body);
}

/** kovo explain against the commerce app graph — the queryable behavior surface. */
export async function captureKovoExplain(_repoRoot) {
  const { kovoExplain } = await import('@kovojs/cli');
  const graph = {
    endpoints: [],
    mutations: [
      {
        guards: ['authed', 'rateLimit:session'],
        inputFields: ['productId', 'quantity'],
        invalidates: ['cart', 'product', 'order'],
        key: 'cart/add',
        session: 'commerceSession',
        writes: ['cart', 'product', 'order'],
      },
    ],
    optimistic: [
      { derivation: { status: 'derived' }, mutation: 'cart/add', query: 'cart', status: 'derived' },
      {
        derivation: { status: 'derived' },
        mutation: 'cart/add',
        query: 'productGrid',
        status: 'derived',
      },
      {
        derivation: { status: 'derived' },
        mutation: 'cart/add',
        query: 'orderHistory',
        status: 'derived',
      },
    ],
    pages: [],
    queries: [
      { domains: ['cart'], query: 'cart' },
      { domains: ['product'], query: 'productGrid' },
      { domains: ['order'], query: 'orderHistory' },
    ],
    touchGraph: {
      'cart.addItem': {
        reads: [],
        touches: [
          {
            domain: 'cart',
            keys: null,
            site: 'examples/commerce/src/domain.ts:120',
            via: 'cart_items',
          },
          {
            domain: 'product',
            keys: 'arg:productId',
            predicate: 'eq',
            site: 'examples/commerce/src/domain.ts:121',
            via: 'products',
          },
          {
            domain: 'order',
            keys: null,
            site: 'examples/commerce/src/domain.ts:122',
            via: 'orders',
          },
        ],
        unresolved: [],
      },
    },
  };

  const result = kovoExplain(graph, { kind: 'mutation', optimistic: true, target: 'cart/add' });
  if (result.exitCode !== 0) {
    throw new Error(`capture: kovo explain failed:\n${result.output}`);
  }

  const body = [
    `<span class="tok-dim">$ kovo explain mutation cart/add --optimistic graph.json</span>`,
    '',
    ...result.output
      .trimEnd()
      .split('\n')
      .map((line) =>
        /^(OPTIMISTIC|updates:|invalidates:)/.test(line)
          ? `<span class="tok-code">${escapeHtml(line)}</span>`
          : escapeHtml(line),
      ),
  ].join('\n');

  return artifactFrame('kovo explain — the commerce reference app, real output', body);
}

/** The inline loader budget, measured from the artifact that actually ships. */
export async function captureLoaderBudget() {
  const { kovoLoaderSource } = await import('@kovojs/browser/internal/inline-loader');
  const rawBytes = Buffer.byteLength(kovoLoaderSource, 'utf8');
  const gzipBytes = gzipSync(kovoLoaderSource).byteLength;
  if (gzipBytes > LOADER_BUDGET_BYTES) {
    throw new Error(
      `capture: inline loader is ${gzipBytes}B gzipped, over its ${LOADER_BUDGET_BYTES}B budget — the landing claim would be false`,
    );
  }
  return { budget: LOADER_BUDGET_BYTES, gzipBytes, rawBytes };
}

/**
 * A complete TSX → IR lowering example for the Compiler Internals guide,
 * compiled by the real compiler on every build so the emitted output in the
 * docs can never drift from what the compiler actually produces (SPEC §5.2).
 */
export function captureLowering() {
  const source = `import { component } from '@kovojs/core';

export const CartBadge = component({
  queries: { cart: cartQuery },
  state: () => ({ count: 0 }),
  render: (props, state) => (
    <button class="badge" onClick={() => state.count += 1}>
      Cart (<span>{cart.count}</span>)
    </button>
  ),
});
`;

  const compiled = compileComponentCapture({
    allowedDiagnostics: ['KV210'],
    fileName: 'src/cart-badge.tsx',
    source,
  });

  if (!compiled.lowered || !compiled.client) {
    throw new Error('capture: lowering example emitted no server/client IR');
  }

  const lint = compiled.warnings.find((entry) => entry.code === 'KV210');

  return {
    client: compiled.client.trim(),
    input: source.trim(),
    lint: lint ? `${lint.code} ${lint.severity}: ${lint.message}` : '',
    server: compiled.lowered.trim(),
  };
}

function compileComponentCapture({ allowedDiagnostics = [], fileName, queryShapeFacts, source }) {
  const root = mkdtempSync(resolve(tmpdir(), 'kovo-site-capture-'));
  try {
    const sourcePath = resolve(root, fileName);
    const outPath = resolve(root, 'generated/component.tsx');
    const queryShapeFactsPath = resolve(root, 'query-shape-facts.json');
    mkdirp(dirname(sourcePath));
    writeFileSync(sourcePath, source);
    if (queryShapeFacts !== undefined) {
      writeFileSync(queryShapeFactsPath, `${JSON.stringify(queryShapeFacts, null, 2)}\n`);
    }

    const output = execFileSync(
      kovoBin,
      [
        'compile',
        'component',
        sourcePath,
        '--out',
        outPath,
        '--file-name',
        fileName,
        '--emit-client-files',
        ...(queryShapeFacts === undefined ? [] : ['--query-shape-facts', queryShapeFactsPath]),
        ...allowedDiagnostics.flatMap((code) => ['--allow-diagnostic', code]),
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const clientPath = resolve(root, fileName.replace(/\.tsx$/, '.client.js'));

    return {
      client: existsFile(clientPath) ? readFileSync(clientPath, 'utf8') : '',
      lowered: readFileSync(outPath, 'utf8'),
      warnings: parseCompileWarnings(output),
    };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function parseCompileWarnings(output) {
  return output
    .split('\n')
    .map((line) => line.match(/^WARN (KV\d+) file="([^"]+)" (.+)$/)?.slice(1))
    .filter(Boolean)
    .map(([code, fileName, message]) => ({
      code,
      fileName,
      message,
      severity: 'warning',
    }));
}

function existsFile(filePath) {
  try {
    return readFileSync(filePath).byteLength >= 0;
  } catch {
    return false;
  }
}

function mkdirp(dir) {
  mkdirSync(dir, { recursive: true });
}

export async function captureAll(repoRoot) {
  return {
    kovoExplain: await captureKovoExplain(repoRoot),
    loader: await captureLoaderBudget(),
    lowering: captureLowering(),
    teachingError: captureTeachingError(),
    wireTrace: await captureWireTrace(repoRoot),
  };
}
