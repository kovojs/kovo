import { Buffer } from 'node:buffer';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { createApp, route } from '@kovojs/server';
import { renderedHtml } from '@kovojs/server/internal/html';
import { kovo } from '@kovojs/server/vite';

import { main, mainAsync } from './index.js';

const repoRoot = process.cwd();
const dockerIt = process.env.KOVO_TEST_DOCKER === '1' && dockerAvailable() ? it : it.skip;

describe('kovo build', () => {
  it('bundles an app module and emits node preset output without Vite at request time', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeFileSync(appPath, appModuleSource(), 'utf8');
      writeClientEntry(root);
      writeRetentionProofConfig(root);

      const exitCode = await withCwd(root, () =>
        withEnv({ VERCEL: '1' }, () => mainAsync(['build', './app.mjs', '--out', './dist'])),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-build/v1\nAPP module=');
      expect(output).toContain(`SUMMARY preset=node outDir=${JSON.stringify(outDir)}`);
      expect(readFileSync(join(outDir, '.kovo/server/handler.mjs'), 'utf8')).not.toContain('vite');

      const serverModule = (await import(
        `${pathToFileURL(join(outDir, 'server/server.mjs')).href}?t=${Date.now()}`
      )) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const origin = await listen(server);

      try {
        const document = await fetch(`${origin}/cart`);
        await expect(document.text()).resolves.toContain('<main>Cart 0</main>');
        expect(document.status).toBe(200);

        const mutationResponse = await fetch(`${origin}/_m/cart/add`, {
          body: new URLSearchParams({ quantity: '2' }),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          method: 'POST',
          redirect: 'manual',
        });
        expect(mutationResponse.status).toBe(303);

        const queryResponse = await fetch(`${origin}/_q/cart`);
        await expect(queryResponse.text()).resolves.toBe(
          '<kovo-query name="cart">{"count":2}</kovo-query>',
        );

        const clientModuleResponse = await fetch(`${origin}/c/__v/cart-v1/cart.client.js`);
        await expect(clientModuleResponse.text()).resolves.toBe('export const cartClient = true;');
        expect(clientModuleResponse.status).toBe(200);
        expect(clientModuleResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
        expect(clientModuleResponse.headers.get('content-type')).toBe(
          'text/javascript; charset=utf-8',
        );

        const stylesheetPath = builtAssetPath(outDir, (assetPath) => assetPath.endsWith('.css'));
        const stylesheetResponse = await fetch(`${origin}${stylesheetPath}`);
        const stylesheetText = await stylesheetResponse.text();
        expect(stylesheetText).toContain('color:#639');
        expect(stylesheetResponse.status).toBe(200);
        expect(stylesheetResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
        expect(stylesheetResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
      } finally {
        await close(server);
      }
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('loads TypeScript app modules through the build-time Vite SSR path', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-ts-app-'));
    const appPath = join(root, 'app.ts');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeFileSync(appPath, typescriptAppModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await withCwd(root, () =>
        mainAsync(['build', './app.ts', '--out', './dist']),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      expect(readFileSync(join(outDir, '.kovo/server/handler.mjs'), 'utf8')).toContain(
        'app/add-to-cart',
      );
      const graphPath = join(outDir, '.kovo/graph.json');
      expect(existsSync(graphPath)).toBe(true);
      expect(JSON.parse(readFileSync(graphPath, 'utf8'))).toMatchObject({
        pages: [{ route: '/typed' }],
      });
      stdout.mockClear();
      expect(
        await withCwd(root, async () => main(['explain', 'page', '/typed', '--layouts'])),
      ).toBe(0);
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('PAGE /typed');

      const serverModule = (await import(
        `${pathToFileURL(join(outDir, 'server/server.mjs')).href}?t=${Date.now()}`
      )) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const origin = await listen(server);

      try {
        const document = await fetch(`${origin}/typed`);
        await expect(document.text()).resolves.toContain('<main>Typed Cart 4</main>');
        expect(document.status).toBe(200);

        const mutationResponse = await fetch(`${origin}/_m/app/add-to-cart`, {
          body: new URLSearchParams({ quantity: '2' }),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          method: 'POST',
          redirect: 'manual',
        });
        expect(mutationResponse.status).toBe(303);

        const updatedDocument = await fetch(`${origin}/typed`);
        await expect(updatedDocument.text()).resolves.toContain('<main>Typed Cart 6</main>');
        expect(updatedDocument.status).toBe(200);
      } finally {
        await close(server);
      }
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails before artifact emission when the app TypeScript project has type errors', async () => {
    const root = mkdtempSync(join(repoRoot, 'tmp-kovo-build-ts-preflight-'));
    const appDir = join(root, 'src');
    const appPath = join(appDir, 'app.ts');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
      writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', strict: true },
          include: ['src/**/*.ts'],
        }),
        'utf8',
      );
      writeFileSync(
        appPath,
        'const count: number = "not a number";\nexport default { count };\n',
        'utf8',
      );

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(errorOutput).toContain('kovo build TypeScript preflight failed');
      expect(errorOutput).toContain("Type 'string' is not assignable to type 'number'");
      expect(existsSync(outDir)).toBe(false);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails before artifact emission when the derived kovo check graph has findings', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-check-preflight-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeFileSync(
        appPath,
        `
import { createApp, route } from '@kovojs/server';

export default createApp({
  routes: [
    route('/missing-access', {
      page: () => '<main>Missing access</main>',
    }),
  ],
});
`,
        'utf8',
      );

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(errorOutput).toContain('kovo build check preflight failed');
      expect(errorOutput).toContain('ERROR KV436 PAGE /missing-access');
      expect(existsSync(outDir)).toBe(false);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not report guarded build surfaces as UNGUARDED', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-access-facts-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeClientEntry(root);
      writeFileSync(
        appPath,
        `
import { createApp, mutation, publicAccess, query, route, s, trustedHtml } from '@kovojs/server';

const allow = () => true;

const adminQuery = query('adminOrders', {
  args: s.object({ id: s.string() }),
  guard: allow,
  load(input) {
    return { id: input.id };
  },
});

const adminMutation = mutation('admin/update', {
  csrf: false,
  csrfJustification: 'non-browser regression fixture',
  guard: allow,
  input: s.object({ id: s.string() }),
  handler() {
    return { ok: true };
  },
});

export default createApp({
  mutations: [adminMutation],
  queries: [adminQuery],
  routes: [
    route('/admin', {
      access: publicAccess('build access fixture shell'),
      guard: allow,
      page: () => trustedHtml('<main>Admin</main>', 'build access fixture'),
    }),
  ],
});
`,
        'utf8',
      );

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(errorOutput).not.toContain('UNGUARDED');
      expect(existsSync(outDir)).toBe(true);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('counts inline optimistic query entries without registry query duplication', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-inline-optimistic-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeClientEntry(root);
      writeFileSync(
        appPath,
        `
import { createApp, domain, mutation, publicAccess, query, route, s, trustedHtml } from '@kovojs/server';

const contactDomain = domain('contact');

const contactsQuery = query('contacts', {
  access: publicAccess('inline optimistic fixture'),
  reads: [contactDomain],
  load() {
    return { items: [] };
  },
});

const addContact = mutation('contacts/add', {
  access: publicAccess('inline optimistic fixture'),
  csrf: false,
  csrfJustification: 'non-browser regression fixture',
  input: s.object({ name: s.string() }),
  optimistic: { contacts: 'await-fragment' },
  registry: { touches: [contactDomain] },
  handler() {
    return { ok: true };
  },
});

export default createApp({
  mutations: [addContact],
  queries: [contactsQuery],
  routes: [
    route('/contacts', {
      access: publicAccess('inline optimistic fixture'),
      page: () => trustedHtml('<main>Contacts</main>', 'inline optimistic fixture'),
    }),
  ],
});
`,
        'utf8',
      );

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(errorOutput).not.toContain('KV310');
      expect(existsSync(outDir)).toBe(true);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('derives mutation invalidates from read-set intersections and optimistic keys', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-derived-invalidates-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeClientEntry(root);
      writeFileSync(
        appPath,
        `
import { createApp, domain, mutation, publicAccess, query, route, s, trustedHtml } from '@kovojs/server';

const contactDomain = domain('contact');
const authDomain = domain('auth');

const contactsQuery = query('queries/contacts-query', {
  access: publicAccess('derived invalidates fixture'),
  reads: [contactDomain],
  load() {
    return { items: [] };
  },
});

const contactDetailQuery = query('queries/contact-detail-query', {
  access: publicAccess('derived invalidates fixture'),
  reads: [contactDomain],
  load() {
    return { item: null };
  },
});

const authQuery = query('queries/auth-session-query', {
  access: publicAccess('derived invalidates fixture'),
  reads: [authDomain],
  load() {
    return { user: null };
  },
});

const updateContact = mutation('mutations/update-contact', {
  access: publicAccess('derived invalidates fixture'),
  csrf: false,
  csrfJustification: 'non-browser regression fixture',
  input: s.object({ name: s.string() }),
  optimistic: {
    'queries/contacts-query': 'await-fragment',
    'queries/contact-detail-query': 'await-fragment',
  },
  registry: {
    queries: [contactsQuery],
    touches: [contactDomain],
  },
  handler() {
    return { ok: true };
  },
});

const signIn = mutation('mutations/sign-in', {
  access: publicAccess('derived invalidates fixture'),
  csrf: false,
  csrfJustification: 'non-browser regression fixture',
  input: s.object({ email: s.string() }),
  optimistic: { 'queries/auth-session-query': 'await-fragment' },
  registry: {
    queries: [authQuery],
    touches: [authDomain],
  },
  handler() {
    return { ok: true };
  },
});

export default createApp({
  liveTargetRenderers: [
    {
      component: 'contacts/detail',
      queryDefinitions: [contactDetailQuery],
      render: () => trustedHtml('<section>Contact</section>', 'derived invalidates fixture'),
    },
  ],
  mutations: [updateContact, signIn],
  queries: [contactsQuery, contactDetailQuery, authQuery],
  routes: [
    route('/contacts', {
      access: publicAccess('derived invalidates fixture'),
      page: () => trustedHtml('<main>Contacts</main>', 'derived invalidates fixture'),
    }),
  ],
});
`,
        'utf8',
      );

      const exitCode = await withCwd(root, () =>
        mainAsync(['build', './app.mjs', '--out', './dist']),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);

      const graphPath = join(outDir, '.kovo/graph.json');
      const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as {
        mutations: { invalidates?: string[]; key: string }[];
      };
      expect(
        graph.mutations.find((mutation) => mutation.key === 'mutations/update-contact')
          ?.invalidates,
      ).toEqual(['queries/contact-detail-query', 'queries/contacts-query']);
      expect(
        graph.mutations.find((mutation) => mutation.key === 'mutations/sign-in')?.invalidates,
      ).toEqual(['queries/auth-session-query']);

      stdout.mockClear();
      expect(
        main(['explain', 'mutation', 'mutations/update-contact', '--optimistic', graphPath]),
      ).toBe(0);
      const explainOutput = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(explainOutput).toContain(
        'invalidates: queries/contact-detail-query,queries/contacts-query',
      );
      expect(explainOutput).toContain('OPTIMISTIC queries/contact-detail-query await-fragment');
      expect(explainOutput).not.toContain('queries/auth-session-query');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('runs Drizzle security extractors before artifact emission', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-security-preflight-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeClientEntry(root);
      writeFileSync(appPath, securityPreflightAppModuleSource(), 'utf8');
      writeSecurityPreflightStaticSources(root);

      const exitCode = await withCwd(root, () =>
        mainAsync(['build', './app.mjs', '--out', './dist']),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(errorOutput).toContain('kovo build check preflight failed');
      expect(errorOutput).toContain('ERROR KV414 QUERY accountById');
      expect(errorOutput).toContain('ERROR KV438 WRITE updateRole');
      expect(errorOutput).toContain('ERROR KV433 QUERY badRead');
      expect(errorOutput).toContain('ERROR KV429 WRITE decrementStock');
      expect(existsSync(outDir)).toBe(false);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  }, 90_000);

  it('surfaces fatal optimistic coverage gaps as build errors', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-fatal-kv310-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeClientEntry(root);
      writeFileSync(appPath, fatalOptimisticCoverageAppModuleSource(), 'utf8');

      const exitCode = await withCwd(root, () =>
        mainAsync(['build', './app.mjs', '--out', './dist']),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(errorOutput).toContain('ERROR BUILD_FATAL KV310 cart/add -> cart');
      expect(errorOutput).toContain('WARN KV310 cart/add -> cart');
      expect(existsSync(outDir)).toBe(false);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('passes check preflight for the framework storage download endpoint', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-storage-download-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeClientEntry(root);
      writeFileSync(
        appPath,
        `
import {
  createApp,
  createMemoryStorage,
  createStorageDownloadEndpoint,
} from '@kovojs/server';

const storage = createMemoryStorage();
const download = createStorageDownloadEndpoint({
  secret: '0123456789abcdef0123456789abcdef',
  storage,
});

export default createApp({ endpoints: [download] });
`,
        'utf8',
      );

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(errorOutput).not.toContain('KV423');
      expect(errorOutput).not.toContain('KV436');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('serializes webhook build facts with webhook surface and verifier auth', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-webhook-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeClientEntry(root);
      writeFileSync(
        appPath,
        `
import { createApp, domain, hmacSignature, s, webhook } from '@kovojs/server';

const payment = domain('payment');

const paymentWebhook = webhook('payment', {
  handler() {
    return { ok: true };
  },
  input: s.object({ id: s.string() }),
  path: '/webhooks/payment',
  verify: hmacSignature({
    encoding: 'hex',
    header: 'x-signature',
    payload: (request) => request.payload,
    scheme: 'hmac-sha256:hex',
    secret: 'whsec_test',
  }),
  writes: [payment],
});

export default createApp({ endpoints: [paymentWebhook] });
`,
        'utf8',
      );

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(errorOutput).not.toContain('KV423');
      expect(errorOutput).not.toContain('KV436');
      const graph = JSON.parse(readFileSync(join(outDir, '.kovo/graph.json'), 'utf8')) as {
        endpoints?: { name?: string; writes?: string[] }[];
      };
      expect(graph.endpoints).toContainEqual(
        expect.objectContaining({ name: 'payment', writes: ['payment'] }),
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('excludes adjacent test fixtures from the production build graph preflight', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-test-source-filter-'));
    const appPath = join(root, 'src/app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeClientEntry(root);
      writeFileSync(
        appPath,
        `
import { createApp, publicAccess, route } from '@kovojs/server';

export default createApp({
  routes: [
    route('/', {
      access: publicAccess('build source filter fixture'),
      page: () => '<main>Home</main>',
    }),
  ],
});
`,
        'utf8',
      );
      writeFileSync(
        join(root, 'src/app.test.ts'),
        `
declare const db: { execute(sql: string): Promise<void> };
await db.execute('delete from production_data');
`,
        'utf8',
      );
      writeFileSync(
        join(root, 'src/app-test-helpers.ts'),
        `
declare const db: { execute(sql: string): Promise<void> };
export async function resetFixture() {
  await db.execute('delete from production_data');
}
`,
        'utf8',
      );

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(errorOutput).not.toContain('KV406');
      expect(errorOutput).not.toContain('KV422');
      expect(existsSync(join(outDir, 'server/server.mjs'))).toBe(true);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not bind a shared HMR websocket port during concurrent builds', async () => {
    const rootParent = mkdtempSync(join(repoRoot, '.tmp-kovo-build-parallel-'));
    const rootA = join(rootParent, 'a');
    const rootB = join(rootParent, 'b');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(rootParent, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(
        join(repoRoot, 'packages/server'),
        join(rootParent, 'node_modules/@kovojs/server'),
      );
      writeRetentionProofConfig(rootParent);
      for (const root of [rootA, rootB]) {
        const appPath = join(root, 'app.mjs');
        mkdirSync(root, { recursive: true });
        mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
        symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
        symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
        writeFileSync(appPath, appModuleSource(), 'utf8');
        writeClientEntry(root);
      }

      const [exitA, exitB] = await withCwd(rootParent, () =>
        Promise.all([
          mainAsync(['build', './a/app.mjs', '--out', './a/dist']),
          mainAsync(['build', './b/app.mjs', '--out', './b/dist']),
        ]),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(exitA, errorOutput).toBe(0);
      expect(exitB, errorOutput).toBe(0);
      expect(errorOutput).not.toContain('WebSocket server error');
      expect(errorOutput).not.toContain('24678');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(rootParent, { force: true, recursive: true });
    }
  });

  it('auto-collects compiled component CSS into the build stylesheet asset', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-app-css-'));
    const appPath = join(root, 'app.tsx');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/core'), join(root, 'node_modules/@kovojs/core'));
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      symlinkSync(join(repoRoot, 'packages/style'), join(root, 'node_modules/@kovojs/style'));
      writeReactJsxRuntimeStub(root);
      writeFileSync(appPath, staticStylesheetRouteComponentAppModuleSource(), 'utf8');
      writeStyledComponentClientEntry(root);

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();

      expect(() => neutralClientAsset(outDir, (href) => href === '/assets/styles.css')).toThrow(
        /Expected neutral client asset/,
      );
      const routeCss = neutralClientAsset(outDir, (href) =>
        /^\/assets\/routes\/index-[a-f0-9]{8}\.css$/.test(href),
      );
      expect(readFileSync(routeCss.filePath, 'utf8')).toContain('auto-css-card');
      const routeDocument = readFileSync(join(outDir, '.kovo/static/index.html'), 'utf8');
      expect(routeDocument).toContain(`data-kovo-critical-href="${routeCss.href}"`);
      expect(routeDocument).toContain(`<link rel="stylesheet" href="${routeCss.href}">`);
      const viteStylesheetPath = builtAssetPath(outDir, (assetPath) => assetPath.endsWith('.css'));
      expect(readFileSync(join(outDir, '.kovo/client', viteStylesheetPath), 'utf8')).toContain(
        'main{color:#639}',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('links only reachable build CSS chunks for each static route', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-route-css-'));
    const appPath = join(root, 'app.tsx');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/core'), join(root, 'node_modules/@kovojs/core'));
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      symlinkSync(join(repoRoot, 'packages/style'), join(root, 'node_modules/@kovojs/style'));
      writeReactJsxRuntimeStub(root);
      writeFileSync(appPath, splitStylesheetRouteAppModuleSource(), 'utf8');
      writeSplitStyledComponentClientEntry(root);

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();

      const baseCss = neutralClientAsset(outDir, (href) =>
        /^\/assets\/base-[a-f0-9]{8}\.css$/.test(href),
      );
      const homeCss = neutralClientAsset(outDir, (href) =>
        /^\/assets\/routes\/index-[a-f0-9]{8}\.css$/.test(href),
      );
      const loginCss = neutralClientAsset(outDir, (href) =>
        /^\/assets\/routes\/login-[a-f0-9]{8}\.css$/.test(href),
      );
      const homeFragmentCss = neutralClientAsset(outDir, (href) =>
        /^\/assets\/fragments\/home-panel-home-panel-[a-f0-9]{8}\.css$/.test(href),
      );
      expect(readFileSync(baseCss.filePath, 'utf8')).toContain('shared-card');
      expect(readFileSync(homeCss.filePath, 'utf8')).toContain('home-panel');
      expect(readFileSync(loginCss.filePath, 'utf8')).toContain('login-panel');
      expect(readFileSync(homeFragmentCss.filePath, 'utf8')).toContain('home-panel');
      expect(() => neutralClientAsset(outDir, (href) => href === '/assets/styles.css')).toThrow(
        /Expected neutral client asset/,
      );
      const baseCssBytes = readFileSync(baseCss.filePath).byteLength;
      const homeCssBytes = readFileSync(homeCss.filePath).byteLength;
      const loginCssBytes = readFileSync(loginCss.filePath).byteLength;
      const baseCriticalCssBytes = criticalCssBytes(baseCss.filePath);
      const homeCriticalCssBytes = criticalCssBytes(homeCss.filePath);
      const loginCriticalCssBytes = criticalCssBytes(loginCss.filePath);
      const allPageCssBytes = baseCssBytes + homeCssBytes + loginCssBytes;
      const homeRouteCssBytes = baseCssBytes + homeCssBytes;
      const loginRouteCssBytes = baseCssBytes + loginCssBytes;
      const homeRouteCriticalCssBytes = baseCriticalCssBytes + homeCriticalCssBytes;
      const loginRouteCriticalCssBytes = baseCriticalCssBytes + loginCriticalCssBytes;
      expect(homeRouteCssBytes).toBeLessThan(allPageCssBytes);
      expect(loginRouteCssBytes).toBeLessThan(allPageCssBytes);
      const homeDocument = readFileSync(join(outDir, '.kovo/static/index.html'), 'utf8');
      expect(homeDocument).toContain(baseCss.href);
      expect(homeDocument).toContain(homeCss.href);
      expect(homeDocument).not.toContain(loginCss.href);
      expect(homeDocument).toContain(`data-kovo-critical-href="${baseCss.href}"`);
      expect(homeDocument).toContain(`data-kovo-critical-href="${homeCss.href}"`);
      expect(homeDocument).not.toContain(`data-kovo-critical-href="${loginCss.href}"`);
      expect(homeDocument).toContain(`<link rel="stylesheet" href="${baseCss.href}">`);
      expect(homeDocument).toContain(`<link rel="stylesheet" href="${homeCss.href}">`);
      expect(inlinedCriticalCssBytes(homeDocument)).toBe(homeRouteCriticalCssBytes);
      const loginDocument = readFileSync(join(outDir, '.kovo/static/login/index.html'), 'utf8');
      expect(loginDocument).toContain(baseCss.href);
      expect(loginDocument).toContain(loginCss.href);
      expect(loginDocument).not.toContain(homeCss.href);
      expect(loginDocument).toContain(`data-kovo-critical-href="${baseCss.href}"`);
      expect(loginDocument).toContain(`data-kovo-critical-href="${loginCss.href}"`);
      expect(loginDocument).not.toContain(`data-kovo-critical-href="${homeCss.href}"`);
      expect(loginDocument).toContain(`<link rel="stylesheet" href="${baseCss.href}">`);
      expect(loginDocument).toContain(`<link rel="stylesheet" href="${loginCss.href}">`);
      expect(inlinedCriticalCssBytes(loginDocument)).toBe(loginRouteCriticalCssBytes);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('serves byte-identical route CSS hints in dev, built node, and static export', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-css-parity-'));
    const appPath = join(root, 'src/app-shell.tsx');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/core'), join(root, 'node_modules/@kovojs/core'));
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      symlinkSync(join(repoRoot, 'packages/style'), join(root, 'node_modules/@kovojs/style'));
      writeReactJsxRuntimeStub(root);
      writeSplitStyleCreateComponentClientEntry(root);
      writeFileSync(appPath, splitSrcStylesheetRouteAppModuleSource(), 'utf8');

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();

      const staticDocument = readFileSync(join(outDir, '.kovo/static/index.html'), 'utf8');
      const serverModule = (await import(
        `${pathToFileURL(join(outDir, 'server/server.mjs')).href}?t=${Date.now()}`
      )) as {
        createKovoNodeServer(): Server;
      };
      const builtServer = serverModule.createKovoNodeServer();
      const builtOrigin = await listen(builtServer);

      let builtDocument: string;
      try {
        const builtResponse = await fetch(`${builtOrigin}/`);
        builtDocument = await builtResponse.text();
        expect(builtResponse.status, builtDocument).toBe(200);
      } finally {
        await close(builtServer);
      }

      const devDocument = await devRouteDocument(root, appPath);
      const staticSignature = routeCssSignature(staticDocument);

      expect(routeCssSignature(builtDocument)).toEqual(staticSignature);
      expect(routeCssSignature(devDocument)).toEqual(staticSignature);
      expect(staticSignature.links).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^\/assets\/base-[a-f0-9]{8}\.css$/),
          expect.stringMatching(/^\/assets\/routes\/index-[a-f0-9]{8}\.css$/),
        ]),
      );
      expect(staticSignature.links).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/\/assets\/routes\/login-/)]),
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps structured document style.create CSS in the shared build stylesheet', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-document-css-'));
    const appPath = join(root, 'app.tsx');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/core'), join(root, 'node_modules/@kovojs/core'));
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      symlinkSync(join(repoRoot, 'packages/style'), join(root, 'node_modules/@kovojs/style'));
      writeReactJsxRuntimeStub(root);
      writeFileSync(appPath, documentShellRouteSplitAppModuleSource(), 'utf8');
      writeDocumentShellTemplate(root);
      writeSplitStyleCreateComponentClientEntry(root);

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();

      const baseCssAssets = neutralClientAssets(outDir, (href) =>
        /^\/assets\/base-[a-f0-9]{8}\.css$/.test(href),
      );
      const baseCss = baseCssAssets.find((asset) =>
        readFileSync(asset.filePath, 'utf8').includes('kv-document-search-'),
      );
      expect(baseCss).toBeDefined();
      const baseCssText = readFileSync(baseCss!.filePath, 'utf8');
      expect(baseCssText).toContain('kv-document-search-bg-');
      expect(baseCssText).toContain('background-color:white');

      const homeDocument = readFileSync(join(outDir, '.kovo/static/index.html'), 'utf8');
      expect(homeDocument).toContain('id="search"');
      expect(homeDocument).toContain('kv-document-search-bg-');
      expect(homeDocument).toContain(`<link rel="stylesheet" href="${baseCss!.href}">`);
      expect(homeDocument).toContain(`data-kovo-critical-href="${baseCss!.href}"`);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('references build fragment CSS chunks from enhanced mutation live targets', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-fragment-css-'));
    const appPath = join(root, 'app.tsx');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/core'), join(root, 'node_modules/@kovojs/core'));
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      symlinkSync(join(repoRoot, 'packages/style'), join(root, 'node_modules/@kovojs/style'));
      writeReactJsxRuntimeStub(root);
      writeFileSync(appPath, mutationFragmentStylesheetAppModuleSource(), 'utf8');
      writeSplitStyledComponentClientEntry(root);

      const exitCode = await mainAsync(['build', appPath, '--out', outDir]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();

      const baseCss = neutralClientAsset(outDir, (href) =>
        /^\/assets\/base-[a-f0-9]{8}\.css$/.test(href),
      );
      const homeCss = neutralClientAsset(outDir, (href) =>
        /^\/assets\/routes\/index-[a-f0-9]{8}\.css$/.test(href),
      );
      const loginCss = neutralClientAsset(outDir, (href) =>
        /^\/assets\/routes\/login-[a-f0-9]{8}\.css$/.test(href),
      );
      const homeFragmentCss = neutralClientAsset(outDir, (href) =>
        /^\/assets\/fragments\/home-panel-home-panel-[a-f0-9]{8}\.css$/.test(href),
      );

      const serverModule = (await import(
        `${pathToFileURL(join(outDir, 'server/server.mjs')).href}?t=${Date.now()}`
      )) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const origin = await listen(server);

      try {
        const homePanelLiveTarget = await homePanelLiveTargetHeader(origin);
        const loginMutationResponse = await fetch(`${origin}/_m/home/touch`, {
          body: new URLSearchParams(),
          headers: {
            'Kovo-Fragment': 'true',
            'Kovo-Live-Targets': homePanelLiveTarget,
            'Kovo-Targets': 'home-panel=home',
            Referer: `${origin}/login`,
          },
          method: 'POST',
        });
        const loginMutationBody = await loginMutationResponse.text();
        expect(loginMutationResponse.status, loginMutationBody).toBe(200);
        expect(loginMutationBody).toContain(`<link rel="stylesheet" href="${baseCss.href}">`);
        expect(loginMutationBody).toContain(`<link rel="stylesheet" href="${loginCss.href}">`);
        expect(loginMutationBody).toContain(
          `<link rel="stylesheet" href="${homeFragmentCss.href}">`,
        );
        expect(loginMutationBody).not.toContain(homeCss.href);

        const homeMutationResponse = await fetch(`${origin}/_m/home/touch`, {
          body: new URLSearchParams(),
          headers: {
            'Kovo-Fragment': 'true',
            'Kovo-Live-Targets': homePanelLiveTarget,
            'Kovo-Targets': 'home-panel=home',
            Referer: `${origin}/`,
          },
          method: 'POST',
        });
        const homeMutationBody = await homeMutationResponse.text();
        expect(homeMutationResponse.status, homeMutationBody).toBe(200);
        expect(homeMutationBody).toContain(`<link rel="stylesheet" href="${baseCss.href}">`);
        expect(homeMutationBody).toContain(`<link rel="stylesheet" href="${homeCss.href}">`);
        expect(homeMutationBody).not.toContain(homeFragmentCss.href);
        expect(homeMutationBody).not.toContain(loginCss.href);
      } finally {
        await close(server);
      }
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('boots emitted node preset output from production dependencies with dev-package guards', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-prod-deps-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const runtimeDir = join(root, 'runtime');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeFileSync(appPath, appModuleSource(), 'utf8');
      writeClientEntry(root);
      writeRetentionProofConfig(root);

      const exitCode = await withCwd(root, () =>
        mainAsync(['build', './app.mjs', '--out', './dist']),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();

      cpSync(join(outDir, 'server'), runtimeDir, { recursive: true });
      writeProductionOnlyRuntimeNodeModules(runtimeDir);

      const handlerSource = readFileSync(join(runtimeDir, 'server/handler.mjs'), 'utf8');
      expect(handlerSource).not.toContain('vite');
      expect(handlerSource).not.toContain("require('undici')");
      expect(handlerSource).not.toContain('require("undici")');
      expect(handlerSource).not.toMatch(
        /createRequire\([^)]*import\.meta\.url[^)]*\)\(["']undici["']\)/,
      );

      const serverModule = (await import(
        `${pathToFileURL(join(runtimeDir, 'server.mjs')).href}?t=${Date.now()}`
      )) as {
        createKovoNodeServer(): Server;
      };
      const server = serverModule.createKovoNodeServer();
      const origin = await listen(server);

      try {
        const document = await fetch(`${origin}/cart`);
        await expect(document.text()).resolves.toContain('<main>Cart 0</main>');
        expect(document.status).toBe(200);

        const mutationResponse = await fetch(`${origin}/_m/cart/add`, {
          body: new URLSearchParams({ quantity: '3' }),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          method: 'POST',
          redirect: 'manual',
        });
        expect(mutationResponse.status).toBe(303);

        const updatedDocument = await fetch(`${origin}/cart`);
        await expect(updatedDocument.text()).resolves.toContain('<main>Cart 3</main>');
        expect(updatedDocument.status).toBe(200);

        const clientModuleResponse = await fetch(`${origin}/c/__v/cart-v1/cart.client.js`);
        await expect(clientModuleResponse.text()).resolves.toBe('export const cartClient = true;');
        expect(clientModuleResponse.status).toBe(200);
        expect(clientModuleResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );

        const stylesheetPath = builtAssetPath(outDir, (assetPath) => assetPath.endsWith('.css'));
        const assetResponse = await fetch(`${origin}${stylesheetPath}`);
        await expect(assetResponse.text()).resolves.toContain('color:#639');
        expect(assetResponse.status).toBe(200);
        expect(assetResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
        expect(assetResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
      } finally {
        await close(server);
      }
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  dockerIt(
    'builds and runs the generated node Dockerfile without node_modules in the output',
    async () => {
      const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-docker-'));
      const appPath = join(root, 'app.mjs');
      const outDir = join(root, 'dist');
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      let containerId: string | undefined;
      let imageId: string | undefined;

      try {
        mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
        symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
        symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
        writeFileSync(appPath, appModuleSource(), 'utf8');
        writeClientEntry(root);
        writeRetentionProofConfig(root);

        const exitCode = await withCwd(root, () =>
          mainAsync(['build', './app.mjs', '--out', './dist']),
        );
        const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(exitCode, errorOutput).toBe(0);
        expect(stderr).not.toHaveBeenCalled();
        expect(existsSync(join(outDir, 'server/Dockerfile'))).toBe(true);
        expect(existsSync(join(outDir, 'server/node_modules'))).toBe(false);

        imageId = dockerOutput(['build', '-q', join(outDir, 'server')])
          .trim()
          .split('\n')
          .at(-1);
        if (!imageId) throw new Error('Docker build did not return an image id.');
        containerId = dockerOutput(['run', '--rm', '-d', '-p', '127.0.0.1::3000', imageId]).trim();
        const origin = await dockerContainerOrigin(containerId);
        await waitForDockerRoute(origin);

        const document = await fetch(`${origin}/cart`);
        await expect(document.text()).resolves.toContain('<main>Cart 0</main>');
        expect(document.status).toBe(200);

        const mutationResponse = await fetch(`${origin}/_m/cart/add`, {
          body: new URLSearchParams({ quantity: '5' }),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          method: 'POST',
          redirect: 'manual',
        });
        expect(mutationResponse.status).toBe(303);

        const updatedDocument = await fetch(`${origin}/cart`);
        await expect(updatedDocument.text()).resolves.toContain('<main>Cart 5</main>');
        expect(updatedDocument.status).toBe(200);

        const clientModuleResponse = await fetch(`${origin}/c/__v/cart-v1/cart.client.js`);
        await expect(clientModuleResponse.text()).resolves.toBe('export const cartClient = true;');
        expect(clientModuleResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );

        const stylesheetPath = builtAssetPath(outDir, (assetPath) => assetPath.endsWith('.css'));
        const assetResponse = await fetch(`${origin}${stylesheetPath}`);
        await expect(assetResponse.text()).resolves.toContain('color:#639');
        expect(assetResponse.status).toBe(200);
        expect(assetResponse.headers.get('cache-control')).toBe(
          'public, max-age=31536000, immutable',
        );
      } finally {
        stdout.mockRestore();
        stderr.mockRestore();
        if (containerId) dockerCleanup(['rm', '-f', containerId]);
        if (imageId) dockerCleanup(['image', 'rm', '-f', imageId]);
        rmSync(root, { force: true, recursive: true });
      }
    },
    120_000,
  );

  it('loads kovo.config.ts preset before host auto-detection', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-config-'));
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeFileSync(join(root, 'app.mjs'), dynamicAppModuleSource(), 'utf8');
      writeClientEntry(root);
      writeFileSync(
        join(root, 'kovo.config.ts'),
        [
          "import { defineConfig, node } from '@kovojs/server/build';",
          'export default defineConfig({',
          '  preset: node({ dockerfile: false }),',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );

      const exitCode = await withCwd(root, () =>
        withEnv({ VERCEL: '1' }, () => mainAsync(['build', './app.mjs', '--out', './dist'])),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        'SUMMARY preset=node',
      );
      expect(() => readFileSync(join(outDir, 'server/Dockerfile'), 'utf8')).toThrow();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('passes inferred DATABASE_URL env to configured presets', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-config-env-'));
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeFileSync(join(root, 'app.mjs'), databaseEnvAppModuleSource(), 'utf8');
      writeClientEntry(root);
      writeFileSync(
        join(root, 'kovo.config.ts'),
        [
          "import { mkdir, writeFile } from 'node:fs/promises';",
          "import { defineConfig } from '@kovojs/server/build';",
          'export default defineConfig({',
          '  preset: {',
          "    name: 'node',",
          '    async emit(_build, context) {',
          '      await mkdir(context.outDir, { recursive: true });',
          "      await writeFile(context.outDir + '/declared-env.txt', context.declaredEnv.join(','), 'utf8');",
          '    },',
          '    inspect(_build, context) {',
          '      return [{',
          "        code: 'test-declared-env',",
          "        message: 'declared=' + context.declaredEnv.join(','),",
          "        severity: 'warning',",
          '      }];',
          '    },',
          '  },',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );

      const exitCode = await withCwd(root, () =>
        mainAsync(['build', './app.mjs', '--out', './dist']),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('WARN test-declared-env declared=DATABASE_URL');
      expect(readFileSync(join(outDir, 'server/declared-env.txt'), 'utf8')).toBe('DATABASE_URL');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('auto-detects Vercel and emits Build Output API files', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-vercel-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeFileSync(appPath, dynamicAppModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await withEnv({ VERCEL: '1' }, () =>
        mainAsync(['build', appPath, '--out', outDir]),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('SUMMARY preset=vercel');
      expect(output).toContain(`serverOutDir=${JSON.stringify(join(outDir, '.vercel/output'))}`);
      expect(readBuildJson(join(outDir, '.vercel/output/config.json'))).toEqual({
        routes: [
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/(?:assets|c)/(.*)',
          },
          {
            continue: true,
            headers: {
              'cross-origin-opener-policy': 'same-origin-allow-popups',
              'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
              'referrer-policy': 'strict-origin-when-cross-origin',
              'x-content-type-options': 'nosniff',
              'x-frame-options': 'DENY',
            },
            src: '/(.*)',
          },
          { handle: 'filesystem' },
          { dest: '/kovo', src: '/(.*)' },
        ],
        version: 3,
      });
      expect(
        readBuildJson(join(outDir, '.vercel/output/functions/kovo.func/.vc-config.json')),
      ).toEqual({
        handler: 'index.cjs',
        launcherType: 'Nodejs',
        runtime: 'nodejs22.x',
        shouldAddHelpers: true,
      });
      const stylesheetPath = builtAssetPath(outDir, (assetPath) => assetPath.endsWith('.css'));
      expect(
        readFileSync(join(outDir, '.vercel/output/static', stylesheetPath.slice(1)), 'utf8'),
      ).toContain('color:#639');
      expect(
        readFileSync(join(outDir, '.vercel/output/functions/kovo.func/handler.mjs'), 'utf8'),
      ).not.toContain('vite');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('auto-detects Vercel and emits pure static output for static-only apps', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-vercel-static-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeFileSync(appPath, staticAppModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await withEnv({ VERCEL: '1' }, () =>
        mainAsync(['build', appPath, '--out', outDir]),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('SUMMARY preset=vercel');
      expect(readBuildJson(join(outDir, '.kovo/meta.json'))).toMatchObject({ staticOnly: true });
      expect(readFileSync(join(outDir, '.vercel/output/static/index.html'), 'utf8')).toContain(
        '<main>Static Home</main>',
      );
      expect(existsSync(join(outDir, '.vercel/output/functions/kovo.func/index.cjs'))).toBe(false);
      expect(readBuildJson(join(outDir, '.vercel/output/config.json'))).toEqual({
        routes: [
          {
            continue: true,
            headers: {
              'cache-control': 'public, max-age=31536000, immutable',
              'cross-origin-resource-policy': 'same-origin',
              'x-content-type-options': 'nosniff',
            },
            src: '/(?:assets|c)/(.*)',
          },
          {
            continue: true,
            headers: {
              'cross-origin-opener-policy': 'same-origin-allow-popups',
              'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
              'referrer-policy': 'strict-origin-when-cross-origin',
              'x-content-type-options': 'nosniff',
              'x-frame-options': 'DENY',
            },
            src: '/(.*)',
          },
          { handle: 'filesystem' },
        ],
        version: 3,
      });
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('uses KOVO_PRESET before host auto-detection', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-cloudflare-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeFileSync(appPath, dynamicAppModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await withEnv({ KOVO_PRESET: 'cloudflare', VERCEL: '1' }, () =>
        mainAsync(['build', appPath, '--out', outDir]),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('SUMMARY preset=cloudflare');
      expect(output).toContain(`serverOutDir=${JSON.stringify(join(outDir, 'cloudflare'))}`);
      expect(readFileSync(join(outDir, 'cloudflare/wrangler.toml'), 'utf8')).toContain(
        'compatibility_flags = ["nodejs_compat"]',
      );
      expect(readFileSync(join(outDir, 'cloudflare/worker.mjs'), 'utf8')).toContain(
        "import handler from './server/handler.mjs';",
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('auto-detects Cloudflare Pages and emits Wrangler output', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-cloudflare-auto-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeFileSync(appPath, dynamicAppModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await withEnv({ CF_PAGES: '1' }, () =>
        mainAsync(['build', appPath, '--out', outDir]),
      );
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        'SUMMARY preset=cloudflare',
      );
      expect(readFileSync(join(outDir, 'cloudflare/wrangler.toml'), 'utf8')).toContain(
        'run_worker_first = true',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('prints Cloudflare database guidance when the bundle references DATABASE_URL', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-cloudflare-db-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeFileSync(appPath, databaseEnvAppModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await mainAsync([
        'build',
        appPath,
        '--out',
        outDir,
        '--preset',
        'cloudflare',
      ]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(exitCode, errorOutput).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain(
        'WARN cloudflare-tcp-database The cloudflare preset emits a Worker with nodejs_compat.',
      );
      expect(output).toContain('SUMMARY preset=cloudflare');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails Cloudflare builds that import unsupported Node runtime APIs', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-cloudflare-blocked-api-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
      writeFileSync(appPath, blockedCloudflareApiAppModuleSource(), 'utf8');
      writeClientEntry(root);

      const exitCode = await mainAsync([
        'build',
        appPath,
        '--out',
        outDir,
        '--preset',
        'cloudflare',
      ]);
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');

      expect(exitCode).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(errorOutput).toContain('ERROR cloudflare-unsupported-node-api');
      expect(existsSync(join(outDir, 'cloudflare/worker.mjs'))).toBe(false);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function appModuleSource(): string {
  return `
import {
  createApp,
  createMemoryVersionedClientModuleRegistry,
  domain,
  mutation,
  query,
  route,
  s,
} from '@kovojs/server';

import { trustedHtml } from '@kovojs/browser';

const cart = domain('cart');
const db = { count: 0 };
const clientModules = createMemoryVersionedClientModuleRegistry();
clientModules.put({
  path: '/c/cart.client.js',
  source: 'export const cartClient = true;',
  version: 'cart-v1',
});
const cartQuery = query('cart', {
  access: { kind: 'public', reason: 'build fixture query' },
  load: () => ({ count: db.count }),
  reads: [cart],
});
const addToCart = mutation('cart/add', {
  access: { kind: 'public', reason: 'build fixture mutation' },
  csrf: false,
  input: s.object({ quantity: s.number().int().min(1).default(1) }),
  optimistic: { cart: 'await-fragment' },
  registry: {
    queries: [cartQuery],
    touches: [cart],
  },
  handler(input) {
    db.count += input.quantity;
    return { count: db.count };
  },
});

export default createApp({
  clientModules,
  mutations: [addToCart],
  queries: [cartQuery],
  routes: [
    route('/cart', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => trustedHtml('<main>Cart ') + db.count + '</main>',
    }),
  ],
});
`;
}

async function homePanelLiveTargetHeader(origin: string): Promise<string> {
  const response = await fetch(`${origin}/__test/home-live-target`);
  const html = await response.text();
  const match = /<code id="home-live-target">([^<]+)<\/code>/.exec(html);
  if (!match?.[1]) throw new Error(`Expected test live-target header in ${html.slice(-800)}`);
  return match[1];
}

function dynamicAppModuleSource(): string {
  return `
import {
  createApp,
  domain,
  mutation,
  query,
  route,
  s,
} from '@kovojs/server';

import { trustedHtml } from '@kovojs/browser';

const cart = domain('cart');
const db = { count: 0 };
const cartQuery = query('cart', {
  access: { kind: 'public', reason: 'build fixture query' },
  load: () => ({ count: db.count }),
  reads: [cart],
});
const addToCart = mutation('cart/add', {
  access: { kind: 'public', reason: 'build fixture mutation' },
  csrf: false,
  input: s.object({ quantity: s.number().int().min(1).default(1) }),
  optimistic: { cart: 'await-fragment' },
  registry: {
    queries: [cartQuery],
    touches: [cart],
  },
  handler(input) {
    db.count += input.quantity;
    return { count: db.count };
  },
});

export default createApp({
  mutations: [addToCart],
  queries: [cartQuery],
  routes: [
    route('/cart', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => trustedHtml('<main>Cart ') + db.count + '</main>',
    }),
  ],
});
`;
}

function writeRetentionProofConfig(root: string): void {
  writeFileSync(
    join(root, 'kovo.config.ts'),
    [
      "import { defineConfig, node } from '@kovojs/server/build';",
      'const base = node();',
      'export default defineConfig({',
      '  preset: {',
      "    name: 'node',",
      '    emit(build, context) {',
      '      return base.emit?.(build, context);',
      '    },',
      '    inspect() {',
      '      return [];',
      '    },',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
}

function staticAppModuleSource(): string {
  return `
import { createApp, route } from '@kovojs/server';

import { trustedHtml } from '@kovojs/browser';

export default createApp({
  routes: [
    route('/', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => trustedHtml('<main>Static Home</main>'),
    }),
  ],
});
`;
}

function staticStylesheetRouteComponentAppModuleSource(): string {
  return `
/** @jsxImportSource @kovojs/server */
import { createApp, route, stylesheet } from '@kovojs/server';
import { AutoCssCard } from './src/auto-css-card.js';

export default createApp({
  routes: [
    route('/', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => <AutoCssCard />,
    }),
  ],
  stylesheets: [stylesheet('./styles.css')],
});
`;
}

function splitStylesheetRouteAppModuleSource(): string {
  return `
/** @jsxImportSource @kovojs/server */
import { createApp, route, stylesheet } from '@kovojs/server';
import { HomePanel } from './src/home-panel.js';
import { LoginPanel } from './src/login-panel.js';
import { SharedCard } from './src/shared-card.js';

export default createApp({
  routes: [
    route('/', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => <main><SharedCard /><HomePanel /></main>,
    }),
    route('/login', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => <main><SharedCard /><LoginPanel /></main>,
    }),
  ],
  stylesheets: [stylesheet('./styles.css')],
});
`;
}

function documentShellRouteSplitAppModuleSource(): string {
  return `
/** @jsxImportSource @kovojs/server */
import { createApp, route, stylesheet } from '@kovojs/server';
import { HomePanel } from './src/home-panel.js';
import { LoginPanel } from './src/login-panel.js';
import { SharedCard } from './src/shared-card.js';
import { siteDocument } from './document-template.js';

export default createApp({
  document: siteDocument,
  routes: [
    route('/', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => <main><SharedCard /><HomePanel /></main>,
    }),
    route('/login', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => <main><SharedCard /><LoginPanel /></main>,
    }),
  ],
  stylesheets: [stylesheet('./styles.css')],
});
`;
}

function splitSrcStylesheetRouteAppModuleSource(): string {
  return `
/** @jsxImportSource @kovojs/server */
import { createApp, route, stylesheet } from '@kovojs/server';
import { HomePanel } from './home-panel.js';
import { LoginPanel } from './login-panel.js';
import { SharedCard } from './shared-card.js';

export default createApp({
  routes: [
    route('/', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => <><SharedCard /><HomePanel /></>,
    }),
    route('/login', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => <><SharedCard /><LoginPanel /></>,
    }),
  ],
  stylesheets: [stylesheet('./styles.css')],
});
`;
}

function mutationFragmentStylesheetAppModuleSource(): string {
  return `
/** @jsxImportSource @kovojs/server */
import { createApp, domain, mutation, query, route, s, stylesheet } from '@kovojs/server';
import { createLiveTargetAttestation } from '@kovojs/server/internal/wire';
import { HomePanel } from './src/home-panel.js';
import { LoginPanel } from './src/login-panel.js';
import { SharedCard } from './src/shared-card.js';

import { trustedHtml } from '@kovojs/browser';

function homeLiveTargetHeader() {
  const target = 'home-panel';
  const component = 'home-panel/home-panel';
  const props = {};
  const token = createLiveTargetAttestation({ component, props, target }, { request: {} });
  return target + '#' + component + '@' + token + ':' + JSON.stringify(props);
}

const home = domain('home');
const homeQuery = query('home', {
  access: { kind: 'public', reason: 'build fixture query' },
  load: () => ({ ok: true }),
  reads: [home],
});
const touchHome = mutation('home/touch', {
  access: { kind: 'public', reason: 'build fixture mutation' },
  csrf: false,
  input: s.object({}),
  optimistic: { home: 'await-fragment' },
  registry: {
    queries: [homeQuery],
    touches: [home],
  },
  handler() {
    return {};
  },
});

export default createApp({
  liveTargetRenderers: [
    {
      component: 'home-panel/home-panel',
      queries: ['home'],
      render: () => trustedHtml('<home-panel>HomePanel</home-panel>'),
    },
  ],
  mutations: [touchHome],
  queries: [homeQuery],
  routes: [
    route('/', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => <main><SharedCard /><HomePanel /></main>,
    }),
    route('/__test/home-live-target', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => trustedHtml('<code id="home-live-target">' + homeLiveTargetHeader() + '</code>'),
    }),
    route('/login', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => <main><SharedCard /><LoginPanel /></main>,
    }),
  ],
  stylesheets: [stylesheet('./styles.css')],
});
`;
}

function databaseEnvAppModuleSource(): string {
  return `
import { createApp, route } from '@kovojs/server';

import { trustedHtml } from '@kovojs/browser';

export default createApp({
  routes: [
    route('/db', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => trustedHtml('<main>') + (process.env.DATABASE_URL ?? 'missing') + '</main>',
    }),
  ],
});
`;
}

function blockedCloudflareApiAppModuleSource(): string {
  return `
import { spawnSync } from 'node:child_process';
import { createApp, route } from '@kovojs/server';

export default createApp({
  routes: [
    route('/blocked', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => {
        spawnSync('true');
        return '<main>Blocked</main>';
      },
    }),
  ],
});
`;
}

function securityPreflightAppModuleSource(): string {
  return `
import { createApp, query, route, s } from '@kovojs/server';

const accountById = query('accountById', {
  access: { kind: 'public', reason: 'security preflight fixture' },
  load: (input) => ({ id: input?.id ?? 'a1' }),
  output: s.object({ id: s.string() }),
});

const badRead = query('badRead', {
  access: { kind: 'public', reason: 'security preflight fixture' },
  load: (input) => ({ id: input?.id ?? 'a1' }),
  output: s.object({ id: s.string() }),
});

export default createApp({
  queries: [accountById, badRead],
  routes: [
    route('/', {
      access: { kind: 'public', reason: 'security preflight fixture' },
      page: () => '<main>Security preflight</main>',
    }),
  ],
});
`;
}

function fatalOptimisticCoverageAppModuleSource(): string {
  return `
import { createApp, domain, mutation, query, route, s } from '@kovojs/server';

const cart = domain('cart');
const cartQuery = query('cart', {
  access: { kind: 'public', reason: 'fatal KV310 fixture' },
  load: () => ({ count: 0 }),
  reads: [cart],
});

const addToCart = mutation('cart/add', {
  access: { kind: 'public', reason: 'fatal KV310 fixture' },
  csrf: false,
  input: s.object({ quantity: s.number().default(1) }),
  registry: { touches: [cart] },
  handler: () => ({ ok: true }),
});

export default createApp({
  mutations: [addToCart],
  queries: [cartQuery],
  routes: [
    route('/', {
      access: { kind: 'public', reason: 'fatal KV310 fixture' },
      page: () => '<main>Cart</main>',
    }),
  ],
});
`;
}

function writeSecurityPreflightStaticSources(root: string): void {
  writeFileSync(
    join(root, 'schema.ts'),
    [
      'import { integer, pgTable, text } from "drizzle-orm/pg-core";',
      'import { kovo } from "@kovojs/drizzle";',
      '',
      'export const accounts = pgTable("accounts", {',
      '  id: text("id").primaryKey(),',
      '  ownerId: text("owner_id").notNull(),',
      '  role: text("role").notNull(),',
      '  stock: integer("stock").notNull(),',
      '}, kovo({ domain: "account", key: "id", owner: "ownerId", governed: ["role"], atomic: "stock" }));',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(root, 'security.ts'),
    [
      'import { eq, sql } from "drizzle-orm";',
      'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
      'import { query, s } from "@kovojs/server";',
      'import { accounts } from "./schema";',
      '',
      'export const accountById = query("accountById", {',
      '  output: s.object({ id: s.string() }),',
      '  async load(input: { id: string }, db: PgAsyncDatabase<any, any>) {',
      '    return db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, input.id));',
      '  },',
      '});',
      '',
      'export async function updateRole(',
      '  db: PgAsyncDatabase<any, any>,',
      '  input: { id: string; role: string },',
      ') {',
      '  await db.update(accounts).set({ role: input.role }).where(eq(accounts.id, input.id));',
      '}',
      '',
      'export const badRead = query("badRead", {',
      '  output: s.object({ id: s.string() }),',
      '  async load(input: { id: string }, db: PgAsyncDatabase<any, any>) {',
      '    await db.update(accounts).set({ role: "admin" }).where(eq(accounts.id, input.id));',
      '    return { id: input.id };',
      '  },',
      '});',
      '',
      'export async function decrementStock(',
      '  db: PgAsyncDatabase<any, any>,',
      '  input: { id: string; qty: number },',
      ') {',
      '  await db.update(accounts).set({ stock: sql`${accounts.stock} - ${input.qty}` }).where(eq(accounts.id, input.id));',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

function writeClientEntry(root: string): void {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><body><script type="module" src="/src/client.ts"></script></body></html>',
    'utf8',
  );
  writeFileSync(
    join(root, 'src/client.ts'),
    "import './style.css';\nexport const client = true;\n",
    'utf8',
  );
  writeFileSync(join(root, 'src/style.css'), 'main { color: rebeccapurple; }\n', 'utf8');
}

function writeStyledComponentClientEntry(root: string): void {
  writeClientEntry(root);
  writeFileSync(
    join(root, 'src/client.ts'),
    "import './style.css';\nimport './auto-css-card.tsx';\nexport const client = true;\n",
    'utf8',
  );
  writeFileSync(
    join(root, 'src/auto-css-card.tsx'),
    `
import { component } from '@kovojs/core';

export const AutoCssCard = component({
  css: \`
    auto-css-card { color: teal; }
  \`,
  render: () => <auto-css-card>Auto CSS</auto-css-card>,
});
`,
    'utf8',
  );
}

function writeSplitStyledComponentClientEntry(root: string): void {
  writeClientEntry(root);
  writeFileSync(
    join(root, 'src/client.ts'),
    [
      "import './style.css';",
      "import './home-panel.tsx';",
      "import './login-panel.tsx';",
      "import './shared-card.tsx';",
      'export const client = true;',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(root, 'src/home-panel.tsx'),
    styledHostComponentSource('HomePanel', 'home-panel', 'crimson', { queryName: 'home' }),
    'utf8',
  );
  writeFileSync(
    join(root, 'src/login-panel.tsx'),
    styledHostComponentSource('LoginPanel', 'login-panel', 'goldenrod'),
    'utf8',
  );
  writeFileSync(
    join(root, 'src/shared-card.tsx'),
    styledHostComponentSource('SharedCard', 'shared-card', 'teal'),
    'utf8',
  );
}

function writeSplitStyleCreateComponentClientEntry(root: string): void {
  writeClientEntry(root);
  writeFileSync(
    join(root, 'src/client.ts'),
    [
      "import './style.css';",
      "import './home-panel.tsx';",
      "import './login-panel.tsx';",
      "import './shared-card.tsx';",
      'export const client = true;',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(root, 'src/home-panel.tsx'),
    styleCreateHostComponentSource('HomePanel', 'home-panel', 'crimson'),
    'utf8',
  );
  writeFileSync(
    join(root, 'src/login-panel.tsx'),
    styleCreateHostComponentSource('LoginPanel', 'login-panel', 'goldenrod'),
    'utf8',
  );
  writeFileSync(
    join(root, 'src/shared-card.tsx'),
    styleCreateHostComponentSource('SharedCard', 'shared-card', 'teal'),
    'utf8',
  );
}

function writeDocumentShellTemplate(root: string): void {
  writeFileSync(
    join(root, 'document-template.tsx'),
    `
/** @jsxImportSource @kovojs/server */
import { BodyEnd, Document } from '@kovojs/server';
import * as style from '@kovojs/style';

const searchStyles = style.create(
  {
    dialog: {
      backgroundColor: 'white',
      color: 'black',
      padding: 12,
    },
  },
  { namespace: 'document-search', source: 'document-template.tsx' },
);

const searchDialogClass = style.attrs(searchStyles.dialog).class ?? '';

export const siteDocument = (
  <Document lang="en">
    <BodyEnd>
      <SearchDialog />
    </BodyEnd>
  </Document>
);

function SearchDialog(): string {
  return <dialog id="search" class={searchDialogClass}>Search</dialog>;
}
`,
    'utf8',
  );
}

function styledHostComponentSource(
  name: string,
  host: string,
  color: string,
  options: { queryName?: string } = {},
): string {
  return `
import { component } from '@kovojs/core';

${options.queryName ? `const ${options.queryName}Query = {};\n` : ''}
export const ${name} = component({
  ${options.queryName ? `queries: { ${options.queryName}: ${options.queryName}Query },` : ''}
  css: \`
    ${host} { color: ${color}; }
  \`,
  render: () => <${host}>${name}</${host}>,
});
`;
}

function styleCreateHostComponentSource(name: string, host: string, color: string): string {
  return `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const styles = style.create({
  root: {
    color: '${color}',
  },
});

export const ${name} = component({
  render: () => <${host} {...style.attrs(styles.root)}>${name}</${host}>,
});
`;
}

function writeReactJsxRuntimeStub(root: string): void {
  const reactDir = join(root, 'node_modules/react');
  mkdirSync(reactDir, { recursive: true });
  writeFileSync(
    join(reactDir, 'package.json'),
    JSON.stringify({
      exports: {
        './jsx-dev-runtime': './jsx-dev-runtime.js',
        './jsx-runtime': './jsx-runtime.js',
      },
      name: 'react',
      type: 'module',
    }),
    'utf8',
  );
  const runtime = [
    'export function jsx() { return null; }',
    'export function jsxs() { return null; }',
    'export function jsxDEV() { return null; }',
    'export const Fragment = Symbol.for("react.fragment");',
    '',
  ].join('\n');
  writeFileSync(join(reactDir, 'jsx-dev-runtime.js'), runtime, 'utf8');
  writeFileSync(join(reactDir, 'jsx-runtime.js'), runtime, 'utf8');
}

function builtAssetPath(outDir: string, predicate: (path: string) => boolean): string {
  const manifest = JSON.parse(readFileSync(join(outDir, '.kovo/manifest.json'), 'utf8')) as {
    assets?: readonly { path: string }[];
  };
  const asset = manifest.assets?.find((entry) => predicate(entry.path));
  if (!asset) throw new Error(`Expected built asset in ${outDir}`);
  return asset.path;
}

type DevMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

interface DevPluginHarness extends ReturnType<typeof kovo> {
  configureServer?(server: {
    config: { root: string };
    middlewares: { use(handler: DevMiddleware): void };
    ssrLoadModule(id: string): Promise<Record<string, unknown>>;
  }): void | Promise<void>;
}

async function devRouteDocument(root: string, appPath: string): Promise<string> {
  const plugin = kovo({
    app: `/${appPath.slice(root.length + 1).replaceAll('\\', '/')}`,
  }) as DevPluginHarness;
  const middlewares: DevMiddleware[] = [];
  await plugin.configResolved?.({ root });

  for (const fileName of ['src/home-panel.tsx', 'src/login-panel.tsx', 'src/shared-card.tsx']) {
    const absoluteFileName = join(root, fileName);
    await plugin.transform?.(readFileSync(absoluteFileName, 'utf8'), absoluteFileName);
  }

  await plugin.configureServer?.({
    config: { root },
    middlewares: {
      use(handler) {
        middlewares.push(handler as DevMiddleware);
      },
    },
    async ssrLoadModule(id) {
      if (id === '@kovojs/server/internal/app-shell-vite') {
        return (await import('@kovojs/server/internal/app-shell-vite')) as Record<string, unknown>;
      }
      expect(id).toBe(`/${appPath.slice(root.length + 1).replaceAll('\\', '/')}`);
      return {
        default: createApp({
          routes: [
            route('/', {
              page: () => renderedHtml('<main>Home</main>'),
            }),
            route('/login', {
              page: () => renderedHtml('<main>Login</main>'),
            }),
          ],
        }),
      };
    },
  });

  const server = createHttpServer((request, response) => {
    runDevMiddlewareChain(middlewares, request, response, (error) => {
      response.writeHead(error ? 500 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : 'vite fallback');
    });
  });
  const origin = await listen(server);

  try {
    const response = await fetch(`${origin}/`);
    const body = await response.text();
    expect(response.status, body).toBe(200);
    return body;
  } finally {
    await close(server);
  }
}

function runDevMiddlewareChain(
  middlewares: readonly DevMiddleware[],
  request: IncomingMessage,
  response: ServerResponse,
  done: (error?: unknown) => void,
): void {
  let index = 0;
  const next = (error?: unknown) => {
    if (error || index >= middlewares.length) {
      done(error);
      return;
    }

    middlewares[index++]?.(request, response, next);
  };
  next();
}

function routeCssSignature(document: string): {
  critical: readonly { css: string; href: string }[];
  links: readonly string[];
} {
  const isSplitChunk = (href: string) => /^\/assets\/(?:base-|routes\/|fragments\/)/.test(href);
  return {
    critical: [
      ...document.matchAll(/<style data-kovo-critical-href="([^"]+)"[^>]*>([\s\S]*?)<\/style>/g),
    ]
      .map((match) => ({ css: match[2] ?? '', href: match[1] ?? '' }))
      .filter((entry) => isSplitChunk(entry.href)),
    links: [...document.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)]
      .map((match) => match[1] ?? '')
      .filter(isSplitChunk),
  };
}

function neutralClientAsset(
  outDir: string,
  predicate: (href: string) => boolean,
): { filePath: string; href: string } {
  const [asset] = neutralClientAssets(outDir, predicate);
  if (asset) return asset;

  throw new Error(`Expected neutral client asset in ${outDir}`);
}

function neutralClientAssets(
  outDir: string,
  predicate: (href: string) => boolean,
): { filePath: string; href: string }[] {
  const clientDir = join(outDir, '.kovo/client');
  const stack = ['assets'];
  const assets: { filePath: string; href: string }[] = [];

  for (let index = 0; index < stack.length; index += 1) {
    const relativeDir = stack[index];
    if (!relativeDir) continue;
    for (const entry of readdirSync(join(clientDir, relativeDir), { withFileTypes: true })) {
      const relativePath = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        stack.push(relativePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const href = `/${relativePath}`;
      if (predicate(href)) assets.push({ filePath: join(clientDir, relativePath), href });
    }
  }

  return assets;
}

function inlinedCriticalCssBytes(document: string): number {
  return [...document.matchAll(/<style data-kovo-critical-href="[^"]+"[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1] ?? '')
    .reduce((total, css) => total + Buffer.byteLength(css, 'utf8'), 0);
}

function criticalCssBytes(filePath: string): number {
  return Buffer.byteLength(readFileSync(filePath, 'utf8').trimEnd(), 'utf8');
}

function readBuildJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function typescriptAppModuleSource(): string {
  return `
import { createApp, mutation, query, route, s } from '@kovojs/server';

import { trustedHtml } from '@kovojs/browser';

const db: { count: number } = { count: 4 };
const typedQuery = query('typed', {
  access: { kind: 'public', reason: 'build fixture query' },
  load: () => ({ count: db.count }),
});
export const addToCart = mutation({
  access: { kind: 'public', reason: 'build fixture mutation' },
  csrf: false,
  input: s.object({ quantity: s.number().int().min(1).default(1) }),
  handler(input) {
    db.count += input.quantity;
    return { count: db.count };
  },
});

export default createApp({
  mutations: [addToCart],
  queries: [typedQuery],
  routes: [
    route('/typed', {
      access: { kind: 'public', reason: 'build fixture route' },
      page: () => trustedHtml('<main>Typed Cart ') + db.count + '</main>',
    }),
  ],
});
`;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected kovo build test server to listen on an ephemeral port.');
  }

  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function dockerOutput(args: readonly string[]): string {
  return execFileSync('docker', [...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function dockerCleanup(args: readonly string[]): void {
  try {
    execFileSync('docker', [...args], { stdio: 'ignore' });
  } catch {
    // Cleanup is best-effort; the test failure above is more useful than a
    // secondary Docker cleanup error.
  }
}

async function dockerContainerOrigin(containerId: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const portOutput = dockerOutput(['port', containerId, '3000/tcp']).trim();
      const portLine = portOutput.split('\n').find(Boolean);
      if (portLine) return `http://${portLine.replace(/^0\.0\.0\.0:/, '127.0.0.1:')}`;
    } catch {
      // Docker can need a brief moment before port metadata is available.
    }
    await delay(100);
  }
  throw new Error(`Docker container ${containerId} did not expose port 3000.`);
}

async function waitForDockerRoute(origin: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${origin}/cart`);
      await response.arrayBuffer();
      if (response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Dockerized Kovo server did not become ready: ${String(lastError)}`);
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function writeProductionOnlyRuntimeNodeModules(runtimeDir: string): void {
  const packageRoot = join(runtimeDir, 'node_modules');
  for (const packageName of [
    '@kovojs/core',
    '@kovojs/browser',
    '@kovojs/server',
    'vite',
    'vite-plus',
  ]) {
    writeThrowingPackage(packageRoot, packageName);
  }
}

function writeThrowingPackage(packageRoot: string, packageName: string): void {
  const packageDir = join(packageRoot, packageName);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({
      exports: {
        '.': './index.mjs',
        './*': './index.mjs',
      },
      name: packageName,
      type: 'module',
      version: '0.0.0-dev-guard',
    }),
    'utf8',
  );
  writeFileSync(
    join(packageDir, 'index.mjs'),
    `throw new Error(${JSON.stringify(
      `${packageName} must not be imported by emitted kovo build output at request time`,
    )});\n`,
    'utf8',
  );
}

async function withEnv<T>(
  values: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]] as const),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withCwd<T>(cwd: string, run: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  try {
    process.chdir(cwd);
    return await run();
  } finally {
    process.chdir(previous);
  }
}
