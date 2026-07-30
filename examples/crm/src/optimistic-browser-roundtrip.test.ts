import { runWithCrmGeneratedGraphs } from '../../../tests/example-generated-graphs.setup.js';

import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';

import { chromium, type Browser } from 'playwright';
import { expect as expectLocator } from '@playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { build as viteBuild, type Plugin } from 'vite-plus';

import { toNodeHandler } from '@kovojs/server/node';
import { createExampleTestRequestHandler } from '../../../tests/example-raw-request-handler.js';
import { resolveKovoAppToken, type KovoApp } from '../../../packages/server/src/app-token.js';
import type { CrmDb } from './db.js';
import { deals } from './schema.js';
import { eq } from 'drizzle-orm';

const DEAL_QUERY = 'queries/deal-by-id-query';
const CLOSE_MUTATION = 'mutations/close-deal';
const MOVE_MUTATION = 'mutations/move-deal';
const BROWSER_CLIENT_PATH = '/__kovo_test/crm-optimistic-client.js';

let browser: Browser | undefined;
let browserBundle = '';
let server: Server | undefined;

beforeAll(async () => {
  const application = await buildCrmApplication();
  browserBundle = await buildBrowserBundle(application.app);
});

afterEach(async () => {
  await browser?.close();
  browser = undefined;
  await closeServer();
});

afterAll(async () => {
  await closeServer();
});

describe('CRM app-scoped optimistic browser round trip', () => {
  it('predicts one keyed deal, marks it pending, then rebases to server truth', async () => {
    const { app, db } = await buildCrmApplication();
    const origin = await startServer(app);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ bypassCSP: true });

    await page.route(`**/_m/${CLOSE_MUTATION}`, async (route) => {
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 500));
      await route.continue();
    });
    await page.goto(`${origin}/deals/d1`, { waitUntil: 'domcontentloaded' });
    await page.locator('body[data-crm-optimistic-ready="true"]').waitFor();

    const detail = page.locator('[kovo-c="deal-detail-region"]');
    const stage = page.locator('#crm-optimistic-stage');
    const amount = page.locator('#crm-optimistic-amount');
    const sibling = page.locator('#crm-optimistic-sibling-stage');
    const pending = page.locator('#crm-optimistic-pending');
    const outcome = page.locator('#crm-optimistic-outcome');

    await expectLocator(stage).toHaveText('open');
    await expectLocator(amount).toHaveText('5000');
    await expectLocator(sibling).toHaveText('won');
    await expectLocator(pending).toHaveText('0');

    const response = page.waitForResponse((candidate) =>
      candidate.url().endsWith(`/_m/${CLOSE_MUTATION}`),
    );
    await page.getByRole('button', { name: 'Close won' }).click();

    // The app-authored keyed transform predicts synchronously. The commission remains the
    // pre-submit value because only the server computes it.
    await expectLocator(stage).toHaveText('won');
    await expectLocator(amount).toHaveText('5000');
    await expectLocator(sibling).toHaveText('won');
    await expectLocator(pending).toHaveText('1');
    await expectLocator(detail).toHaveAttribute('kovo-pending', '');
    await expectLocator(detail).toHaveAttribute('aria-busy', 'true');

    expect((await response).status()).toBe(200);
    await expectLocator(outcome).toHaveText('fulfilled');
    await expectLocator(stage).toHaveText('won');
    await expectLocator(amount).toHaveText('4000');
    await expectLocator(sibling).toHaveText('won');
    await expectLocator(pending).toHaveText('0');
    await expectLocator(detail).not.toHaveAttribute('kovo-pending', '');
    await expectLocator(detail).not.toHaveAttribute('aria-busy', 'true');

    const [persisted] = await db.select().from(deals).where(eq(deals.id, 'd1')).limit(1);
    expect(persisted).toMatchObject({ amount: 4000, stage: 'won' });
  });

  it('rolls back the exact keyed prediction when the server rejects the input', async () => {
    const { app, db } = await buildCrmApplication();
    const origin = await startServer(app);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ bypassCSP: true });

    await page.route(`**/_m/${MOVE_MUTATION}`, async (route) => {
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 500));
      await route.continue();
    });
    await page.goto(`${origin}/deals/d1`, { waitUntil: 'domcontentloaded' });
    await page.locator('body[data-crm-optimistic-ready="true"]').waitFor();

    const form = page.locator(`form[data-mutation="${MOVE_MUTATION}"][kovo-key="proposal"]`);
    await form.locator('input[name="stage"]').evaluate((element) => {
      element.setAttribute('value', 'invalid-stage');
    });

    const detail = page.locator('[kovo-c="deal-detail-region"]');
    const stage = page.locator('#crm-optimistic-stage');
    const sibling = page.locator('#crm-optimistic-sibling-stage');
    const pending = page.locator('#crm-optimistic-pending');
    const outcome = page.locator('#crm-optimistic-outcome');
    const response = page.waitForResponse((candidate) =>
      candidate.url().endsWith(`/_m/${MOVE_MUTATION}`),
    );

    await form.getByRole('button', { name: 'proposal' }).click();
    await expectLocator(stage).toHaveText('invalid-stage');
    await expectLocator(sibling).toHaveText('won');
    await expectLocator(pending).toHaveText('1');
    await expectLocator(detail).toHaveAttribute('aria-busy', 'true');

    expect((await response).status()).toBe(422);
    await expectLocator(outcome).toHaveText('fulfilled');
    await expectLocator(stage).toHaveText('open');
    await expectLocator(sibling).toHaveText('won');
    await expectLocator(pending).toHaveText('0');
    await expectLocator(detail).not.toHaveAttribute('aria-busy', 'true');

    const [persisted] = await db.select().from(deals).where(eq(deals.id, 'd1')).limit(1);
    expect(persisted).toMatchObject({ amount: 5000, stage: 'open' });
  });
});

