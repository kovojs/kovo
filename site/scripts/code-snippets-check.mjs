import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Authored-doc snippet gate (plan DS-C2): every `ts`/`tsx` fence under
 * `site/content` is extracted into a scratch TypeScript project and checked as
 * source. The scratch project provides shared app-local declarations and small
 * public-shape package stubs so docs can show focused slices, while snippets
 * still have to be syntactically valid and import declared public names when
 * they reference framework APIs.
 */

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const contentDir = path.join(siteRoot, 'content');
const scratchDir = path.join(siteRoot, 'gen/code-snippets');
const stepsTsconfig = path.join(siteRoot, 'tutorial/tsconfig.steps.json');

const TS_LANGS = new Set(['ts', 'tsx']);

export function extractCodeSnippets(markdown, sourcePath = 'inline.md') {
  const lines = markdown.split('\n');
  const snippets = [];

  for (let index = 0; index < lines.length; index += 1) {
    const start = /^(\s*)```([A-Za-z0-9_-]*)\s*$/.exec(lines[index]);
    if (!start) continue;

    const lang = start[2].toLowerCase();
    const startLine = index + 1;
    const body = [];
    index += 1;

    while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }

    if (!TS_LANGS.has(lang)) continue;

    const code = body.join('\n');
    snippets.push({
      code,
      id: `${sanitize(sourcePath.replace(/\.md$/, ''))}__L${startLine}`,
      lang: inferSnippetLanguage(lang, code),
      sourcePath,
      startLine,
    });
  }

  return snippets;
}

export async function collectCodeSnippets(dir = contentDir) {
  const snippets = [];
  for (const file of await markdownFiles(dir)) {
    const markdown = readFileSync(file, 'utf8');
    const sourcePath = path.relative(dir, file);
    snippets.push(...extractCodeSnippets(markdown, sourcePath));
  }
  return snippets.sort((a, b) => a.id.localeCompare(b.id));
}

export async function checkAuthoredDocStyle({ dir = contentDir } = {}) {
  const issues = [];
  for (const file of await markdownFiles(dir)) {
    const markdown = readFileSync(file, 'utf8');
    const sourcePath = path.relative(dir, file);
    issues.push(...checkDocStyle(markdown, sourcePath));
  }

  if (issues.length > 0) {
    for (const issue of issues) {
      process.stderr.write(
        `doc-style: ${issue.sourcePath}:${issue.line} ${issue.code} ${issue.message}\n`,
      );
    }
    throw new Error(`doc-style: ${issues.length} issue(s) found`);
  }
}

export async function checkAuthoredCodeSnippets({
  dir = contentDir,
  outDir = scratchDir,
  keepOnSuccess = false,
} = {}) {
  await checkAuthoredDocStyle({ dir });

  const snippets = await collectCodeSnippets(dir);
  if (snippets.length === 0) {
    throw new Error(`code-snippets: no ts/tsx fences found in ${path.relative(repoRoot, dir)}`);
  }

  await rm(outDir, { force: true, recursive: true });
  await mkdir(outDir, { recursive: true });

  await writeSupportFiles(outDir);
  for (const snippet of snippets) {
    const ext = snippet.lang === 'tsx' ? 'tsx' : 'ts';
    const code = [
      `// Source: ${snippet.sourcePath}:${snippet.startLine}`,
      normalizeSnippetSource(snippet.code),
      '',
    ].join('\n');
    await writeFile(path.join(outDir, `${snippet.id}.${ext}`), code, 'utf8');
  }

  const tsconfig = {
    compilerOptions: {
      exactOptionalPropertyTypes: false,
      jsx: 'preserve',
      noEmit: true,
      noImplicitAny: false,
      noUncheckedIndexedAccess: false,
    },
    extends: path.relative(outDir, stepsTsconfig),
    include: ['*.ts', '*.tsx', 'stubs/**/*.ts', 'snippet-prelude.d.ts'],
  };
  await writeFile(
    path.join(outDir, 'tsconfig.json'),
    `${JSON.stringify(tsconfig, null, 2)}\n`,
    'utf8',
  );

  try {
    execFileSync(
      path.join(repoRoot, 'node_modules/.bin/tsgo'),
      ['-p', path.join(outDir, 'tsconfig.json')],
      {
        cwd: repoRoot,
        stdio: 'inherit',
      },
    );
  } catch {
    process.stdout.write(
      `\ncode-snippets/v1 snippets=${snippets.length} FAILED — see diagnostics above; scratch in ${path.relative(
        repoRoot,
        outDir,
      )}\n`,
    );
    process.exitCode = 1;
    return { ok: false, outDir, snippets };
  }

  if (!keepOnSuccess) rmSync(outDir, { force: true, recursive: true });
  process.stdout.write(`code-snippets/v1 snippets=${snippets.length} OK\n`);
  return { ok: true, outDir, snippets };
}

