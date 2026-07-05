import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const contentDir = path.join(siteRoot, 'content');
const cliBin = path.join(repoRoot, 'packages/cli/src/bin.ts');

const ENDPOINTS_GRAPH = {
  endpoints: [
    {
      auth: 'verifier:stripe-signature',
      body: 'raw',
      cache: 'no-store',
      csrf: 'exempt',
      csrfJustification: 'signed stripe webhook',
      headers: ['Stripe-Signature'],
      method: 'POST',
      name: 'app-shell/order-paid',
      path: '/webhooks/order-paid',
      rateLimit: 'webhook:stripe',
      surface: 'webhook',
      writes: ['order'],
    },
    {
      access: { kind: 'public', reason: 'public echo endpoint is CSRF checked' },
      body: 'json',
      cache: 'no-store',
      csrf: 'checked',
      method: 'POST',
      name: 'echo',
      path: '/api/echo-json',
    },
    {
      auth: 'none',
      authJustification: 'public uptime probe',
      body: 'json',
      cache: 'no-store',
      csrf: 'checked',
      method: 'GET',
      name: 'health',
      path: '/healthz',
    },
    {
      auth: 'custom:api-key',
      body: 'bytes',
      bodySize: 'stream',
      cache: 'private,no-store',
      csrf: 'checked',
      files: ['inventory.bin'],
      headers: ['Content-Disposition', 'Content-Type'],
      method: 'GET',
      name: 'inventory/download',
      path: '/downloads/inventory.bin',
      rateLimit: 'download:user',
      surface: 'route-file',
    },
  ],
};

const UNSCOPED_GRAPH = {
  ownerDomains: [{ domain: 'cart', owner: 'userId' }],
  scopeAudits: [
    {
      domain: 'cart',
      kind: 'query',
      name: 'cartById',
      scope: 'args',
      site: 'cart.queries.ts:21',
    },
  ],
};

const OPTIMISTIC_GRAPH = {
  components: [
    { name: 'CartBadge', queries: ['cart'] },
    { name: 'Recommendations', queries: ['recommendations'] },
  ],
  mutations: [
    {
      enctype: 'multipart/form-data',
      fileFields: ['receipt'],
      guards: ['authed'],
      inputFields: ['productId', 'quantity', 'receipt'],
      invalidates: ['cart'],
      key: 'cart/add',
      manualInvalidates: ['product'],
      session: 'commerceSession',
      writes: ['cart', 'product'],
    },
  ],
  optimistic: [
    { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
    { mutation: 'cart/add', query: 'recommendations', status: 'await-fragment' },
    { mutation: 'cart/add', query: 'cart.discount', status: 'UNHANDLED' },
  ],
  pages: [{ queries: ['cart'], route: '/cart' }],
  queries: [
    { domains: ['cart'], query: 'cart' },
    { domains: ['product'], query: 'recommendations' },
  ],
};

const EXPLAIN_OUTPUT_CASES = [
  {
    args: ['--endpoints'],
    files: ['guides/endpoints-webhooks.md', 'guides/security.md'],
    graph: ENDPOINTS_GRAPH,
    id: 'endpoints',
  },
  {
    args: ['--unscoped'],
    files: ['guides/security.md'],
    graph: UNSCOPED_GRAPH,
    id: 'unscoped',
  },
  {
    args: ['mutation', 'cart/add', '--optimistic'],
    files: ['guides/kovo-explain.md'],
    graph: OPTIMISTIC_GRAPH,
    id: 'optimistic',
  },
];

export function checkDocsExplainOutputs({ dir = contentDir } = {}) {
  const failures = [];

  for (const testCase of EXPLAIN_OUTPUT_CASES) {
    const output = runExplainFixture(testCase);
    const fencedOutput = `\`\`\`txt\n${output}\`\`\``;
    for (const relativePath of testCase.files) {
      const markdown = readFileSync(path.join(dir, relativePath), 'utf8');
      if (!markdown.includes(fencedOutput)) {
        failures.push(`${relativePath}: missing current kovo explain ${testCase.id} output`);
      }
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`docs-explain-output: ${failure}\n`);
    throw new Error(`docs-explain-output: ${failures.length} drift issue(s) found`);
  }

  process.stdout.write(`docs-explain-output/v1 cases=${EXPLAIN_OUTPUT_CASES.length} OK\n`);
}

function runExplainFixture(testCase) {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-docs-explain-'));
  const graphPath = path.join(root, 'graph.json');
  try {
    writeFileSync(graphPath, `${JSON.stringify(testCase.graph)}\n`, 'utf8');
    return execFileSync(
      process.execPath,
      ['--experimental-transform-types', cliBin, 'explain', ...testCase.args, graphPath],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      },
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkDocsExplainOutputs();
}