async function buildCrmApplication(): Promise<{ app: KovoApp; db: CrmDb }> {
  return runWithCrmGeneratedGraphs(async () => {
    const applicationModule = await import('./interactive-app.js');
    return applicationModule.buildCrmInteractiveApp();
  });
}

async function startServer(app: KovoApp): Promise<string> {
  const handler = createExampleTestRequestHandler(app);
  server = createServer(
    toNodeHandler(
      async (request) => {
        const url = new URL(request.url);
        if (url.pathname === BROWSER_CLIENT_PATH) {
          return new Response(browserBundle, {
            headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
          });
        }
        if (url.pathname === '/assets/styles.css') {
          return new Response('', { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
        }

        const response = await handler(request);
        if (
          request.method !== 'GET' ||
          !url.pathname.startsWith('/deals/') ||
          !response.headers.get('content-type')?.startsWith('text/html')
        ) {
          return response;
        }

        const html = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, '');
        const clientScript = `<script type="module" src="${BROWSER_CLIENT_PATH}"></script>`;
        return new Response(html.replace('</body>', `${clientScript}</body>`), {
          headers: response.headers,
          status: response.status,
        });
      },
      { compression: false },
    ),
  );
  await new Promise<void>((resolveListen, rejectListen) => {
    server?.once('error', rejectListen);
    server?.listen(0, '127.0.0.1', () => {
      server?.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('CRM test server did not listen.');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(): Promise<void> {
  if (!server) return;
  const current = server;
  server = undefined;
  await new Promise<void>((resolveClose, rejectClose) => {
    current.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

interface MaterializedKeyedEntry {
  keys: Function;
  transform: Function;
}

function materializedKeyedEntry(
  app: KovoApp,
  mutationKey: string,
  queryName: string,
): MaterializedKeyedEntry {
  const runtime = resolveKovoAppToken(app, 'CRM optimistic browser fixture');
  const mutation = runtime.mutations.find((candidate) => candidate.key === mutationKey);
  if (!mutation) throw new Error(`CRM app omitted mutation ${mutationKey}.`);

  const optimistic: unknown = Reflect.get(mutation, 'optimistic');
  if (typeof optimistic !== 'object' || optimistic === null) {
    throw new Error(`CRM mutation ${mutationKey} omitted its materialized optimistic map.`);
  }
  const entry: unknown = Reflect.get(optimistic, queryName);
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`CRM mutation ${mutationKey} omitted keyed query ${queryName}.`);
  }
  const keys: unknown = Reflect.get(entry, 'keys');
  const transform: unknown = Reflect.get(entry, 'transform');
  if (typeof keys !== 'function' || typeof transform !== 'function') {
    throw new Error(`CRM mutation ${mutationKey} did not materialize a keyed query transform.`);
  }
  return { keys, transform };
}

function executableFunctionSource(value: Function): string {
  const source = Function.prototype.toString.call(value);
  if (source.startsWith('function') || source.startsWith('(') || source.includes('=>')) {
    return source;
  }
  return `function ${source}`;
}

async function buildBrowserBundle(app: KovoApp): Promise<string> {
  const close = materializedKeyedEntry(app, CLOSE_MUTATION, DEAL_QUERY);
  const move = materializedKeyedEntry(app, MOVE_MUTATION, DEAL_QUERY);
  const entryId = '\0kovo:crm-optimistic-browser-entry';
  const publicEntryId = 'virtual:kovo-crm-optimistic-browser-entry';
  const optimismModule = resolve('packages/browser/src/optimism.ts');
  const browserGeneratedModule = resolve('packages/browser/src/generated.ts');
  const optimisticFixtureModule = resolve('packages/test/src/integration/optimistic-client.ts');
  const source = crmBrowserClientSource({
    closeKeys: executableFunctionSource(close.keys),
    closeTransform: executableFunctionSource(close.transform),
    moveKeys: executableFunctionSource(move.keys),
    moveTransform: executableFunctionSource(move.transform),
    optimismModule,
  });
  const plugin: Plugin = {
    name: 'kovo-crm-optimistic-browser-fixture',
    load(id) {
      return id === entryId ? source : null;
    },
    resolveId(id) {
      if (id === publicEntryId) return entryId;
      if (id === '@kovojs/browser/generated') return browserGeneratedModule;
      if (id === '@kovojs/test/internal/integration/optimistic-client') {
        return optimisticFixtureModule;
      }
      return null;
    },
  };
  const result = await viteBuild({
    build: {
      minify: false,
      rolldownOptions: {
        input: publicEntryId,
        output: { codeSplitting: false, format: 'es' },
      },
      target: 'esnext',
      write: false,
    },
    configFile: false,
    logLevel: 'silent',
    plugins: [plugin],
  });
  const outputs = Array.isArray(result) ? result : [result];
  for (const output of outputs) {
    if (!('output' in output)) continue;
    for (const item of output.output) {
      if (item.type === 'chunk' && item.isEntry) return item.code;
    }
  }
  throw new Error('Vite did not emit the CRM optimistic browser fixture entry.');
}

function crmBrowserClientSource(options: {
  closeKeys: string;
  closeTransform: string;
  moveKeys: string;
  moveTransform: string;
  optimismModule: string;
}): string {
  return `
import { installKovoLoader } from '@kovojs/browser/generated';
import { installOptimisticFixtureClient } from '@kovojs/test/internal/integration/optimistic-client';
import { optimisticPlanFromAuthoredMap } from ${JSON.stringify(options.optimismModule)};

const QUERY = ${JSON.stringify(DEAL_QUERY)};
const CLOSE = ${JSON.stringify(CLOSE_MUTATION)};
const MOVE = ${JSON.stringify(MOVE_MUTATION)};
const d1Key = \`\${QUERY}:d1\`;
const d2Key = \`\${QUERY}:d2\`;
const generatedBindings = {
  [CLOSE]: {
    keys: ${options.closeKeys},
    transform: ${options.closeTransform},
  },
  [MOVE]: {
    keys: ${options.moveKeys},
    transform: ${options.moveTransform},
  },
};

// Framework-owned test lowering mirrors the generated browser handoff; app source has no plan.
function lowerGeneratedBinding(binding) {
  return {
    keys(input) {
      const instances = binding.keys(input);
      if (!Array.isArray(instances) || instances.length !== 1) {
        throw new TypeError('CRM fixture requires one exact keyed query instance.');
      }
      return instances[0];
    },
    transform: binding.transform,
  };
}

const plans = {
  [CLOSE]: optimisticPlanFromAuthoredMap({
    [QUERY]: lowerGeneratedBinding(generatedBindings[CLOSE]),
  }),
  [MOVE]: optimisticPlanFromAuthoredMap({
    [QUERY]: lowerGeneratedBinding(generatedBindings[MOVE]),
  }),
};
const client = installOptimisticFixtureClient({ installLoader: false });
const stage = document.createElement('output');
stage.id = 'crm-optimistic-stage';
const amount = document.createElement('output');
amount.id = 'crm-optimistic-amount';
const sibling = document.createElement('output');
sibling.id = 'crm-optimistic-sibling-stage';
const pending = document.createElement('output');
pending.id = 'crm-optimistic-pending';
const outcome = document.createElement('output');
outcome.id = 'crm-optimistic-outcome';
outcome.textContent = 'idle';
document.body.append(stage, amount, sibling, pending, outcome);

function renderDeal(value, stageOutput, amountOutput) {
  if (!value || typeof value !== 'object') return;
  const nextStage = Reflect.get(value, 'stage');
  const nextAmount = Reflect.get(value, 'amount');
  stageOutput.textContent = typeof nextStage === 'string' ? nextStage : '';
  if (amountOutput) {
    amountOutput.textContent = typeof nextAmount === 'number' ? String(nextAmount) : '';
  }
}

function renderPending() {
  pending.textContent = String(client.pendingCount(QUERY, d1Key));
}

client.store.subscribe(QUERY, (value) => renderDeal(value, stage, amount), d1Key);
client.store.subscribe(QUERY, (value) => renderDeal(value, sibling), d2Key);
installKovoLoader({
  events: [],
  importModule: (url) => import(/* @vite-ignore */ url),
  queryStore: client.store,
  root: document,
});

async function hydrateDeal(id) {
  const build = document.querySelector('meta[name="kovo-build"]')?.getAttribute('content');
  if (!build) throw new Error('CRM detail page omitted its build proof.');
  const url = new URL(\`/_q/\${QUERY}\`, location.href);
  url.searchParams.set('id', id);
  const response = await fetch(url, {
    headers: { Accept: 'text/vnd.kovo.fragment+html', 'Kovo-Build': build },
  });
  const documentFragment = new DOMParser().parseFromString(await response.text(), 'text/html');
  const query = documentFragment.querySelector('kovo-query');
  const name = query?.getAttribute('name');
  const key = query?.getAttribute('key');
  if (name !== QUERY || key !== \`\${QUERY}:\${id}\` || !query?.textContent) {
    throw new Error('CRM query did not return its canonical keyed instance.');
  }
  client.store.set(name, JSON.parse(query.textContent), key);
}

for (const form of document.querySelectorAll('form[data-mutation]')) {
  const mutation = form.getAttribute('data-mutation');
  if (mutation !== CLOSE && mutation !== MOVE) continue;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const formData = new FormData(form);
    const dealId = String(formData.get('dealId') ?? '');
    const input =
      mutation === CLOSE
        ? { dealId }
        : { dealId, stage: String(formData.get('stage') ?? '') };
    outcome.textContent = 'pending';
    const submitted = client.submitForm(form, {
      formData,
      input,
      optimistic: plans[mutation],
    });
    renderPending();
    void submitted.then(
      () => {
        outcome.textContent = 'fulfilled';
        renderPending();
      },
      () => {
        outcome.textContent = 'rejected';
        renderPending();
      },
    );
  });
}

await hydrateDeal('d1');
await hydrateDeal('d2');
for (const input of document.querySelectorAll('input[name="dealId"]')) {
  input.setAttribute('value', 'd1');
}
renderPending();
document.body.setAttribute('data-crm-optimistic-ready', 'true');
`;
}