const FIRST_CODE_MAX_LINES = 12;
const CITATION_ALLOWLIST = new Set([
  'guides/cli.md',
  'guides/kovo-explain.md',
  'guides/static-export.md',
  'guides/testing.md',
]);

const OPENER_FRAMEWORK_NOUNS = [
  'touch set',
  'domain',
  'invalidation graph',
  'stylex',
  'interaction ladder',
  'broadcastchannel',
  'request shell',
];

const OPENER_APP_NOUNS = [
  'account',
  'admin',
  'app',
  'badge',
  'button',
  'cart',
  'checkout',
  'customer',
  'dashboard',
  'download',
  'form',
  'invoice',
  'link',
  'login',
  'order',
  'page',
  'product',
  'route',
  'session',
  'user',
];

function checkDocStyle(markdown, sourcePath) {
  const lines = markdown.split('\n');
  const issues = [];
  let inFence = false;
  let fenceLang = '';
  let inDetails = false;
  let firstCode = null;
  let firstProse = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^```([A-Za-z0-9_-]*)\s*$/.exec(line);
    if (fence) {
      if (!inFence) {
        fenceLang = fence[1].toLowerCase();
        const bodyStart = index + 1;
        let bodyEnd = bodyStart;
        while (bodyEnd < lines.length && !/^```\s*$/.test(lines[bodyEnd])) bodyEnd += 1;
        if (!firstCode && TS_LANGS.has(fenceLang)) {
          firstCode = {
            body: lines.slice(bodyStart, bodyEnd),
            line: index + 1,
            lang: fenceLang,
          };
        }
      }
      inFence = !inFence;
      fenceLang = inFence ? fenceLang : '';
      continue;
    }

    if (inFence) continue;
    if (/<details\b/.test(line)) inDetails = true;

    if (
      !inDetails &&
      !CITATION_ALLOWLIST.has(sourcePath) &&
      /(SPEC §|SPEC section|KV\d{3})/.test(line)
    ) {
      issues.push({
        code: 'citation-quarantine',
        line: index + 1,
        message: 'move SPEC/KV citations into the collapsed Spec & diagnostics section',
        sourcePath,
      });
    }

    if (!firstProse) {
      const trimmed = line.trim();
      const frontmatterFence = index === 0 && trimmed === '---';
      if (
        trimmed &&
        !frontmatterFence &&
        !trimmed.startsWith('title:') &&
        !trimmed.startsWith('description:') &&
        !trimmed.startsWith('order:') &&
        trimmed !== '---' &&
        !trimmed.startsWith('#') &&
        !trimmed.startsWith('<')
      ) {
        firstProse = { line: index + 1, text: trimmed };
      }
    }

    if (/<\/details>/.test(line)) inDetails = false;
  }

  if (firstCode && !CITATION_ALLOWLIST.has(sourcePath)) {
    const body = firstCode.body.filter((line) => line.trim() !== '');
    if (body.length > FIRST_CODE_MAX_LINES) {
      issues.push({
        code: 'first-code-block-size',
        line: firstCode.line,
        message: `first TypeScript block has ${body.length} nonblank lines; keep it at ${FIRST_CODE_MAX_LINES} or fewer`,
        sourcePath,
      });
    }

    // Unresolved identifiers are still enforced by the TypeScript snippet project below. Keep
    // this style pass focused on structural checks; name-only heuristics produce too many false
    // positives on JSX text, env vars, and deliberately declared app-local stubs.
  }

  if (firstProse) {
    const sentence = firstProse.text.split(/(?<=[.!?])\s+/)[0].toLowerCase();
    const hasFrameworkNoun = OPENER_FRAMEWORK_NOUNS.some((noun) => sentence.includes(noun));
    const hasAppNoun = OPENER_APP_NOUNS.some((noun) =>
      new RegExp(`\\b${noun}s?\\b`).test(sentence),
    );
    if (hasFrameworkNoun && !hasAppNoun) {
      issues.push({
        code: 'opener-app-noun',
        line: firstProse.line,
        message: 'opening sentence leads with framework vocabulary before an app outcome',
        sourcePath,
      });
    }
  }

  return issues;
}

