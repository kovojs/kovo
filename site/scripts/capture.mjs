import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

import { compileComponentModule } from '../../dist/compiler/src/index.mjs';
import { kovoExplain } from '../../dist/cli/src/index.mjs';
import { kovoLoaderSource } from '../../dist/runtime/src/index.mjs';

/**
 * Artifact-capture harness (plan W3). Every landing/docs visual is regenerated
 * from the real toolchain on every build; a capture whose source cannot
 * produce output throws, which fails the site build — drift-proof by
 * construction (plan exit criterion 2). Styled presentation, verbatim content.
 */

// SPEC §4.4 / S2 gate: the always-loaded bootstrap stays ≤8KB gzipped — the
// same measurement packages/runtime/src/index.test.ts pins.
const LOADER_BUDGET_BYTES = 8192;

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
  const result = compileComponentModule({
    fileName: 'src/product-card.tsx',
    queryShapeFacts: [
      {
        query: 'product',
        shape: { details: { kind: 'nullable', shape: { name: 'string' } } },
        source: 'generated/queries/product.shape.ts',
      },
    ],
    source: `
export const ProductCard = component({
  render: () => <span data-bind="product.details.name">Coffee</span>,
});
`,
  });

  const diagnostic = result.diagnostics.find((entry) => entry.code === 'KV227');
  if (!diagnostic) {
    throw new Error(
      'capture: the KV227 fixture no longer produces its teaching error — update the capture or the landing claim',
    );
  }

  const lines = [
    `<span class="tok-dim">$ vp check</span>`,
    '',
    `<span class="tok-dim">${escapeHtml(diagnostic.fileName)}:${diagnostic.start.line}:${diagnostic.start.column}</span> — <span class="tok-error">${escapeHtml(diagnostic.code)}</span> ${escapeHtml(diagnostic.severity)}`,
    '',
    `  ${escapeHtml(diagnostic.message)}`,
    '',
    ...diagnostic.help
      .split('\n')
      .map((line) => `  <span class="tok-dim">${escapeHtml(line)}</span>`),
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
export async function captureKovoExplain(repoRoot) {
  const graph = JSON.parse(
    await readFile(new URL('examples/commerce/src/generated/graph.json', repoRoot), 'utf8'),
  );

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
export function captureLoaderBudget() {
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

  const result = compileComponentModule({ fileName: 'src/cart-badge.tsx', source });
  const errors = result.diagnostics.filter((entry) => entry.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`capture: lowering example no longer compiles: ${JSON.stringify(errors)}`);
  }

  const server = result.files.find((file) => file.kind === 'server')?.source;
  const client = result.files.find((file) => file.kind === 'client')?.source;
  if (!server || !client) throw new Error('capture: lowering example emitted no server/client IR');

  const lint = result.diagnostics.find((entry) => entry.code === 'KV210');

  return {
    client: client.trim(),
    input: source.trim(),
    lint: lint ? `${lint.code} ${lint.severity}: ${lint.message}` : '',
    server: server.trim(),
  };
}

export async function captureAll(repoRoot) {
  return {
    kovoExplain: await captureKovoExplain(repoRoot),
    loader: captureLoaderBudget(),
    lowering: captureLowering(),
    teachingError: captureTeachingError(),
    wireTrace: await captureWireTrace(repoRoot),
  };
}