function inferSnippetLanguage(lang, code) {
  if (lang === 'tsx') return 'tsx';
  if (/<[A-Z][\w.:-]*(\s|>|\/>)/.test(code) || /<[a-z][\w.:-]*(\s|>|\/>)/.test(code)) return 'tsx';
  return 'ts';
}

async function markdownFiles(dir) {
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries.sort()) {
    const file = path.join(dir, entry);
    const stat = statSync(file);
    if (stat.isDirectory()) {
      files.push(...(await markdownFiles(file)));
    } else if (entry.endsWith('.md')) {
      files.push(file);
    }
  }
  return files;
}

function normalizeSnippetSource(code) {
  const trimmed = code.replace(/\s+$/, '');
  if (/^\s*(import|export)\b/m.test(trimmed)) return `${trimmed}\n`;
  return `${trimmed}\n\nexport {};\n`;
}

function sanitize(name) {
  return name.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'snippet';
}

async function writeSupportFiles(outDir) {
  const stubsDir = path.join(outDir, 'stubs');
  await mkdir(stubsDir, { recursive: true });
  await writeFile(path.join(outDir, 'snippet-prelude.d.ts'), `${PRELUDE}\n`, 'utf8');
  await writeFile(path.join(stubsDir, 'external.ts'), `${EXTERNAL_STUBS}\n`, 'utf8');
  await writeFile(path.join(stubsDir, 'kovo.ts'), `${KOVO_STUBS}\n`, 'utf8');
  await writeNodeModuleStubs(outDir);
  await writeFile(path.join(outDir, 'app.ts'), `${LOCAL_APP_STUBS}\n`, 'utf8');
  await writeFile(path.join(outDir, 'db.ts'), `${LOCAL_APP_STUBS}\n`, 'utf8');
  await writeFile(path.join(outDir, 'domains.ts'), `${LOCAL_APP_STUBS}\n`, 'utf8');
  await writeFile(path.join(outDir, 'queries.ts'), `${LOCAL_APP_STUBS}\n`, 'utf8');
  await writeFile(path.join(outDir, 'schema.ts'), `${LOCAL_APP_STUBS}\n`, 'utf8');
  await writeFile(path.join(outDir, 'session.ts'), `${LOCAL_APP_STUBS}\n`, 'utf8');
  await writeFile(path.join(outDir, 'theme.ts'), `${LOCAL_APP_STUBS}\n`, 'utf8');
  await mkdir(path.join(outDir, 'components/ui'), { recursive: true });
  await writeFile(path.join(outDir, 'components/ui/button.ts'), `${LOCAL_APP_STUBS}\n`, 'utf8');
}

async function writeNodeModuleStubs(outDir) {
  await writePackage(outDir, '@kovojs/better-auth', { '.': EXTERNAL_DTS });
  await writePackage(outDir, '@kovojs/core', { '.': KOVO_DTS });
  await writePackage(outDir, '@kovojs/server', { '.': KOVO_DTS });
  await writePackage(outDir, '@kovojs/style', { '.': KOVO_DTS });
  await writePackage(outDir, '@kovojs/browser', { './client': KOVO_DTS });
  await writePackage(outDir, '@kovojs/headless-ui', { './dialog': KOVO_DTS, './select': KOVO_DTS });
  await writePackage(outDir, '@kovojs/icons', { '.': KOVO_DTS, './search': KOVO_DTS });
  await writePackage(outDir, '@kovojs/ui', { './button': KOVO_DTS, './select': KOVO_DTS });
  await writePackage(outDir, '@kovojs/test', {
    './assertions': EXTERNAL_DTS,
    './harness': EXTERNAL_DTS,
    './pglite': EXTERNAL_DTS,
    './test-case': EXTERNAL_DTS,
  });
  await writePackage(outDir, '@kovojs/drizzle', { '.': EXTERNAL_DTS });
  await writePackage(outDir, '@kovojs/devtool', {
    '.': EXTERNAL_DTS,
    './app': EXTERNAL_DTS,
    './vite': EXTERNAL_DTS,
  });
  await writePackage(outDir, '@electric-sql/pglite', { '.': EXTERNAL_DTS });
  await writePackage(outDir, 'better-sqlite3', { '.': EXTERNAL_DTS });
  await writePackage(outDir, 'drizzle-orm', {
    '.': EXTERNAL_DTS,
    './better-sqlite3': EXTERNAL_DTS,
    './pg-core': EXTERNAL_DTS,
    './pglite': EXTERNAL_DTS,
  });
}

async function writePackage(outDir, packageName, entries) {
  const packageDir = path.join(outDir, 'node_modules', packageName);
  await mkdir(packageDir, { recursive: true });
  const exports = {};
  for (const [subpath, source] of Object.entries(entries)) {
    const file =
      subpath === '.'
        ? 'index.d.ts'
        : `${subpath.replace(/^\.\//, '').replace(/[^\w-]+/g, '-')}.d.ts`;
    exports[subpath] = { types: `./${file}`, default: `./${file}` };
    await writeFile(path.join(packageDir, file), `${source}\n`, 'utf8');
  }
  await writeFile(
    path.join(packageDir, 'package.json'),
    `${JSON.stringify({ name: packageName, type: 'module', exports }, null, 2)}\n`,
    'utf8',
  );
}

const PRELUDE = String.raw`
type AnyRecord = Record<string, any>;

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [name: string]: any;
    }
  }

  type AdminRequest = any;
  type AppRequest = any;
  type CommerceDb = any;
  type CommerceRequest = any;
  type CommerceRouteRequest = any;
  type ReferenceRequest = any;
  type TouchGraph = any;

  var BroadcastChannel: any;
  var AccordionRoot: any;
  var AccountDenied: any;
  var AccountOverviewPage: any;
  var AccountShell: any;
  var AlertDialogRoot: any;
  var AdminDashboard: any;
  var AppShell: any;
  var Badge: any;
  var Button: any;
  var CartBadge: any;
  var CartPage: any;
  var ComboboxRoot: any;
  var CommerceCartLayout: any;
  var CommerceCartPage: any;
  var DealsPage: any;
  var DealDetailRegion: any;
  var DialogRoot: any;
  var DialogTrigger: any;
  var DocsShell: any;
  var DocsSidebar: any;
  var ErrorShell: any;
  var ForbiddenShell: any;
  var GuidePage: any;
  var HomePage: any;
  var InvoiceError: any;
  var InvoicePage: any;
  var Link: any;
  var LoginForm: any;
  var MissingInvoice: any;
  var NotFoundShell: any;
  var PipelineLayout: any;
  var ProductList: any;
  var ProductGrid: any;
  var ProductPage: any;
  var SearchDialog: any;
  var Select: any;
  var SelectRoot: any;
  var SettingsPage: any;
  var SheetRoot: any;
  var Sidebar: any;
  var SwitchRoot: any;
  var TabsRoot: any;
  var ToastRoot: any;
  var TooltipRoot: any;
  var addContact: any;
  var addToCart: any;
  var addToCartHandler: any;
  var addToCartInput: any;
  var addToCartOptimistic: any;
  var adminAssign: any;
  var accounts: any;
  var appCsrf: any;
  var appDb: any;
  var appSessionProvider: any;
  var appSignIn: any;
  var appSignOut: any;
  var applyAddToCartEffect: any;
  var assert: any;
  var auth: any;
  var authed: <Request = any>() => any;
  var auditLog: any;
  var betterAuth: any;
  var betterAuthHandler: any;
  var betterAuthSession: any;
  var betterAuthSignInEmailMutation: any;
  var betterAuthSignOutMutation: any;
  var broadcastCartUpdate: any;
  var cart: any;
  var cartDomain: any;
  var cartItems: any;
  var cartPage: any;
  var cartQuery: any;
  var checkoutGuard: any;
  var commerceBetterAuth: any;
  var commerceCartRoute: any;
  var commerceCsrf: any;
  var commerceHomeRoute: any;
  var commerceLoginRoute: any;
  var commerceSession: any;
  var commerceSignIn: any;
  var commerceSignOut: any;
  var commerceStylesheets: any;
  var commerceTouchGraph: any;
  var commentsQuery: any;
  var compare: any;
  var compareAndSet: any;
  var component: any;
  var componentRegistry: any;
  var contactCard: any;
  var contact: any;
  var contacts: any;
  var contactsQuery: any;
  var createSession: any;
  var createApp: any;
  var createCommerceDb: any;
  var createMemoryVersionedClientModuleRegistry: any;
  var createOrderInput: any;
  var createStorageDownloadEndpoint: any;
  var created: any;
  var crmStaticDealPaths: any;
  var crmStylesheets: any;
  var ctx: any;
  var db: any;
  var deleteContact: any;
  var demoSession: any;
  var deal: any;
  var dealDetailStyles: any;
  var domain: any;
  var eq: any;
  var endpoints: any;
  var endpoint: <Value = any>(...args: any[]) => any;
  var emit: any;
  var escapeHtml: any;
  var expect: any;
  var finishOAuth: any;
  var formData: any;
  var form: any;
  var forms: any;
  var formatDate: any;
  var formatRelative: any;
  var generatedCartStates: any;
  var guards: any;
  var harness: any;
  var harnessOptions: any;
  var hmacSignature: any;
  var healthEndpoint: any;
  var homeRoute: any;
  var id: any;
  var input: any;
  var integer: any;
  var invoicesBucket: any;
  var item: any;
  var kovo: any;
  var layout: any;
  var loadCart: any;
  var loadContact: any;
  var loadDeal: any;
  var loadInvoice: any;
  var loadOrder: any;
  var loadPost: any;
  var loginRoute: any;
  var maskedEmail: any;
  var menuRoot: any;
  var messageQuery: any;
  var mutation: <Value = any>(...args: any[]) => any;
  var mutations: any;
  var notFound: any;
  var order: any;
  var orderEvents: any;
  var orderStatus: any;
  var orders: any;
  var ownsOrder: any;
  var params: any;
  var pending: any;
  var pool: any;
  var postQuery: any;
  var priceParam: any;
  var product: any;
  var productQuery: any;
  var productGrid: any;
  var productGridQuery: any;
  var productId: any;
  var products: any;
  var pgTable: any;
  var query: any;
  var queries: any;
  var queryClient: any;
  var rateLimit: any;
  var redisLiveEmitter: any;
  var renderCartPage: any;
  var renderOnce: any;
  var renderProduct: any;
  var renderProductGrid: any;
  var req: any;
  var request: any;
  var requireAdmin: any;
  var requireUser: any;
  var role: <Request = any>(...args: any[]) => any;
  var route: any;
  var routes: any;
  var s: any;
  var SCHEMA_DDL: any;
  var SEED_PRODUCTS: any;
  var searchQuery: any;
  var serverValue: any;
  var session: any;
  var sessionProvider: any;
  var inProcessLiveEmitter: any;
  var shapeCartQuery: any;
  var shopCsrf: any;
  var signCapability: any;
  var siteMeta: any;
  var siteStylesheets: any;
  var sql: any;
  var sum: any;
  var stripe: any;
  var table: any;
  var text: any;
  var themeScript: any;
  var token: any;
  var toast: any;
  var trustedReveal: any;
  var tx: any;
  var qty: any;
  var auctionQuery: any;
  var queueQuery: any;
  var trialQuery: any;
  var updateCartLine: any;
  var updateContact: any;
  var updateOrder: any;
  var userCanRead: any;
  var user: any;
  var users: any;
  var viewerQuery: any;
  var verifyWebhook: any;
  var webhook: <Value = any>(...args: any[]) => any;
  var write: any;
}

export {};
`;

const EXTERNAL_STUBS = String.raw`
export const KovoDevtool = {} as any;
export const PGlite = class {} as any;
export type PGliteOptions = any;
export type PgliteDatabase<TSchema = any> = any;
export type Results = any;
export type BetterSQLite3Database<TSchema = any> = any;
export type KovoTestTouchGraph = any;
export const betterAuth = (() => ({})) as any;
export const betterSqlite3 = (() => ({})) as any;
export const assertMutationError = (() => ({})) as any;
export const buildBundle = (() => ({})) as any;
export const createKovoTestHarness = (() => ({})) as any;
export const createDevtoolApp = (() => ({})) as any;
export const createKovoDrizzle = (() => ({})) as any;
export const createPgliteTestDb = (() => ({})) as any;
export const devtoolPlugin = (() => ({})) as any;
export const devtoolMountPlugin = (() => ({})) as any;
export const drizzle = (() => ({})) as any;
export const eq = (() => ({})) as any;
export const integer = (() => ({ primaryKey: () => ({}), references: () => ({}) })) as any;
export const kovo = (() => ({})) as any;
export const kovoTest = { configure: (() => ({})) as any } as any;
export const pgTable = (() => ({})) as any;
export const propertyTest = (() => ({})) as any;
export const serial = (() => ({})) as any;
export const sql = (() => ({})) as any;
export const sqliteTable = (() => ({})) as any;
export const text = (() => ({ notNull: () => ({}), unique: () => ({}) })) as any;
export default {} as any;
`;

const EXTERNAL_DTS = String.raw`
export type BetterSQLite3Database<TSchema = any> = any;
export type KovoTestTouchGraph = any;
export type PGliteOptions = any;
export type PgliteDatabase<TSchema = any> = any;
export type Results = any;

export const KovoDevtool: any;
export const PGlite: any;
export const assertMutationError: any;
export const betterAuth: any;
export const betterAuthSession: any;
export const betterSqlite3: any;
export const buildBundle: any;
export const createDevtoolApp: any;
export const createKovoDrizzle: any;
export const createKovoTestHarness: any;
export const createPgliteTestDb: any;
export const compareAndSet: any;
export const devtoolMountPlugin: any;
export const devtoolPlugin: any;
export const drizzle: any;
export const eq: any;
export const and: any;
export const integer: any;
export const kovo: any;
export const kovoTest: any;
export const pgTable: any;
export const propertyTest: any;
export const serial: any;
export const sql: any;
export const sqliteTable: any;
export const text: any;
declare const defaultExport: any;
export default defaultExport;
`;

const KOVO_DTS = String.raw`
export type ComponentElementNode = any;
export type ComponentNode = any;
export type ComponentRegistry = any;
export type ComponentRegistryEntry = any;
export type ComponentRegistryInput = any;
export type ComponentTextNode = any;
export type IconProps = any;
export type SelectTriggerAttributeOptions = any;
export type StyleInput = any;
export type CsrfValidationOptions<Request = any> = any;

export class ComponentXmlError extends Error {}
export const BodyEnd: any;
export const Button: any;
export const Defer: any;
export const Document: any;
export const FontPreload: any;
export const Head: any;
export const InlineScript: any;
export const Link: any;
export const Search: any;
export const Select: any;
export const adminAssign: any;
export const component: any;
export const create: any;
export const createApp: any;
export const createQueryStore: any;
export const createRequestHandler: any;
export const createStorageDownloadEndpoint: any;
export const csrfField: any;
export const defineTheme: any;
export const dialogContentAttributes: any;
export const domain: any;
export const endpoint: any;
export const form: any;
export const guards: {
  all: any;
  authed: <Request = any>() => any;
  csrf: any;
  rateLimit: <Request = any>(...args: any[]) => any;
  role: <Request = any>(...args: any[]) => any;
};
export const hmacSignature: any;
export const installKovoLoader: any;
export const layout: any;
export const metaFromQuery: any;
export const mutation: <Value = any>(...args: any[]) => any;
export const notFound: any;
export const parseComponentXml: any;
export const queue: any;
export const query: any;
export const tag: any;
export const redirect: any;
export const renderRegistry: any;
export const renderTree: any;
export const route: any;
export const s: any;
export const safeRichHtml: any;
export const serverValue: any;
export const selectTriggerAttributes: any;
export const session: any;
export const StaleVersionError: any;
export const stylesheet: any;
export const toNodeHandler: any;
export const tokens: any;
export const trustedHtml: any;
export const trustedReveal: any;
export const trustedUrl: any;
export const webhook: any;
export const write: any;
`;

const KOVO_STUBS = String.raw`
type AnyFn = (...args: any[]) => any;

const anyFn = ((..._args: any[]) => ({})) as AnyFn;

export type ComponentElementNode = any;
export type ComponentNode = any;
export type ComponentRegistry = any;
export type ComponentRegistryEntry = any;
export type ComponentRegistryInput = any;
export type ComponentTextNode = any;
export type IconProps = any;
export type SelectTriggerAttributeOptions = any;
export type StyleInput = any;

export class ComponentXmlError extends Error {}
export const BodyEnd = anyFn;
export const Button = anyFn;
export const Defer = anyFn;
export const Document = anyFn;
export const FontPreload = anyFn;
export const Head = anyFn;
export const InlineScript = anyFn;
export const Link = anyFn;
export const Search = anyFn;
export const Select = anyFn;
export const adminAssign = anyFn;
export const create = anyFn;
export const component = anyFn;
export const createApp = anyFn;
export const createQueryStore = anyFn;
export const createRequestHandler = anyFn;
export const createStorageDownloadEndpoint = anyFn;
export const csrfField = anyFn;
export const defineTheme = anyFn;
export const dialogContentAttributes = anyFn;
export const domain = anyFn;
export const endpoint = anyFn;
export const form = anyFn;
export const hmacSignature = anyFn;
export const installKovoLoader = anyFn;
export const layout = anyFn;
export const metaFromQuery = anyFn;
export const mutation = anyFn;
export const notFound = anyFn;
export const parseComponentXml = anyFn;
export const queue = anyFn;
export const query = anyFn;
export const redirect = anyFn;
export const renderRegistry = anyFn;
export const renderTree = anyFn;
export const route = anyFn;
export const selectTriggerAttributes = anyFn;
export const safeRichHtml = anyFn;
export const serverValue = anyFn;
export const session = anyFn;
export const stylesheet = anyFn;
export const tag = anyFn;
export const toNodeHandler = anyFn;
export const trustedHtml = anyFn;
export const trustedReveal = anyFn;
export const trustedUrl = anyFn;
export const webhook = anyFn;
export const write = anyFn;
export const tokens = new Proxy({}, { get: () => 'var(--kovo-snippet-token)' }) as any;

export const guards = {
  all: anyFn,
  authed: anyFn as <Request = any>() => any,
  csrf: anyFn,
  rateLimit: anyFn as <Request = any>(...args: any[]) => any,
  role: anyFn as <Request = any>(...args: any[]) => any,
} as any;

export const s = {
  array: anyFn,
  boolean: anyFn,
  enum: anyFn,
  number: anyFn,
  object: anyFn,
  optional: anyFn,
  string: anyFn,
} as any;
`;

const LOCAL_APP_STUBS = String.raw`
export const Button = {} as any;
export const app = {} as any;
export const cartDomain = {} as any;
export const cartItems = {} as any;
export const cartQuery = {} as any;
export const cart = {} as any;
export const connectDb = (() => ({})) as any;
export const contactTheme = {} as any;
export const db = {} as any;
export const domains = {} as any;
export const loadContact = {} as any;
export const mutations = {} as any;
export const products = {} as any;
export const queries = {} as any;
export const routes = {} as any;
export const sessionProvider = {} as any;
export const siteThemeCss = {} as any;
export const theme = {} as any;
export default {} as any;
`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkAuthoredCodeSnippets();
  if (!result.ok) process.exitCode = 1;
}
