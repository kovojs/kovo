// SPEC.md §6.6 (trust surface, AUDIT-ONLY): static collectors that surface every
// app-authored trust escape and dangerous imperative-DOM sink for `kovo explain --trust`
// (KV426) and `kovo check` (KV424). These passes ENFORCE NOTHING by themselves — they
// produce facts (TrustEscapeExplain / UnregisteredSinkFact) that the CLI renderer in
// packages/cli/src/graph-output.ts surfaces. The trust pass is purely audit-only: it
// emits one row per escape regardless of whether a justification is present, and the
// consumer decides how to present a missing justification. The dangerous-sink pass is
// deliberately conservative (see collectUnregisteredSinksFromProject) so the
// error-severity KV424 gate stays near-zero false-positive on real app code.
//
// These mirror the AST-pass style of ./static.ts (analyzeSqlSafetyFromProject):
// ts-morph, getDescendantsOfKind(CallExpression), and the same `file:line` site format
// produced by `lineForIndex`. They use a self-contained syntactic ts-morph Project (no
// type-checker dependency) because every signal here is recognizable at the AST level.

import { Node, Project, SyntaxKind, ts, type SourceFile } from 'ts-morph';
import { builtinModules as builtinNodeModules } from 'node:module';
import type {
  CapabilityExplain,
  CookieDowngradeExplain,
  TrustEscapeExplain,
  UnregisteredSinkFact,
} from '@kovojs/core/internal/graph';
import {
  canonicalFrameworkExportForExpression,
  expressionResolvesToFrameworkExport,
  frameworkExport,
} from './static/framework-identity.js';

/** @internal */
export interface TrustEscapeSourceFileInput {
  fileName: string;
  source: string;
}

/** @internal */
export interface TrustEscapeProjectOptions {
  files: readonly TrustEscapeSourceFileInput[];
}

/**
 * `file:line` — the same site format the SQL safety analyzer emits
 * (`lineForIndex` in ./static.ts), which the `kovo explain` TRUST renderer consumes.
 *
 * @internal
 */
function lineForIndex(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function siteFor(file: TrustEscapeSourceFileInput, node: Node): string {
  return `${file.fileName}:${lineForIndex(file.source, node.getStart())}`;
}

/** ts-morph has no `isStringLiteralLike`; mirror static.ts's literal predicate. */
function isStringLiteralLike(node: Node | undefined): node is Node & { getLiteralText(): string } {
  return !!node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node));
}

function createSyntacticProject(files: readonly TrustEscapeSourceFileInput[]): {
  project: Project;
  sourceFiles: SourceFile[];
  dispose: () => void;
} {
  const project = new Project({
    compilerOptions: {
      // JavaScript/mjs app modules are authored request surfaces too. The project remains fully
      // in-memory over caller-supplied immutable snapshots; allowJs only selects the parser mode.
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
    },
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  const sourceFiles = files.map((file) =>
    project.createSourceFile(syntacticFileName(file.fileName), file.source, { overwrite: true }),
  );
  return {
    project,
    sourceFiles,
    dispose: () => {
      for (const sourceFile of sourceFiles) sourceFile.forget();
    },
  };
}

function syntacticFileName(fileName: string): string {
  if (/\.[cm]?[jt]sx?$/.test(fileName)) return fileName;
  return `${fileName}.tsx`;
}

// =====================================================================================
// TASK A — KV426 trust-escape collector (SPEC §6.6, AUDIT-ONLY)
// =====================================================================================

const TRUSTED_CALL_KINDS: Readonly<Record<string, TrustEscapeExplain['kind']>> = {
  trustedHtml: 'trustedHtml',
  trustedSql: 'trustedSql',
  trustedUrl: 'trustedUrl',
};

const TRUSTED_CALL_SAFE_PATH: Readonly<Record<string, string>> = {
  trustedHtml: 'trustedHtml',
  trustedSql: 'trustedSql',
  trustedUrl: 'trustedUrl',
};

const TRUSTED_CALL_OWNER: Readonly<Record<string, string>> = {
  trustedHtml: 'html.dom.output',
  trustedSql: 'data.sql.raw',
  trustedUrl: 'url.attribute.output',
};

/**
 * Collect every app-authored trust escape as a `TrustEscapeExplain` (SPEC §6.6,
 * AUDIT-ONLY for `kovo explain --trust`, KV426). One row is emitted per:
 *
 *  - `trustedHtml(...)`  call site → kind `trustedHtml`
 *  - `trustedUrl(...)`   call site → kind `trustedUrl`
 *  - `trustedSql(...)`   call site → kind `trustedSql`
 *  - `endpoint(...)`     declaration → kind `rawEndpoint`
 *  - `webhook({ verify: 'none' })` → kind `webhookVerifyNone`
 *
 * `staticExportPathOverride` is intentionally NOT collected: the static-export path/root
 * override surface (`KovoAppShellViteBuildStaticExportOptions.distDir`/`outDir`, etc.) is
 * `@internal` build/host config "not exported to app authors" (vite-static-export-options.ts),
 * so there is no app-authored override EXPRESSION to scan for. Rather than invent one, this
 * kind is left to whatever build-config producer owns that surface.
 *
 * A `justification` is captured when provided as: a trailing string argument, an options
 * object field (`reason`/`justification`/`verifyJustification`), or a leading
 * `// justification:` line comment on the call/declaration. KV426 treats a MISSING
 * justification as a finding — but this pass emits the escape EITHER WAY (justification
 * left `undefined`); the renderer/consumer decides. Audit-only: surfacing the trust
 * surface enforces nothing.
 *
 * @internal
 */
export function collectTrustEscapesFromProject(
  options: TrustEscapeProjectOptions,
): TrustEscapeExplain[] {
  const { sourceFiles, dispose } = createSyntacticProject(options.files);
  try {
    const escapes: TrustEscapeExplain[] = [];
    for (const [index, sourceFile] of sourceFiles.entries()) {
      const file = options.files[index];
      if (!file) continue;
      escapes.push(...trustEscapesForSourceFile(file, sourceFile));
    }
    return escapes.sort(
      (left, right) => left.kind.localeCompare(right.kind) || left.site.localeCompare(right.site),
    );
  } finally {
    dispose();
  }
}

function trustEscapesForSourceFile(
  file: TrustEscapeSourceFileInput,
  sourceFile: SourceFile,
): TrustEscapeExplain[] {
  const escapes: TrustEscapeExplain[] = [];

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const name = trustedCallNameForCallee(callee);

    const trustedKind = name ? TRUSTED_CALL_KINDS[name] : undefined;
    if (name && trustedKind) {
      escapes.push(buildTrustedCallEscape(file, call, name, trustedKind));
      continue;
    }

    if (isKovoServerTrustCallee(callee, 'endpoint')) {
      escapes.push(buildRawEndpointEscape(file, call));
      continue;
    }

    if (isKovoServerTrustCallee(callee, 'webhook')) {
      const escape = buildWebhookVerifyNoneEscape(file, call);
      if (escape) escapes.push(escape);
    }
  }

  return escapes;
}

function trustedCallNameForCallee(callee: Node): keyof typeof TRUSTED_CALL_KINDS | undefined {
  const candidates = [
    ['trustedHtml', '@kovojs/browser'],
    ['trustedSql', '@kovojs/drizzle'],
    ['trustedUrl', '@kovojs/browser'],
  ] as const;
  return candidates.find(([exportName, module]) =>
    expressionResolvesToFrameworkExport(callee, frameworkExport(module, exportName), {
      legacyGlobals: [frameworkExport(module, exportName)],
    }),
  )?.[0];
}

function isKovoServerTrustCallee(callee: Node, exportName: 'endpoint' | 'webhook'): boolean {
  return expressionResolvesToFrameworkExport(
    callee,
    frameworkExport('@kovojs/server', exportName),
    {
      legacyGlobals: [frameworkExport('@kovojs/server', exportName)],
    },
  );
}

function buildTrustedCallEscape(
  file: TrustEscapeSourceFileInput,
  call: Node,
  name: string,
  kind: TrustEscapeExplain['kind'],
): TrustEscapeExplain {
  const args = Node.isCallExpression(call) ? call.getArguments() : [];
  const justification =
    optionsObjectJustification(args) ??
    trailingStringJustification(args) ??
    leadingJustification(call);
  const owner = TRUSTED_CALL_OWNER[name];
  return {
    kind,
    ...(owner ? { owner } : {}),
    safePath: TRUSTED_CALL_SAFE_PATH[name] ?? name,
    site: siteFor(file, call),
    ...(args[0] ? { source: shortSource(args[0]) } : {}),
    ...(justification === undefined ? {} : { justification }),
  };
}

function buildRawEndpointEscape(file: TrustEscapeSourceFileInput, call: Node): TrustEscapeExplain {
  const args = Node.isCallExpression(call) ? call.getArguments() : [];
  const definition = args.find((arg) => Node.isObjectLiteralExpression(arg));
  const justification =
    (definition && Node.isObjectLiteralExpression(definition)
      ? (objectStringProperty(definition, 'reason') ??
        objectStringProperty(definition, 'purpose') ??
        objectStringProperty(definition, 'justification'))
      : undefined) ?? leadingJustification(call);
  const path = args[0] && isStringLiteralLike(args[0]) ? args[0].getLiteralText() : undefined;
  return {
    kind: 'rawEndpoint',
    owner: 'ingress.endpoint.raw',
    safePath: 'endpoint(...)',
    site: siteFor(file, call),
    ...(path ? { source: path } : args[0] ? { source: shortSource(args[0]) } : {}),
    ...(justification === undefined ? {} : { justification }),
  };
}

function buildWebhookVerifyNoneEscape(
  file: TrustEscapeSourceFileInput,
  call: Node,
): TrustEscapeExplain | null {
  const args = Node.isCallExpression(call) ? call.getArguments() : [];
  const definition = args.find(
    (arg) => Node.isObjectLiteralExpression(arg) && objectStringProperty(arg, 'verify') === 'none',
  );
  if (!definition) return null;

  const justification =
    objectStringProperty(definition, 'verifyJustification') ??
    objectStringProperty(definition, 'justification') ??
    leadingJustification(call);
  // Webhook name is the first arg: webhook('order-paid', { ... }).
  const nameArg = args[0];
  const source = nameArg && isStringLiteralLike(nameArg) ? nameArg.getLiteralText() : undefined;
  return {
    kind: 'webhookVerifyNone',
    owner: 'ingress.endpoint.webhook',
    safePath: 'webhook({verify:none})',
    site: siteFor(file, call),
    ...(source ? { source } : {}),
    ...(justification === undefined ? {} : { justification }),
  };
}

// ---- justification extraction helpers -------------------------------------------------

function optionsObjectJustification(args: readonly Node[]): string | undefined {
  for (const arg of args) {
    if (!Node.isObjectLiteralExpression(arg)) continue;
    const value = objectStringProperty(arg, 'justification') ?? objectStringProperty(arg, 'reason');
    if (value !== undefined) return value;
  }
  return undefined;
}

function trailingStringJustification(args: readonly Node[]): string | undefined {
  // A trailing string literal arg (e.g. trustedHtml(x, "reviewed")) read as justification.
  for (let i = args.length - 1; i >= 1; i -= 1) {
    const arg = args[i];
    if (arg && isStringLiteralLike(arg)) return arg.getLiteralText();
    if (arg && !Node.isObjectLiteralExpression(arg)) break;
  }
  return undefined;
}

function leadingJustification(node: Node): string | undefined {
  // A `// justification: ...` line comment immediately preceding the statement.
  const statement = node.getFirstAncestorByKind(SyntaxKind.VariableStatement) ?? node;
  for (const range of statement.getLeadingCommentRanges()) {
    const text = range.getText();
    const match = /\/\/\s*justification:\s*(.+)\s*$/i.exec(text.trim());
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function objectStringProperty(object: Node, propertyName: string): string | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const property = object.getProperty(propertyName);
  if (!Node.isPropertyAssignment(property)) return undefined;
  const initializer = property.getInitializer();
  if (!initializer || !isStringLiteralLike(initializer)) return undefined;
  return initializer.getLiteralText();
}

function shortSource(node: Node): string {
  const text = node.getText().replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

// =====================================================================================
// TASK B — KV424 dangerous-sink collector (SPEC §6.6, ERROR-severity gate)
// =====================================================================================
//
// CONSERVATIVE BY DESIGN. KV424 fails `kovo check` on ANY entry, so this pass must stay
// near-zero false-positive on real app code. It flags only the unambiguous imperative-DOM
// dangerous-sink lexicon, and only inside HANDLER bodies — the closures the compiler
// serializes across the KV201 handler-serialization boundary (event handlers / lifecycle
// callbacks reachable from JSX). It deliberately does NOT walk arbitrary module/server
// code (where `innerHTML` etc. may be legitimate non-app-boundary usage). The flagged
// lexicon:
//   - `el.innerHTML = ...`      → safePath trustedHtml
//   - `el.outerHTML = ...`      → safePath trustedHtml
//   - `eval(...)`               → safePath (no Kovo equivalent; remove)
//   - `setTimeout('...string...')` (string first arg) → safePath function-callback
//   - `document.write(...)`     → safePath trustedHtml
//   - `new Function(...)`       → safePath (no Kovo equivalent; remove)

interface DangerousSinkMatch {
  sink: string;
  safePath: string;
  source?: string;
}

/**
 * Collect dangerous imperative-DOM sink writes/calls inside app handler bodies as
 * `UnregisteredSinkFact`s (SPEC §6.6, KV424). KV424 is ERROR-severity in `kovo check`
 * (the check fails on ANY entry), so this pass is intentionally conservative: it scans
 * only handler-shaped closures (event/lifecycle callbacks reachable across the KV201
 * serialization boundary) and only the unambiguous dangerous lexicon.
 *
 * @internal
 */
export function collectUnregisteredSinksFromProject(
  options: TrustEscapeProjectOptions,
): UnregisteredSinkFact[] {
  const { sourceFiles, dispose } = createSyntacticProject(options.files);
  try {
    const facts: UnregisteredSinkFact[] = [];
    for (const [index, sourceFile] of sourceFiles.entries()) {
      const file = options.files[index];
      if (!file) continue;
      facts.push(...unregisteredSinksForSourceFile(file, sourceFile));
    }
    facts.push(...requestProcessSinksForProject(options.files, sourceFiles));
    return facts.sort(
      (left, right) => left.site.localeCompare(right.site) || left.sink.localeCompare(right.sink),
    );
  } finally {
    dispose();
  }
}

const REQUEST_PROCESS_METHODS = new Set([
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'fork',
  'spawn',
  'spawnSync',
]);

const REQUEST_VM_METHODS = new Set([
  'Script',
  'SourceTextModule',
  'SyntheticModule',
  'compileFunction',
  'runInContext',
  'runInNewContext',
  'runInThisContext',
]);

const REQUEST_FILESYSTEM_METHODS = new Set([
  'ReadStream',
  'WriteStream',
  'access',
  'accessSync',
  'appendFile',
  'appendFileSync',
  'chmod',
  'chmodSync',
  'chown',
  'chownSync',
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'createReadStream',
  'createWriteStream',
  'existsSync',
  'glob',
  'globSync',
  'lchmod',
  'lchmodSync',
  'lchown',
  'lchownSync',
  'link',
  'linkSync',
  'lstat',
  'lstatSync',
  'lutimes',
  'lutimesSync',
  'mkdir',
  'mkdirSync',
  'mkdtemp',
  'mkdtempSync',
  'open',
  'openSync',
  'opendir',
  'opendirSync',
  'read',
  'readFile',
  'readFileSync',
  'readSync',
  'readdir',
  'readdirSync',
  'readlink',
  'readlinkSync',
  'readv',
  'readvSync',
  'realpath',
  'realpathSync',
  'rename',
  'renameSync',
  'rm',
  'rmSync',
  'rmdir',
  'rmdirSync',
  'stat',
  'statSync',
  'statfs',
  'statfsSync',
  'symlink',
  'symlinkSync',
  'truncate',
  'truncateSync',
  'unlink',
  'unlinkSync',
  'unwatchFile',
  'utimes',
  'utimesSync',
  'watch',
  'watchFile',
  'write',
  'writeFile',
  'writeFileSync',
  'writeSync',
  'writev',
  'writevSync',
]);

const REQUEST_PATH_METHODS = new Set([
  'basename',
  'dirname',
  'extname',
  'format',
  'isAbsolute',
  'join',
  'matchesGlob',
  'normalize',
  'parse',
  'relative',
  'resolve',
  'toNamespacedPath',
]);

const REQUEST_WORKER_METHODS = new Set(['Worker']);
const REQUEST_CLUSTER_METHODS = new Set(['fork']);
const REQUEST_CREATE_REQUIRE_METHODS = new Set(['createRequire']);
const REQUEST_PROCESS_MODULE_METHODS = new Set(['getBuiltinModule']);
const REQUEST_PROCESS_GLOBAL_METHODS = new Set([
  '_debugEnd',
  '_debugProcess',
  '_eval',
  '_fatalException',
  '_kill',
  '_linkedBinding',
  '_rawDebug',
  '_startProfilerIdleNotifier',
  '_stopProfilerIdleNotifier',
  'abort',
  'chdir',
  'dlopen',
  'exit',
  'getBuiltinModule',
  'kill',
  'reallyExit',
  'setegid',
  'seteuid',
  'setgid',
  'setgroups',
  'setuid',
  'umask',
]);
const REQUEST_BUN_PROCESS_METHODS = new Set(['$', 'file', 'spawn', 'spawnSync', 'write']);
const REQUEST_DENO_PROCESS_METHODS = new Set([
  'Command',
  'chmod',
  'chown',
  'copyFile',
  'create',
  'lstat',
  'makeTempDir',
  'makeTempFile',
  'mkdir',
  'open',
  'readDir',
  'readFile',
  'readTextFile',
  'realPath',
  'remove',
  'rename',
  'run',
  'stat',
  'writeFile',
  'writeTextFile',
]);

const REQUEST_FILESYSTEM_INERT_EXPORTS = new Set([
  'Dir',
  'Dirent',
  'Stats',
  'Utf8Stream',
  '_toUnixTimestamp',
  'constants',
]);
const REQUEST_PATH_INERT_EXPORTS = new Set(['delimiter', 'sep']);
const REQUEST_NODE_PROCESS_INERT_EXPORTS = new Set([
  'arch',
  'argv0',
  'config',
  'features',
  'pid',
  'platform',
  'ppid',
  'release',
  'version',
  'versions',
]);
const REQUEST_NO_INERT_EXPORTS = new Set<string>();

const REQUEST_HANDLER_FACTORIES = [
  { exportName: 'endpoint', property: 'handler' },
  { exportName: 'mutation', property: 'handler' },
  { exportName: 'query', property: 'load' },
  { exportName: 'task', property: 'run' },
  { exportName: 'webhook', property: 'handler' },
] as const;

const REQUEST_PROCESS_SAFE_PATH =
  'runCommand(cmd(...), ...) with commandAllowlist(...) from @kovojs/server';

const REQUEST_FILESYSTEM_SAFE_PATH =
  'use Kovo rooted file responses or storage capabilities instead of raw filesystem access';

const REQUEST_DYNAMIC_CODE_SAFE_PATH = 'remove request-reachable dynamic code evaluation';

const REQUEST_FRAMEWORK_AUTHORITY_MINTERS = [
  {
    exportName: 'rootedFiles',
    module: '@kovojs/server',
    safePath: 'construct rootedFiles(...) once at module scope with a static reviewed root',
    sink: '@kovojs/server.rootedFiles',
  },
  {
    exportName: 'commandAllowlist',
    module: '@kovojs/server',
    safePath: 'construct commandAllowlist(...) once at module scope from static absolute programs',
    sink: '@kovojs/server.commandAllowlist',
  },
  {
    exportName: 'cmd',
    module: '@kovojs/server',
    safePath:
      'construct cmd(...) once at module scope from a static reviewed program and allowlist',
    sink: '@kovojs/server.cmd',
  },
  {
    exportName: 'createFileSystemStorage',
    module: '@kovojs/core',
    safePath:
      'construct createFileSystemStorage(...) once at module scope with a static reviewed root',
    sink: '@kovojs/core.createFileSystemStorage',
  },
  {
    exportName: 'createS3CompatibleStorage',
    module: '@kovojs/core',
    safePath:
      'construct createS3CompatibleStorage(...) once at module scope with static reviewed authority',
    sink: '@kovojs/core.createS3CompatibleStorage',
  },
] as const;

interface RequestCallable {
  readonly body: Node;
  readonly declaration: Node;
  readonly rootFactory?: (typeof REQUEST_HANDLER_FACTORIES)[number]['exportName'];
}

interface RequestCallableResolution {
  readonly callables: readonly RequestCallable[];
  readonly opaqueModule?: string;
}

interface RequestProcessScanContext {
  readonly facts: UnregisteredSinkFact[];
  readonly filesByPath: ReadonlyMap<string, TrustEscapeSourceFileInput>;
  readonly scanned: Set<string>;
}

/**
 * SPEC §6.6 / KV424: raw process APIs are outside Kovo's safe command capability. Request
 * handlers are roots, not merely browser event callbacks: follow locally provable helper calls,
 * classify child_process exports by import/symbol identity, and fail closed when a reachable bare
 * package handler/helper lies outside the supplied immutable source snapshot. The build must never
 * treat an ambient node_modules read as compiler authority.
 */
function requestProcessSinksForProject(
  files: readonly TrustEscapeSourceFileInput[],
  sourceFiles: readonly SourceFile[],
): UnregisteredSinkFact[] {
  const filesByPath = new Map<string, TrustEscapeSourceFileInput>();
  for (const [index, sourceFile] of sourceFiles.entries()) {
    const file = files[index];
    if (file) filesByPath.set(sourceFile.getFilePath(), file);
  }

  const context: RequestProcessScanContext = {
    facts: [],
    filesByPath,
    scanned: new Set(),
  };

  // Only supplied app snapshots may establish request roots. Resolved local helpers can then be
  // followed transitively, but a package import absent from this project is a closed verdict.
  for (const sourceFile of sourceFiles) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const factory = requestHandlerFactoryForCall(call);
      if (!factory) continue;
      const args = call.getArguments();
      const literalDefinition = args.find((argument) => Node.isObjectLiteralExpression(argument));
      const definition =
        literalDefinition && Node.isObjectLiteralExpression(literalDefinition)
          ? literalDefinition
          : resolveStaticObjectLiteral(args[args.length - 1], new Set(), 0);
      if (!definition) {
        if (args.length > 0) {
          const candidate = args[args.length - 1]!;
          appendOpaqueRequestHandlerFact(
            context,
            candidate,
            opaqueBareModuleForExpression(candidate, new Set(), 0) ?? '<dynamic-config>',
          );
        }
        continue;
      }

      const property = definition.getProperty(factory.property);
      if (!property) {
        // A spread can hide the handler body. Runtime construction may accept it, so the security
        // proof must not pretend the request call graph is closed.
        if (definition.getProperties().some((entry) => Node.isSpreadAssignment(entry))) {
          appendOpaqueRequestHandlerFact(context, call, '<spread>');
        }
        continue;
      }

      if (Node.isMethodDeclaration(property)) {
        const body = property.getBody();
        if (body) {
          scanRequestCallable(
            { body, declaration: property, rootFactory: factory.exportName },
            context,
          );
        } else appendOpaqueRequestHandlerFact(context, property, '<missing-body>');
        continue;
      }

      const expression = requestHandlerPropertyExpression(property);
      if (!expression) {
        appendOpaqueRequestHandlerFact(context, property, '<dynamic-handler>');
        continue;
      }
      const resolution = resolveRequestCallable(expression, new Set(), 0);
      if (resolution.callables.length === 0) {
        appendOpaqueRequestHandlerFact(
          context,
          property,
          resolution.opaqueModule ?? '<unresolved-handler>',
        );
        continue;
      }
      for (const callable of resolution.callables) {
        scanRequestCallable({ ...callable, rootFactory: factory.exportName }, context);
      }
    }
  }

  return context.facts;
}

function requestHandlerFactoryForCall(
  call: Node,
): (typeof REQUEST_HANDLER_FACTORIES)[number] | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  return REQUEST_HANDLER_FACTORIES.find(({ exportName }) =>
    expressionResolvesToFrameworkExport(callee, frameworkExport('@kovojs/server', exportName), {
      legacyGlobals: [frameworkExport('@kovojs/server', exportName)],
    }),
  );
}

function requestHandlerPropertyExpression(property: Node): Node | undefined {
  if (Node.isPropertyAssignment(property)) return property.getInitializer();
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  return undefined;
}

function scanRequestCallable(callable: RequestCallable, context: RequestProcessScanContext): void {
  const key = `${callable.declaration.getSourceFile().getFilePath()}:${callable.declaration.getStart()}`;
  if (context.scanned.has(key)) return;
  context.scanned.add(key);

  const calls = [
    ...(Node.isCallExpression(callable.body) ? [callable.body] : []),
    ...callable.body.getDescendantsOfKind(SyntaxKind.CallExpression),
  ].filter((candidate) => nodeBelongsToRequestCallable(candidate, callable));
  for (const call of calls) {
    const rawAuthority = requestRawAuthorityForExpression(call.getExpression(), new Set(), 0);
    if (rawAuthority) {
      const [source] = call.getArguments();
      appendRequestAuthorityFact(context, call, rawAuthority, source);
      continue;
    }

    const timerAuthority = requestStringTimerAuthorityForCall(call);
    if (timerAuthority) {
      const [source] = call.getArguments();
      appendRequestAuthorityFact(context, call, timerAuthority, source);
      continue;
    }

    const moduleAuthority = requestModuleResolutionAuthorityForCall(call);
    if (moduleAuthority) {
      const [source] = call.getArguments();
      appendRequestAuthorityFact(context, call, moduleAuthority, source);
      continue;
    }

    const constructorAuthority = requestConstructorCodeAuthorityForExpression(call.getExpression());
    if (constructorAuthority) {
      const [source] = call.getArguments();
      appendRequestAuthorityFact(context, call, constructorAuthority, source);
      continue;
    }

    const frameworkAuthority = requestFrameworkAuthorityForExpression(call.getExpression());
    if (frameworkAuthority) {
      const [source] = call.getArguments();
      appendRequestAuthorityFact(context, call, frameworkAuthority, source);
      continue;
    }

    const dynamicFrameworkAuthority = requestFrameworkNamespaceEscapeForExpression(
      call.getExpression(),
    );
    if (dynamicFrameworkAuthority) {
      appendRequestAuthorityFact(context, call, dynamicFrameworkAuthority, call.getExpression());
      continue;
    }

    const dangerous = dangerousCallSink(call);
    if (dangerous) {
      context.facts.push({
        sink: dangerous.sink,
        safePath: dangerous.safePath,
        site: projectSiteFor(context.filesByPath, call),
        ...(dangerous.source ? { source: dangerous.source } : {}),
      });
      continue;
    }

    const callee = call.getExpression();
    if (callee.getKind() === SyntaxKind.ImportKeyword) {
      const [source] = call.getArguments();
      context.facts.push({
        sink: 'import()',
        safePath: 'use compiler-owned versioned handler imports only',
        site: projectSiteFor(context.filesByPath, call),
        ...(source ? { source: shortSource(source) } : {}),
      });
      continue;
    }
    if (unshadowedGlobalIdentifier(callee, 'Function')) {
      const [source] = call.getArguments();
      context.facts.push({
        sink: 'Function',
        safePath: 'remove dynamic code evaluation',
        site: projectSiteFor(context.filesByPath, call),
        ...(source ? { source: shortSource(source) } : {}),
      });
      continue;
    }

    // Exact framework authority minters were classified above. Other package calls terminate at
    // their imported implementation, while local same-named wrappers remain traversable. There is
    // deliberately no blanket "framework-owned means safe" exemption.
    const resolution = resolveRequestCallable(call.getExpression(), new Set(), 0);
    for (const nested of resolution.callables) scanRequestCallable(nested, context);
    if (resolution.callables.length === 0) {
      if (resolution.opaqueModule !== undefined) {
        context.facts.push({
          sink: 'request-handler.opaque-package-call',
          safePath:
            'keep request-reachable helper source inside the authoritative app snapshot or route process execution through runCommand(cmd(...))',
          site: projectSiteFor(context.filesByPath, call),
          source: resolution.opaqueModule,
        });
      } else if (!requestCallIsKnownSafe(call, callable, context)) {
        context.facts.push({
          sink: 'request-handler.opaque-call',
          safePath:
            'use an exact reviewed intrinsic or framework capability, or keep the callable source inside the authoritative app snapshot',
          site: projectSiteFor(context.filesByPath, call),
          source: shortSource(call.getExpression()),
        });
      }
    }
  }

  const constructs = [
    ...(Node.isNewExpression(callable.body) ? [callable.body] : []),
    ...callable.body.getDescendantsOfKind(SyntaxKind.NewExpression),
  ].filter((candidate) => nodeBelongsToRequestCallable(candidate, callable));
  for (const construct of constructs) {
    const callee = construct.getExpression();
    const [source] = construct.getArguments();
    if (unshadowedGlobalIdentifier(callee, 'Function')) {
      context.facts.push({
        sink: 'Function',
        safePath: 'remove dynamic code evaluation',
        site: projectSiteFor(context.filesByPath, construct),
        ...(source ? { source: shortSource(source) } : {}),
      });
      continue;
    }
    const rawAuthority = requestRawAuthorityForExpression(callee, new Set(), 0);
    if (rawAuthority) {
      appendRequestAuthorityFact(context, construct, rawAuthority, source);
      continue;
    }
    const constructorAuthority = requestConstructorCodeAuthorityForExpression(callee);
    if (constructorAuthority) {
      appendRequestAuthorityFact(context, construct, constructorAuthority, source);
      continue;
    }
    if (!requestConstructorIsKnownSafe(construct, callable, context)) {
      context.facts.push({
        sink: 'request-handler.opaque-constructor',
        safePath:
          'use an exact reviewed intrinsic constructor or keep the constructor source inside the authoritative app snapshot',
        site: projectSiteFor(context.filesByPath, construct),
        source: shortSource(callee),
      });
    }
  }

  // Security authority can escape without appearing as the direct callee: callbacks, .bind(),
  // Reflect.apply(), object/array storage, and computed namespace selection all preserve the same
  // capability. Classify the reference itself so a cosmetic invocation rewrite cannot bypass
  // KV424. Direct calls above win the same-line de-duplication and retain their argument source.
  const authorityReferences: Node[] = [
    ...(Node.isIdentifier(callable.body) ||
    Node.isPropertyAccessExpression(callable.body) ||
    Node.isElementAccessExpression(callable.body) ||
    Node.isCallExpression(callable.body)
      ? [callable.body]
      : []),
    ...callable.body.getDescendantsOfKind(SyntaxKind.Identifier),
    ...callable.body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
    ...callable.body.getDescendantsOfKind(SyntaxKind.ElementAccessExpression),
    ...callable.body.getDescendantsOfKind(SyntaxKind.CallExpression),
  ]
    .filter((candidate) => nodeBelongsToRequestCallable(candidate, callable))
    .sort((left, right) => left.getStart() - right.getStart() || left.getKind() - right.getKind());
  for (const reference of authorityReferences) {
    const rawAuthority = requestRawAuthorityForExpression(reference, new Set(), 0);
    if (rawAuthority) {
      appendRequestAuthorityFact(context, reference, rawAuthority, reference);
      continue;
    }
    const timerAuthority = requestEscapedTimerAuthorityForExpression(reference);
    if (timerAuthority) {
      appendRequestAuthorityFact(context, reference, timerAuthority, reference);
      continue;
    }
    const frameworkAuthority = requestFrameworkAuthorityForExpression(reference);
    if (frameworkAuthority) {
      appendRequestAuthorityFact(context, reference, frameworkAuthority, reference);
      continue;
    }
    const dynamicFrameworkAuthority = requestFrameworkNamespaceEscapeForExpression(reference);
    if (dynamicFrameworkAuthority) {
      appendRequestAuthorityFact(context, reference, dynamicFrameworkAuthority, reference);
      continue;
    }
    const namespaceAuthority = requestRawNamespaceAccessForExpression(reference);
    if (namespaceAuthority) {
      appendRequestAuthorityFact(context, reference, namespaceAuthority, reference);
    }
  }
}

function nodeBelongsToRequestCallable(node: Node, callable: RequestCallable): boolean {
  if (node === callable.body) return true;
  for (const ancestor of node.getAncestors()) {
    if (ancestor === callable.declaration) return true;
    if (requestCallableForFunctionNode(ancestor)) return false;
  }
  return false;
}

type RequestRootParameterRole = 'capability' | 'input' | 'request';

const REQUEST_SAFE_GLOBAL_CALLABLES = new Set([
  'BigInt',
  'Boolean',
  'Number',
  'String',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'structuredClone',
]);

const REQUEST_SAFE_GLOBAL_NAMESPACES = new Set([
  'Array',
  'BigInt',
  'Buffer',
  'Date',
  'Error',
  'JSON',
  'Math',
  'Number',
  'Object',
  'Promise',
  'Response',
  'String',
  'Symbol',
  'URL',
  'console',
  'crypto',
]);

const REQUEST_SAFE_GLOBAL_CONSTRUCTORS = new Set([
  'AbortController',
  'AggregateError',
  'Array',
  'ArrayBuffer',
  'BigInt64Array',
  'BigUint64Array',
  'Blob',
  'DataView',
  'Date',
  'Error',
  'EvalError',
  'File',
  'Float32Array',
  'Float64Array',
  'FormData',
  'Headers',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'Map',
  'Promise',
  'RangeError',
  'ReferenceError',
  'RegExp',
  'Request',
  'Response',
  'Set',
  'SyntaxError',
  'TextDecoder',
  'TextEncoder',
  'TypeError',
  'URIError',
  'URL',
  'URLSearchParams',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'WeakMap',
  'WeakSet',
]);

const REQUEST_SAFE_REQUEST_METHODS = new Set([
  'arrayBuffer',
  'blob',
  'clone',
  'entries',
  'formData',
  'get',
  'has',
  'json',
  'keys',
  'text',
  'values',
]);

const REQUEST_SAFE_JSON_VALUE_METHODS = new Set([
  'at',
  'charAt',
  'charCodeAt',
  'codePointAt',
  'concat',
  'endsWith',
  'entries',
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flat',
  'flatMap',
  'forEach',
  'includes',
  'indexOf',
  'join',
  'keys',
  'lastIndexOf',
  'localeCompare',
  'map',
  'match',
  'matchAll',
  'normalize',
  'padEnd',
  'padStart',
  'reduce',
  'reduceRight',
  'repeat',
  'replace',
  'replaceAll',
  'reverse',
  'slice',
  'some',
  'sort',
  'splice',
  'split',
  'startsWith',
  'substring',
  'substr',
  'toFixed',
  'toLocaleLowerCase',
  'toLocaleString',
  'toLocaleUpperCase',
  'toLowerCase',
  'toPrecision',
  'toReversed',
  'toSorted',
  'toSpliced',
  'toString',
  'toUpperCase',
  'trim',
  'trimEnd',
  'trimStart',
  'valueOf',
  'values',
  'with',
]);

const REQUEST_CALLBACK_ARGUMENTS = new Map<string, readonly number[]>([
  ['catch', [0]],
  ['every', [0]],
  ['filter', [0]],
  ['finally', [0]],
  ['find', [0]],
  ['findIndex', [0]],
  ['findLast', [0]],
  ['findLastIndex', [0]],
  ['flatMap', [0]],
  ['forEach', [0]],
  ['from', [1]],
  ['map', [0]],
  ['queueMicrotask', [0]],
  ['reduce', [0]],
  ['reduceRight', [0]],
  ['replace', [1]],
  ['replaceAll', [1]],
  ['setInterval', [0]],
  ['setTimeout', [0]],
  ['some', [0]],
  ['sort', [0]],
  ['then', [0, 1]],
  ['toSorted', [0]],
]);

function requestCallIsKnownSafe(
  call: import('ts-morph').CallExpression,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): boolean {
  const callee = unwrapStaticExpression(call.getExpression());
  const member = requestStaticCallMember(callee);
  const receiver = requestCallReceiver(callee);

  if (canonicalFrameworkExportForExpression(callee)) {
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (receiver && canonicalFrameworkExportForExpression(receiver)) {
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (requestImportedModuleExportForExpression(callee, isReviewedSafeBuiltinModule, new Set(), 0)) {
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (receiver && requestExpressionIsSafeBuiltinCapability(receiver, new Set(), 0)) {
    scanRequestFunctionArguments(call, context);
    return requestKnownCallbacksAreClosed(call, member, context);
  }
  if (receiver && requestExpressionContainsClosedAuthority(receiver, new Set(), 0)) {
    return true;
  }

  if (Node.isIdentifier(callee) && REQUEST_SAFE_GLOBAL_CALLABLES.has(callee.getText())) {
    if (!unshadowedGlobalIdentifier(callee, callee.getText())) return false;
    scanRequestFunctionArguments(call, context);
    return true;
  }
  for (const callbackGlobal of ['queueMicrotask', 'setInterval', 'setTimeout'] as const) {
    if (!expressionResolvesToGlobalCallable(callee, callbackGlobal, new Set(), 0)) continue;
    scanRequestFunctionArguments(call, context);
    return requestKnownCallbacksAreClosed(call, callbackGlobal, context);
  }

  if (!receiver || !member) return false;
  if (requestExpressionIsFrameworkCapability(receiver, new Set(), 0)) {
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (requestExpressionIsSafeGlobalNamespace(receiver)) {
    scanRequestFunctionArguments(call, context);
    return requestKnownCallbacksAreClosed(call, member, context);
  }

  const role = requestExpressionRootParameterRole(receiver, callable, new Set(), 0);
  if (role === 'capability') {
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (role === 'request' && REQUEST_SAFE_REQUEST_METHODS.has(member)) {
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (
    (role === 'input' || requestExpressionIsIntrinsicValue(receiver, callable, new Set(), 0)) &&
    REQUEST_SAFE_JSON_VALUE_METHODS.has(member)
  ) {
    scanRequestFunctionArguments(call, context);
    return requestKnownCallbacksAreClosed(call, member, context);
  }
  return false;
}

function requestExpressionContainsClosedAuthority(
  expression: Node,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 16) return false;
  const node = unwrapStaticExpression(expression);
  if (Node.isAwaitExpression(node)) {
    return requestExpressionContainsClosedAuthority(node.getExpression(), seen, depth + 1);
  }
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (
      requestRawAuthorityForExpression(callee, new Set(), 0) ||
      requestStringTimerAuthorityForCall(node) ||
      requestModuleResolutionAuthorityForCall(node) ||
      requestConstructorCodeAuthorityForExpression(callee) ||
      requestFrameworkAuthorityForExpression(callee) ||
      requestFrameworkNamespaceEscapeForExpression(callee) ||
      dangerousCallSink(node) ||
      callee.getKind() === SyntaxKind.ImportKeyword ||
      unshadowedGlobalIdentifier(callee, 'Function')
    ) {
      return true;
    }
    const receiver = requestCallReceiver(unwrapStaticExpression(callee));
    return receiver ? requestExpressionContainsClosedAuthority(receiver, seen, depth + 1) : false;
  }
  if (Node.isNewExpression(node)) {
    const callee = node.getExpression();
    return !!(
      requestRawAuthorityForExpression(callee, new Set(), 0) ||
      requestConstructorCodeAuthorityForExpression(callee) ||
      unshadowedGlobalIdentifier(callee, 'Function')
    );
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return requestExpressionContainsClosedAuthority(node.getExpression(), seen, depth + 1);
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  const declaration = localValueDeclaration(node);
  const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
  return initializer
    ? requestExpressionContainsClosedAuthority(initializer, seen, depth + 1)
    : false;
}

function requestConstructorIsKnownSafe(
  construct: import('ts-morph').NewExpression,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): boolean {
  const callee = unwrapStaticExpression(construct.getExpression());
  const resolution = resolveRequestCallable(callee, new Set(), 0);
  if (resolution.callables.length > 0) {
    for (const nested of resolution.callables) scanRequestCallable(nested, context);
    return true;
  }
  if (canonicalFrameworkExportForExpression(callee)) {
    scanRequestFunctionArguments(construct, context);
    return true;
  }
  if (requestImportedModuleExportForExpression(callee, isReviewedSafeBuiltinModule, new Set(), 0)) {
    scanRequestFunctionArguments(construct, context);
    return true;
  }
  if (
    Node.isIdentifier(callee) &&
    REQUEST_SAFE_GLOBAL_CONSTRUCTORS.has(callee.getText()) &&
    unshadowedGlobalIdentifier(callee, callee.getText())
  ) {
    scanRequestFunctionArguments(construct, context);
    return (
      callee.getText() !== 'Promise' || requestKnownCallbacksAreClosed(construct, 'then', context)
    );
  }
  return requestKnownLocalClassConstructorIsClosed(callee, callable, context);
}

function requestKnownLocalClassConstructorIsClosed(
  callee: Node,
  _callable: RequestCallable,
  context: RequestProcessScanContext,
): boolean {
  const declarations = callee.getSymbol()?.getDeclarations() ?? [];
  let sawClass = false;
  for (const declaration of declarations) {
    if (!Node.isClassDeclaration(declaration) && !Node.isClassExpression(declaration)) continue;
    sawClass = true;
    if (declaration.getExtends()) return false;
    for (const constructor of declaration.getConstructors()) {
      const body = constructor.getBody();
      if (body) scanRequestCallable({ body, declaration: constructor }, context);
    }
  }
  return sawClass;
}

function scanRequestFunctionArguments(
  expression: import('ts-morph').CallExpression | import('ts-morph').NewExpression,
  context: RequestProcessScanContext,
): void {
  for (const argument of expression.getArguments()) {
    const resolution = resolveRequestCallable(argument, new Set(), 0);
    for (const nested of resolution.callables) scanRequestCallable(nested, context);
  }
}

function requestKnownCallbacksAreClosed(
  expression: import('ts-morph').CallExpression | import('ts-morph').NewExpression,
  member: string | undefined,
  context: RequestProcessScanContext,
): boolean {
  if (!member) return true;
  const indexes = REQUEST_CALLBACK_ARGUMENTS.get(member);
  if (!indexes) return true;
  const args = expression.getArguments();
  for (const index of indexes) {
    const callback = args[index];
    if (!callback) continue;
    const resolution = resolveRequestCallable(callback, new Set(), 0);
    if (resolution.callables.length > 0) {
      for (const nested of resolution.callables) scanRequestCallable(nested, context);
      continue;
    }
    if (
      Node.isIdentifier(callback) &&
      REQUEST_SAFE_GLOBAL_CALLABLES.has(callback.getText()) &&
      unshadowedGlobalIdentifier(callback, callback.getText())
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function requestStaticCallMember(callee: Node): string | undefined {
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  if (Node.isElementAccessExpression(callee)) {
    return staticMemberName(callee.getArgumentExpression());
  }
  return undefined;
}

function requestCallReceiver(callee: Node): Node | undefined {
  return Node.isPropertyAccessExpression(callee) || Node.isElementAccessExpression(callee)
    ? callee.getExpression()
    : undefined;
}

function requestExpressionRootParameterRole(
  expression: Node,
  callable: RequestCallable,
  seen: Set<string>,
  depth: number,
): RequestRootParameterRole | undefined {
  if (!callable.rootFactory || depth > 16) return undefined;
  const node = unwrapStaticExpression(expression);
  if (Node.isAwaitExpression(node)) {
    return requestExpressionRootParameterRole(node.getExpression(), callable, seen, depth + 1);
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return requestExpressionRootParameterRole(node.getExpression(), callable, seen, depth + 1);
  }
  if (Node.isCallExpression(node)) {
    const receiver = requestCallReceiver(unwrapStaticExpression(node.getExpression()));
    return receiver
      ? requestExpressionRootParameterRole(receiver, callable, seen, depth + 1)
      : undefined;
  }
  if (!Node.isIdentifier(node)) return undefined;

  const parameters = requestCallableParameters(callable.declaration);
  const symbol = node.getSymbol();
  for (const [index, parameter] of parameters.entries()) {
    const name = parameter.getNameNode();
    if (
      Node.isIdentifier(name) &&
      ((symbol && name.getSymbol() === symbol) || (!symbol && name.getText() === node.getText()))
    ) {
      return requestRootParameterRole(callable.rootFactory, index);
    }
  }

  const declaration = localValueDeclaration(node);
  const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
  if (!initializer) return undefined;
  const declarationSymbol = node.getSymbol();
  if (declarationSymbol) {
    const key = requestSymbolKey(declarationSymbol);
    if (seen.has(key)) return undefined;
    seen.add(key);
  }
  return requestExpressionRootParameterRole(initializer, callable, seen, depth + 1);
}

function requestCallableParameters(declaration: Node) {
  if (
    Node.isArrowFunction(declaration) ||
    Node.isFunctionExpression(declaration) ||
    Node.isFunctionDeclaration(declaration) ||
    Node.isMethodDeclaration(declaration) ||
    Node.isConstructorDeclaration(declaration)
  ) {
    return declaration.getParameters();
  }
  return [];
}

function requestRootParameterRole(
  factory: NonNullable<RequestCallable['rootFactory']>,
  index: number,
): RequestRootParameterRole {
  if (factory === 'endpoint') return index === 0 ? 'request' : 'capability';
  if (factory === 'mutation') {
    if (index === 0) return 'input';
    return index === 1 ? 'request' : 'capability';
  }
  return index === 0 ? 'input' : 'capability';
}

function requestExpressionIsFrameworkCapability(
  expression: Node,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 16) return false;
  const node = unwrapStaticExpression(expression);
  if (canonicalFrameworkExportForExpression(node)) return true;
  if (Node.isAwaitExpression(node)) {
    return requestExpressionIsFrameworkCapability(node.getExpression(), seen, depth + 1);
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return requestExpressionIsFrameworkCapability(node.getExpression(), seen, depth + 1);
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    if (canonicalFrameworkExportForExpression(callee)) return true;
    const receiver = requestCallReceiver(callee);
    return receiver ? requestExpressionIsFrameworkCapability(receiver, seen, depth + 1) : false;
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  const declaration = localValueDeclaration(node);
  const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
  return initializer ? requestExpressionIsFrameworkCapability(initializer, seen, depth + 1) : false;
}

function requestExpressionIsSafeBuiltinCapability(
  expression: Node,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 16) return false;
  const node = unwrapStaticExpression(expression);
  if (requestImportedModuleExportForExpression(node, isReviewedSafeBuiltinModule, new Set(), 0)) {
    return true;
  }
  if (
    expressionResolvesToModuleNamespace(node, isReviewedSafeBuiltinModule, new Set(), depth + 1)
  ) {
    return true;
  }
  if (Node.isAwaitExpression(node)) {
    return requestExpressionIsSafeBuiltinCapability(node.getExpression(), seen, depth + 1);
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return requestExpressionIsSafeBuiltinCapability(node.getExpression(), seen, depth + 1);
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    if (
      requestImportedModuleExportForExpression(callee, isReviewedSafeBuiltinModule, new Set(), 0)
    ) {
      return true;
    }
    const receiver = requestCallReceiver(callee);
    return receiver ? requestExpressionIsSafeBuiltinCapability(receiver, seen, depth + 1) : false;
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  const declaration = localValueDeclaration(node);
  const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
  return initializer
    ? requestExpressionIsSafeBuiltinCapability(initializer, seen, depth + 1)
    : false;
}

function requestExpressionIsSafeGlobalNamespace(expression: Node): boolean {
  const node = unwrapStaticExpression(expression);
  if (Node.isIdentifier(node)) {
    return (
      REQUEST_SAFE_GLOBAL_NAMESPACES.has(node.getText()) &&
      unshadowedGlobalIdentifier(node, node.getText())
    );
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? node.getName()
      : staticMemberName(node.getArgumentExpression());
    return (
      !!member &&
      REQUEST_SAFE_GLOBAL_NAMESPACES.has(member) &&
      (unshadowedGlobalIdentifier(node.getExpression(), 'globalThis') ||
        unshadowedGlobalIdentifier(node.getExpression(), 'global'))
    );
  }
  return false;
}

function requestExpressionIsIntrinsicValue(
  expression: Node,
  callable: RequestCallable,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 16) return false;
  const node = unwrapStaticExpression(expression);
  if (
    Node.isArrayLiteralExpression(node) ||
    Node.isObjectLiteralExpression(node) ||
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isTemplateExpression(node) ||
    Node.isNumericLiteral(node) ||
    Node.isRegularExpressionLiteral(node) ||
    Node.isTrueLiteral(node) ||
    Node.isFalseLiteral(node) ||
    Node.isBinaryExpression(node)
  ) {
    return true;
  }
  if (Node.isAwaitExpression(node)) {
    return requestExpressionIsIntrinsicValue(node.getExpression(), callable, seen, depth + 1);
  }
  if (Node.isNewExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    return (
      Node.isIdentifier(callee) &&
      REQUEST_SAFE_GLOBAL_CONSTRUCTORS.has(callee.getText()) &&
      unshadowedGlobalIdentifier(callee, callee.getText())
    );
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    if (
      Node.isIdentifier(callee) &&
      REQUEST_SAFE_GLOBAL_CALLABLES.has(callee.getText()) &&
      unshadowedGlobalIdentifier(callee, callee.getText())
    ) {
      return true;
    }
    const receiver = requestCallReceiver(callee);
    return !!receiver && requestExpressionIsSafeGlobalNamespace(receiver);
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return requestExpressionIsIntrinsicValue(node.getExpression(), callable, seen, depth + 1);
  }
  if (!Node.isIdentifier(node)) return false;
  if (requestExpressionRootParameterRole(node, callable, new Set(), depth + 1) === 'input') {
    return true;
  }
  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  const declaration = localValueDeclaration(node);
  const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
  return initializer
    ? requestExpressionIsIntrinsicValue(initializer, callable, seen, depth + 1)
    : false;
}

interface RequestRawAuthority {
  readonly sink: string;
  readonly safePath: string;
}

function requestStringTimerAuthorityForCall(call: Node): RequestRawAuthority | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const [callback] = call.getArguments();
  if (callback) {
    if (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)) return undefined;
    const resolution = resolveRequestCallable(callback, new Set(), 0);
    if (resolution.callables.length > 0) return undefined;
  }
  for (const timer of ['setInterval', 'setTimeout'] as const) {
    if (expressionResolvesToGlobalCallable(call.getExpression(), timer, new Set(), 0)) {
      return {
        sink: timer,
        safePath: `${timer}(fn, ...) with a statically resolved function callback`,
      };
    }
  }
  return undefined;
}

function requestEscapedTimerAuthorityForExpression(
  expression: Node,
): RequestRawAuthority | undefined {
  const node = unwrapStaticExpression(expression);
  const parent = node.getParent();
  if (
    parent &&
    (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) &&
    parent.getInitializer() === node
  ) {
    return undefined;
  }

  for (const timer of ['setInterval', 'setTimeout'] as const) {
    if (!expressionResolvesToGlobalCallable(node, timer, new Set(), 0)) continue;
    if (parent && Node.isCallExpression(parent) && parent.getExpression() === node) {
      const [callback] = parent.getArguments();
      if (callback) {
        if (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)) return undefined;
        if (resolveRequestCallable(callback, new Set(), 0).callables.length > 0) return undefined;
      }
    }
    return {
      sink: timer,
      safePath: `${timer}(fn, ...) with a statically resolved function callback`,
    };
  }
  return undefined;
}

function requestConstructorCodeAuthorityForExpression(
  expression: Node,
): RequestRawAuthority | undefined {
  const node = unwrapStaticExpression(expression);
  if (Node.isPropertyAccessExpression(node) && node.getName() === 'constructor') {
    return { sink: 'Function.constructor', safePath: REQUEST_DYNAMIC_CODE_SAFE_PATH };
  }
  if (
    Node.isElementAccessExpression(node) &&
    staticMemberName(node.getArgumentExpression()) === 'constructor'
  ) {
    return { sink: 'Function.constructor', safePath: REQUEST_DYNAMIC_CODE_SAFE_PATH };
  }
  return undefined;
}

function requestModuleResolutionAuthorityForCall(call: Node): RequestRawAuthority | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  if (
    requestGlobalNamespaceMethodForExpression(
      callee,
      'process',
      REQUEST_PROCESS_MODULE_METHODS,
      new Set(),
      0,
    ) ||
    expressionResolvesToGlobalCallable(callee, 'require', new Set(), 0) ||
    requestModuleMethodForExpression(
      callee,
      isNodeModuleModule,
      REQUEST_CREATE_REQUIRE_METHODS,
      new Set(),
      0,
    ) ||
    expressionResolvesToCreatedRequire(callee, new Set(), 0)
  ) {
    return {
      sink: 'node:module.dynamic-resolution',
      safePath: 'use static module-scope imports; request-reachable module resolution is forbidden',
    };
  }
  return undefined;
}

function expressionResolvesToCreatedRequire(
  expression: Node,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 16) return false;
  const node = unwrapStaticExpression(expression);
  if (Node.isCallExpression(node)) {
    return !!requestModuleMethodForExpression(
      node.getExpression(),
      isNodeModuleModule,
      REQUEST_CREATE_REQUIRE_METHODS,
      new Set(),
      depth + 1,
    );
  }

  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return false;
    seen.add(key);
    for (const declaration of symbol.getDeclarations()) {
      const initializer = valueDeclarationInitializer(declaration);
      if (initializer && expressionResolvesToCreatedRequire(initializer, seen, depth + 1)) {
        return true;
      }
    }
  }
  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) return expressionResolvesToCreatedRequire(initializer, seen, depth + 1);
  }
  return false;
}

function appendRequestAuthorityFact(
  context: RequestProcessScanContext,
  siteNode: Node,
  authority: RequestRawAuthority,
  source?: Node,
): void {
  const site = projectSiteFor(context.filesByPath, siteNode);
  if (context.facts.some((fact) => fact.sink === authority.sink && fact.site === site)) return;
  context.facts.push({
    sink: authority.sink,
    safePath: authority.safePath,
    site,
    ...(source ? { source: shortSource(source) } : {}),
  });
}

function appendOpaqueRequestHandlerFact(
  context: RequestProcessScanContext,
  siteNode: Node,
  source: string,
): void {
  context.facts.push({
    sink: 'request-handler.opaque-source',
    safePath:
      'keep request handler source inside the authoritative app snapshot; use runCommand(cmd(...)) for process execution',
    site: projectSiteFor(context.filesByPath, siteNode),
    source,
  });
}

function projectSiteFor(
  filesByPath: ReadonlyMap<string, TrustEscapeSourceFileInput>,
  node: Node,
): string {
  const sourceFile = node.getSourceFile();
  const input = filesByPath.get(sourceFile.getFilePath());
  return input
    ? siteFor(input, node)
    : `${sourceFile.getFilePath()}:${sourceFile.getLineAndColumnAtPos(node.getStart()).line}`;
}

function resolveStaticObjectLiteral(
  expression: Node | undefined,
  seen: Set<string>,
  depth: number,
): import('ts-morph').ObjectLiteralExpression | undefined {
  if (!expression || depth > 16) return undefined;
  const node = unwrapStaticExpression(expression);
  if (Node.isObjectLiteralExpression(node)) return node;

  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (!seen.has(key)) {
      seen.add(key);
      try {
        const aliased = symbol.getAliasedSymbol();
        if (aliased && aliased !== symbol) {
          for (const declaration of aliased.getDeclarations()) {
            const initializer = valueDeclarationInitializer(declaration);
            const resolved = resolveStaticObjectLiteral(initializer, seen, depth + 1);
            if (resolved) return resolved;
          }
        }
      } catch {
        // The caller emits an opaque-source fact when the alias remains unresolved.
      }
      for (const declaration of symbol.getDeclarations()) {
        const initializer = valueDeclarationInitializer(declaration);
        const resolved = resolveStaticObjectLiteral(initializer, seen, depth + 1);
        if (resolved) return resolved;
      }
    }
  }
  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    return resolveStaticObjectLiteral(initializer, seen, depth + 1);
  }
  return undefined;
}

function resolveRequestCallable(
  expression: Node,
  seen: Set<string>,
  depth: number,
): RequestCallableResolution {
  if (depth > 16) return { callables: [] };
  const node = unwrapStaticExpression(expression);
  const direct = requestCallableForFunctionNode(node);
  if (direct) return { callables: [direct] };

  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (
      Node.isPropertyAccessExpression(callee) &&
      (callee.getName() === 'bind' || callee.getName() === 'call' || callee.getName() === 'apply')
    ) {
      return resolveRequestCallable(callee.getExpression(), seen, depth + 1);
    }

    const factory = resolveRequestCallable(callee, new Set(seen), depth + 1);
    const returned: RequestCallable[] = [];
    let opaqueModule = factory.opaqueModule;
    for (const callable of factory.callables) {
      const direct = requestCallableForFunctionNode(callable.body);
      if (direct) returned.push(direct);
      for (const statement of callable.body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
        const expression = statement.getExpression();
        if (!expression) continue;
        const resolution = resolveRequestCallable(expression, new Set(seen), depth + 1);
        returned.push(...resolution.callables);
        opaqueModule ??= resolution.opaqueModule;
      }
    }
    if (returned.length > 0 || opaqueModule !== undefined) {
      return { callables: returned, ...optionalOpaqueModule(opaqueModule) };
    }
  }

  const symbol = node.getSymbol();
  const fromSymbol = resolveRequestCallableSymbol(symbol, seen, depth + 1);
  if (fromSymbol.callables.length > 0 || fromSymbol.opaqueModule !== undefined) return fromSymbol;

  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    if (declaration) {
      const fromDeclaration = resolveRequestCallableDeclaration(declaration, seen, depth + 1);
      if (fromDeclaration.callables.length > 0 || fromDeclaration.opaqueModule !== undefined) {
        return fromDeclaration;
      }
    }
  }

  return {
    callables: [],
    ...optionalOpaqueModule(opaqueBareModuleForExpression(node, new Set(), 0)),
  };
}

function resolveRequestCallableSymbol(
  symbol: ReturnType<Node['getSymbol']>,
  seen: Set<string>,
  depth: number,
): RequestCallableResolution {
  if (!symbol || depth > 16) return { callables: [] };
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return { callables: [] };
  seen.add(key);

  try {
    const aliased = symbol.getAliasedSymbol();
    if (aliased && aliased !== symbol) {
      const resolved = resolveRequestCallableSymbol(aliased, seen, depth + 1);
      if (resolved.callables.length > 0 || resolved.opaqueModule !== undefined) return resolved;
    }
  } catch {
    // An unresolved alias is handled from its import declaration below and fails closed for a
    // bare package instead of being treated as safe.
  }

  let opaqueModule: string | undefined;
  const callables: RequestCallable[] = [];
  for (const declaration of symbol.getDeclarations()) {
    const resolved = resolveRequestCallableDeclaration(declaration, seen, depth + 1);
    callables.push(...resolved.callables);
    opaqueModule ??= resolved.opaqueModule;
  }
  return { callables, ...optionalOpaqueModule(opaqueModule) };
}

function resolveRequestCallableDeclaration(
  declaration: Node,
  seen: Set<string>,
  depth: number,
): RequestCallableResolution {
  const direct = requestCallableForFunctionNode(declaration);
  if (direct) return { callables: [direct] };

  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer ? resolveRequestCallable(initializer, seen, depth + 1) : { callables: [] };
  }
  if (Node.isPropertyAssignment(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer ? resolveRequestCallable(initializer, seen, depth + 1) : { callables: [] };
  }
  if (Node.isShorthandPropertyAssignment(declaration)) {
    return resolveRequestCallable(declaration.getNameNode(), seen, depth + 1);
  }
  if (Node.isBindingElement(declaration)) {
    const initializer = bindingElementSourceExpression(declaration);
    return initializer ? resolveRequestCallable(initializer, seen, depth + 1) : { callables: [] };
  }
  if (Node.isImportSpecifier(declaration)) {
    const module = declaration.getImportDeclaration().getModuleSpecifierValue();
    return isOpaqueBareModule(module) ? { callables: [], opaqueModule: module } : { callables: [] };
  }
  if (Node.isNamespaceImport(declaration) || Node.isImportClause(declaration)) {
    const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    const module = importDeclaration?.getModuleSpecifierValue();
    return module && isOpaqueBareModule(module)
      ? { callables: [], opaqueModule: module }
      : { callables: [] };
  }
  if (Node.isExportSpecifier(declaration)) {
    const exportDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ExportDeclaration);
    const module = exportDeclaration?.getModuleSpecifierValue();
    return module && isOpaqueBareModule(module)
      ? { callables: [], opaqueModule: module }
      : { callables: [] };
  }
  return { callables: [] };
}

function requestCallableForFunctionNode(node: Node): RequestCallable | undefined {
  if (
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node)
  ) {
    const body = node.getBody();
    return body ? { body, declaration: node } : undefined;
  }
  return undefined;
}

function requestProcessMethodForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
): string | undefined {
  return requestModuleMethodForExpression(
    expression,
    isProcessModule,
    REQUEST_PROCESS_METHODS,
    seen,
    depth,
  );
}

function requestVmMethodForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
): string | undefined {
  return requestModuleMethodForExpression(expression, isVmModule, REQUEST_VM_METHODS, seen, depth);
}

function requestFilesystemMethodForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
): string | undefined {
  return requestModuleMethodForExpression(
    expression,
    isFilesystemModule,
    REQUEST_FILESYSTEM_METHODS,
    seen,
    depth,
  );
}

function requestPathMethodForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
): string | undefined {
  return requestModuleMethodForExpression(
    expression,
    isPathModule,
    REQUEST_PATH_METHODS,
    seen,
    depth,
  );
}

function requestWorkerMethodForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
): string | undefined {
  return requestModuleMethodForExpression(
    expression,
    isWorkerModule,
    REQUEST_WORKER_METHODS,
    seen,
    depth,
  );
}

function requestClusterMethodForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
): string | undefined {
  return requestModuleMethodForExpression(
    expression,
    isClusterModule,
    REQUEST_CLUSTER_METHODS,
    seen,
    depth,
  );
}

function requestRawAuthorityForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
): RequestRawAuthority | undefined {
  if (expressionResolvesToGlobalCallable(expression, 'eval', new Set(seen), depth)) {
    return { sink: 'eval', safePath: REQUEST_DYNAMIC_CODE_SAFE_PATH };
  }
  if (expressionResolvesToGlobalCallable(expression, 'Function', new Set(seen), depth)) {
    return { sink: 'Function', safePath: REQUEST_DYNAMIC_CODE_SAFE_PATH };
  }
  const processMethod = requestProcessMethodForExpression(expression, new Set(seen), depth);
  if (processMethod) {
    return { sink: `child_process.${processMethod}`, safePath: REQUEST_PROCESS_SAFE_PATH };
  }
  const processExport = requestClosedModuleExportForExpression(
    expression,
    isProcessModule,
    REQUEST_NO_INERT_EXPORTS,
    new Set(seen),
    depth,
  );
  if (processExport) {
    return { sink: `child_process.${processExport}`, safePath: REQUEST_PROCESS_SAFE_PATH };
  }
  const filesystemMethod = requestFilesystemMethodForExpression(expression, new Set(seen), depth);
  if (filesystemMethod) {
    return {
      sink: `node:fs.${filesystemMethod}`,
      safePath: REQUEST_FILESYSTEM_SAFE_PATH,
    };
  }
  const filesystemExport = requestClosedModuleExportForExpression(
    expression,
    isFilesystemModule,
    REQUEST_FILESYSTEM_INERT_EXPORTS,
    new Set(seen),
    depth,
  );
  if (filesystemExport) {
    return { sink: `node:fs.${filesystemExport}`, safePath: REQUEST_FILESYSTEM_SAFE_PATH };
  }
  const pathMethod = requestPathMethodForExpression(expression, new Set(seen), depth);
  if (pathMethod) {
    return { sink: `node:path.${pathMethod}`, safePath: REQUEST_FILESYSTEM_SAFE_PATH };
  }
  const pathExport = requestClosedModuleExportForExpression(
    expression,
    isPathModule,
    REQUEST_PATH_INERT_EXPORTS,
    new Set(seen),
    depth,
  );
  if (pathExport) {
    return { sink: `node:path.${pathExport}`, safePath: REQUEST_FILESYSTEM_SAFE_PATH };
  }
  const vmMethod = requestVmMethodForExpression(expression, new Set(seen), depth);
  if (vmMethod) {
    return { sink: `node:vm.${vmMethod}`, safePath: REQUEST_DYNAMIC_CODE_SAFE_PATH };
  }
  const vmExport = requestClosedModuleExportForExpression(
    expression,
    isVmModule,
    REQUEST_NO_INERT_EXPORTS,
    new Set(seen),
    depth,
  );
  if (vmExport) {
    return { sink: `node:vm.${vmExport}`, safePath: REQUEST_DYNAMIC_CODE_SAFE_PATH };
  }
  const nodeProcessExport = requestClosedModuleExportForExpression(
    expression,
    isNodeProcessModule,
    REQUEST_NODE_PROCESS_INERT_EXPORTS,
    new Set(seen),
    depth,
  );
  if (nodeProcessExport) {
    return {
      sink: `node:process.${nodeProcessExport}`,
      safePath: 'remove request-reachable process-global authority',
    };
  }
  const workerMethod = requestWorkerMethodForExpression(expression, new Set(seen), depth);
  if (workerMethod) {
    return {
      sink: `node:worker_threads.${workerMethod}`,
      safePath: REQUEST_DYNAMIC_CODE_SAFE_PATH,
    };
  }
  const clusterMethod = requestClusterMethodForExpression(expression, new Set(seen), depth);
  if (clusterMethod) {
    return { sink: `node:cluster.${clusterMethod}`, safePath: REQUEST_PROCESS_SAFE_PATH };
  }
  const globalProcessMethod = requestGlobalNamespaceMethodForExpression(
    expression,
    'process',
    REQUEST_PROCESS_GLOBAL_METHODS,
    new Set(seen),
    depth,
  );
  if (globalProcessMethod) {
    return {
      sink: `node:process.${globalProcessMethod}`,
      safePath: 'remove request-reachable process-global authority',
    };
  }
  const unreviewedBuiltin = requestImportedModuleExportForExpression(
    expression,
    isUnreviewedRequestBuiltinModule,
    new Set(seen),
    depth,
  );
  if (unreviewedBuiltin) {
    return {
      sink: `node:${normalizeBuiltinModuleSpecifier(unreviewedBuiltin.module)}.${unreviewedBuiltin.exportName}`,
      safePath:
        'use an explicitly reviewed safe builtin or a Kovo capability; unreviewed request-reachable Node builtins are forbidden',
    };
  }
  const bunMethod = requestGlobalNamespaceMethodForExpression(
    expression,
    'Bun',
    REQUEST_BUN_PROCESS_METHODS,
    new Set(seen),
    depth,
  );
  if (bunMethod) {
    return {
      sink: `Bun.${bunMethod}`,
      safePath:
        bunMethod === 'file' || bunMethod === 'write'
          ? REQUEST_FILESYSTEM_SAFE_PATH
          : REQUEST_PROCESS_SAFE_PATH,
    };
  }
  const denoMethod = requestGlobalNamespaceMethodForExpression(
    expression,
    'Deno',
    REQUEST_DENO_PROCESS_METHODS,
    new Set(seen),
    depth,
  );
  return denoMethod
    ? {
        sink: `Deno.${denoMethod}`,
        safePath:
          denoMethod === 'Command' || denoMethod === 'run'
            ? REQUEST_PROCESS_SAFE_PATH
            : REQUEST_FILESYSTEM_SAFE_PATH,
      }
    : undefined;
}

function expressionResolvesToGlobalCallable(
  expression: Node,
  globalName: string,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 16) return false;
  const node = unwrapStaticExpression(expression);
  if (unshadowedGlobalIdentifier(node, globalName)) return true;
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? node.getName()
      : staticMemberName(node.getArgumentExpression());
    if (
      member === globalName &&
      (unshadowedGlobalIdentifier(node.getExpression(), 'globalThis') ||
        unshadowedGlobalIdentifier(node.getExpression(), 'global'))
    ) {
      return true;
    }
  }

  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'bind') {
      return expressionResolvesToGlobalCallable(
        callee.getExpression(),
        globalName,
        seen,
        depth + 1,
      );
    }
  }
  if (
    Node.isBinaryExpression(node) &&
    node.getOperatorToken().getKind() === SyntaxKind.CommaToken
  ) {
    return expressionResolvesToGlobalCallable(node.getRight(), globalName, seen, depth + 1);
  }

  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return false;
    seen.add(key);
    for (const declaration of symbol.getDeclarations()) {
      const initializer = valueDeclarationInitializer(declaration);
      if (
        initializer &&
        expressionResolvesToGlobalCallable(initializer, globalName, seen, depth + 1)
      ) {
        return true;
      }
    }
  }
  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      return expressionResolvesToGlobalCallable(initializer, globalName, seen, depth + 1);
    }
  }
  return false;
}

function requestFrameworkAuthorityForExpression(expression: Node): RequestRawAuthority | undefined {
  const identity = canonicalFrameworkExportForExpression(expression);
  if (!identity) return undefined;
  const minter = REQUEST_FRAMEWORK_AUTHORITY_MINTERS.find(
    (candidate) =>
      candidate.module === identity.module && candidate.exportName === identity.exportName,
  );
  return minter ? { sink: minter.sink, safePath: minter.safePath } : undefined;
}

function requestFrameworkNamespaceEscapeForExpression(
  expression: Node,
): RequestRawAuthority | undefined {
  const node = unwrapStaticExpression(expression);
  if (isReceiverOfMemberAccess(node)) return undefined;

  const dynamicModule = dynamicFrameworkNamespaceModuleForExpression(node, new Set(), 0);
  if (dynamicModule) {
    return {
      sink: `${dynamicModule}.[computed]`,
      safePath:
        'use an exact framework export identity; request-selected framework authority is forbidden',
    };
  }

  const namespaceModule = frameworkNamespaceModuleForExpression(node, new Set(), 0);
  return namespaceModule
    ? {
        sink: `${namespaceModule}.namespace`,
        safePath:
          'use an exact framework export identity; do not pass a framework namespace through request code',
      }
    : undefined;
}

function dynamicFrameworkNamespaceModuleForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
): string | undefined {
  if (depth > 16) return undefined;
  const node = unwrapStaticExpression(expression);
  if (Node.isElementAccessExpression(node) && !staticMemberName(node.getArgumentExpression())) {
    return frameworkNamespaceModuleForExpression(node.getExpression(), new Set(), depth + 1);
  }

  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return undefined;
    seen.add(key);
    for (const declaration of symbol.getDeclarations()) {
      const initializer = valueDeclarationInitializer(declaration);
      if (initializer) {
        const module = dynamicFrameworkNamespaceModuleForExpression(initializer, seen, depth + 1);
        if (module) return module;
      }
    }
  }
  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      return dynamicFrameworkNamespaceModuleForExpression(initializer, seen, depth + 1);
    }
  }
  return undefined;
}

function frameworkNamespaceModuleForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
): string | undefined {
  if (depth > 16) return undefined;
  const node = unwrapStaticExpression(expression);
  if (Node.isCallExpression(node) && isStaticRequireOf(node, isFrameworkModuleSpecifier)) {
    const [specifier] = node.getArguments();
    return specifier && isStringLiteralLike(specifier) ? specifier.getLiteralText() : undefined;
  }

  if (Node.isIdentifier(node)) {
    const local = node.getText();
    for (const declaration of node.getSourceFile().getImportDeclarations()) {
      const module = declaration.getModuleSpecifierValue();
      if (!isFrameworkModuleSpecifier(module)) continue;
      if (declaration.getNamespaceImport()?.getText() === local) return module;
      if (declaration.getDefaultImport()?.getText() === local) return module;
    }
  }

  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return undefined;
    seen.add(key);
    for (const declaration of symbol.getDeclarations()) {
      if (Node.isNamespaceImport(declaration) || Node.isImportClause(declaration)) {
        const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
        const module = importDeclaration?.getModuleSpecifierValue();
        if (module && isFrameworkModuleSpecifier(module)) return module;
      }
      const initializer = valueDeclarationInitializer(declaration);
      if (initializer) {
        const module = frameworkNamespaceModuleForExpression(initializer, seen, depth + 1);
        if (module) return module;
      }
    }
  }
  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      return frameworkNamespaceModuleForExpression(initializer, seen, depth + 1);
    }
  }
  return undefined;
}

function isFrameworkModuleSpecifier(specifier: string): boolean {
  return specifier.startsWith('@kovojs/');
}

function requestGlobalNamespaceMethodForExpression(
  expression: Node,
  namespace: string,
  methods: ReadonlySet<string>,
  seen: Set<string>,
  depth: number,
): string | undefined {
  if (depth > 16) return undefined;
  const node = unwrapStaticExpression(expression);

  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'bind') {
      return requestGlobalNamespaceMethodForExpression(
        callee.getExpression(),
        namespace,
        methods,
        seen,
        depth + 1,
      );
    }
  }

  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? node.getName()
      : staticMemberName(node.getArgumentExpression());
    if (
      member &&
      methods.has(member) &&
      expressionResolvesToGlobalNamespace(node.getExpression(), namespace, new Set(), depth + 1)
    ) {
      return member;
    }
  }

  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (!seen.has(key)) {
      seen.add(key);
      for (const declaration of symbol.getDeclarations()) {
        const initializer = valueDeclarationInitializer(declaration);
        if (initializer) {
          const resolved = requestGlobalNamespaceMethodForExpression(
            initializer,
            namespace,
            methods,
            seen,
            depth + 1,
          );
          if (resolved) return resolved;
        }
        if (Node.isBindingElement(declaration)) {
          const member = staticMemberName(
            declaration.getPropertyNameNode() ?? declaration.getNameNode(),
          );
          const source = bindingElementSourceExpression(declaration);
          if (
            member &&
            methods.has(member) &&
            source &&
            expressionResolvesToGlobalNamespace(source, namespace, new Set(), depth + 1)
          ) {
            return member;
          }
        }
      }
    }
  }

  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      return requestGlobalNamespaceMethodForExpression(
        initializer,
        namespace,
        methods,
        seen,
        depth + 1,
      );
    }
  }
  return undefined;
}

function expressionResolvesToGlobalNamespace(
  expression: Node,
  namespace: string,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 16) return false;
  const node = unwrapStaticExpression(expression);
  if (unshadowedGlobalIdentifier(node, namespace)) return true;
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? node.getName()
      : staticMemberName(node.getArgumentExpression());
    if (
      member === namespace &&
      (unshadowedGlobalIdentifier(node.getExpression(), 'globalThis') ||
        unshadowedGlobalIdentifier(node.getExpression(), 'global'))
    ) {
      return true;
    }
  }

  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return false;
    seen.add(key);
    for (const declaration of symbol.getDeclarations()) {
      const initializer = valueDeclarationInitializer(declaration);
      if (
        initializer &&
        expressionResolvesToGlobalNamespace(initializer, namespace, seen, depth + 1)
      ) {
        return true;
      }
    }
  }

  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      return expressionResolvesToGlobalNamespace(initializer, namespace, seen, depth + 1);
    }
  }
  return false;
}

interface RequestRawModuleFamily {
  readonly closedExports: boolean;
  readonly inertExports: ReadonlySet<string>;
  readonly moduleMatches: (specifier: string | undefined) => boolean;
  readonly methods: ReadonlySet<string>;
  readonly sinkPrefix: string;
  readonly safePath: string;
}

function requestRawModuleFamilies(): readonly RequestRawModuleFamily[] {
  return [
    {
      closedExports: true,
      inertExports: REQUEST_NO_INERT_EXPORTS,
      moduleMatches: isProcessModule,
      methods: REQUEST_PROCESS_METHODS,
      sinkPrefix: 'child_process',
      safePath: REQUEST_PROCESS_SAFE_PATH,
    },
    {
      closedExports: true,
      inertExports: REQUEST_FILESYSTEM_INERT_EXPORTS,
      moduleMatches: isFilesystemModule,
      methods: REQUEST_FILESYSTEM_METHODS,
      sinkPrefix: 'node:fs',
      safePath: REQUEST_FILESYSTEM_SAFE_PATH,
    },
    {
      closedExports: true,
      inertExports: REQUEST_PATH_INERT_EXPORTS,
      moduleMatches: isPathModule,
      methods: REQUEST_PATH_METHODS,
      sinkPrefix: 'node:path',
      safePath: REQUEST_FILESYSTEM_SAFE_PATH,
    },
    {
      closedExports: true,
      inertExports: REQUEST_NO_INERT_EXPORTS,
      moduleMatches: isVmModule,
      methods: REQUEST_VM_METHODS,
      sinkPrefix: 'node:vm',
      safePath: REQUEST_DYNAMIC_CODE_SAFE_PATH,
    },
    {
      closedExports: true,
      inertExports: REQUEST_NODE_PROCESS_INERT_EXPORTS,
      moduleMatches: isNodeProcessModule,
      methods: REQUEST_PROCESS_GLOBAL_METHODS,
      sinkPrefix: 'node:process',
      safePath: 'remove request-reachable process-global authority',
    },
    {
      closedExports: false,
      inertExports: REQUEST_NO_INERT_EXPORTS,
      moduleMatches: isWorkerModule,
      methods: REQUEST_WORKER_METHODS,
      sinkPrefix: 'node:worker_threads',
      safePath: REQUEST_DYNAMIC_CODE_SAFE_PATH,
    },
    {
      closedExports: false,
      inertExports: REQUEST_NO_INERT_EXPORTS,
      moduleMatches: isClusterModule,
      methods: REQUEST_CLUSTER_METHODS,
      sinkPrefix: 'node:cluster',
      safePath: REQUEST_PROCESS_SAFE_PATH,
    },
  ];
}

function requestRawNamespaceAccessForExpression(expression: Node): RequestRawAuthority | undefined {
  const node = unwrapStaticExpression(expression);
  if (isReceiverOfMemberAccess(node)) return undefined;

  for (const family of requestRawModuleFamilies()) {
    if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
      if (
        expressionResolvesToModuleNamespace(
          node.getExpression(),
          family.moduleMatches,
          new Set(),
          0,
        )
      ) {
        const member = Node.isPropertyAccessExpression(node)
          ? node.getName()
          : (staticMemberName(node.getArgumentExpression()) ?? '[computed]');
        if (member !== '[computed]' && family.inertExports.has(member)) continue;
        if (member !== '[computed]' && !family.closedExports && !family.methods.has(member)) {
          continue;
        }
        return {
          sink: `${family.sinkPrefix}.${member}`,
          safePath: family.safePath,
        };
      }
    }
    if (expressionResolvesToModuleNamespace(node, family.moduleMatches, new Set(), 0)) {
      return { sink: `${family.sinkPrefix}.namespace`, safePath: family.safePath };
    }
  }

  for (const platform of [
    {
      closedExports: true,
      inertExports: REQUEST_NODE_PROCESS_INERT_EXPORTS,
      namespace: 'process',
      sinkPrefix: 'node:process',
      methods: REQUEST_PROCESS_GLOBAL_METHODS,
      safePath: 'remove request-reachable process-global authority',
    },
    {
      closedExports: false,
      inertExports: REQUEST_NO_INERT_EXPORTS,
      namespace: 'Bun',
      sinkPrefix: 'Bun',
      methods: REQUEST_BUN_PROCESS_METHODS,
      safePath: REQUEST_PROCESS_SAFE_PATH,
    },
    {
      closedExports: false,
      inertExports: REQUEST_NO_INERT_EXPORTS,
      namespace: 'Deno',
      sinkPrefix: 'Deno',
      methods: REQUEST_DENO_PROCESS_METHODS,
      safePath: REQUEST_PROCESS_SAFE_PATH,
    },
  ] as const) {
    if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
      if (
        expressionResolvesToGlobalNamespace(node.getExpression(), platform.namespace, new Set(), 0)
      ) {
        const member = Node.isPropertyAccessExpression(node)
          ? node.getName()
          : (staticMemberName(node.getArgumentExpression()) ?? '[computed]');
        if (member !== '[computed]' && platform.inertExports.has(member)) continue;
        if (member !== '[computed]' && !platform.closedExports && !platform.methods.has(member)) {
          continue;
        }
        return {
          sink: `${platform.sinkPrefix}.${member}`,
          safePath: platform.safePath,
        };
      }
    }
    if (expressionResolvesToGlobalNamespace(node, platform.namespace, new Set(), 0)) {
      return { sink: `${platform.sinkPrefix}.namespace`, safePath: platform.safePath };
    }
  }
  return undefined;
}

function isReceiverOfMemberAccess(node: Node): boolean {
  const parent = node.getParent();
  return (
    !!parent &&
    (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) &&
    parent.getExpression() === node
  );
}

function requestClosedModuleExportForExpression(
  expression: Node,
  moduleMatches: (specifier: string | undefined) => boolean,
  inertExports: ReadonlySet<string>,
  seen: Set<string>,
  depth: number,
): string | undefined {
  if (depth > 16) return undefined;
  const node = unwrapStaticExpression(expression);
  if (
    isReceiverOfMemberAccess(node) &&
    expressionResolvesToModuleNamespace(node, moduleMatches, new Set(), depth + 1)
  ) {
    return undefined;
  }

  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'bind') {
      return requestClosedModuleExportForExpression(
        callee.getExpression(),
        moduleMatches,
        inertExports,
        seen,
        depth + 1,
      );
    }
  }

  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? node.getName()
      : staticMemberName(node.getArgumentExpression());
    if (
      member &&
      !inertExports.has(member) &&
      expressionResolvesToModuleNamespace(node.getExpression(), moduleMatches, new Set(), depth + 1)
    ) {
      return member;
    }
  }

  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (!seen.has(key)) {
      seen.add(key);
      for (const declaration of symbol.getDeclarations()) {
        if (Node.isImportSpecifier(declaration)) {
          const module = declaration.getImportDeclaration().getModuleSpecifierValue();
          const imported = declaration.getName();
          if (moduleMatches(module) && !inertExports.has(imported)) return imported;
        }
        if (Node.isExportSpecifier(declaration)) {
          const exportDeclaration = declaration.getFirstAncestorByKind(
            SyntaxKind.ExportDeclaration,
          );
          const module = exportDeclaration?.getModuleSpecifierValue();
          const imported = declaration.getName();
          if (moduleMatches(module) && !inertExports.has(imported)) return imported;
        }
        if (Node.isNamespaceImport(declaration) || Node.isImportClause(declaration)) {
          const importDeclaration = declaration.getFirstAncestorByKind(
            SyntaxKind.ImportDeclaration,
          );
          if (moduleMatches(importDeclaration?.getModuleSpecifierValue())) return 'namespace';
        }
        if (Node.isBindingElement(declaration)) {
          const member = staticMemberName(
            declaration.getPropertyNameNode() ?? declaration.getNameNode(),
          );
          const source = bindingElementSourceExpression(declaration);
          if (
            member &&
            !inertExports.has(member) &&
            source &&
            expressionResolvesToModuleNamespace(source, moduleMatches, new Set(), depth + 1)
          ) {
            return member;
          }
        }
        const initializer = valueDeclarationInitializer(declaration);
        if (initializer) {
          const resolved = requestClosedModuleExportForExpression(
            initializer,
            moduleMatches,
            inertExports,
            seen,
            depth + 1,
          );
          if (resolved) return resolved;
        }
      }
    }
  }

  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      return requestClosedModuleExportForExpression(
        initializer,
        moduleMatches,
        inertExports,
        seen,
        depth + 1,
      );
    }
  }
  return undefined;
}

function requestModuleMethodForExpression(
  expression: Node,
  moduleMatches: (specifier: string | undefined) => boolean,
  methods: ReadonlySet<string>,
  seen: Set<string>,
  depth: number,
): string | undefined {
  if (depth > 16) return undefined;
  const node = unwrapStaticExpression(expression);

  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'bind') {
      return requestModuleMethodForExpression(
        callee.getExpression(),
        moduleMatches,
        methods,
        seen,
        depth + 1,
      );
    }
  }

  if (Node.isPropertyAccessExpression(node)) {
    const member = node.getName();
    if (
      methods.has(member) &&
      expressionResolvesToModuleNamespace(node.getExpression(), moduleMatches, new Set(), depth + 1)
    ) {
      return member;
    }
  }
  if (Node.isElementAccessExpression(node)) {
    const argument = node.getArgumentExpression();
    const member = staticMemberName(argument);
    if (
      member &&
      methods.has(member) &&
      expressionResolvesToModuleNamespace(node.getExpression(), moduleMatches, new Set(), depth + 1)
    ) {
      return member;
    }
  }

  const symbol = node.getSymbol();
  const fromSymbol = requestModuleMethodForSymbol(symbol, moduleMatches, methods, seen, depth + 1);
  if (fromSymbol) return fromSymbol;

  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    if (declaration) {
      const initializer = valueDeclarationInitializer(declaration);
      if (initializer) {
        return requestModuleMethodForExpression(
          initializer,
          moduleMatches,
          methods,
          seen,
          depth + 1,
        );
      }
      if (Node.isBindingElement(declaration)) {
        const member = staticMemberName(
          declaration.getPropertyNameNode() ?? declaration.getNameNode(),
        );
        const source = bindingElementSourceExpression(declaration);
        if (
          member &&
          methods.has(member) &&
          source &&
          expressionResolvesToModuleNamespace(source, moduleMatches, new Set(), depth + 1)
        ) {
          return member;
        }
      }
    }
  }

  return undefined;
}

function requestModuleMethodForSymbol(
  symbol: ReturnType<Node['getSymbol']>,
  moduleMatches: (specifier: string | undefined) => boolean,
  methods: ReadonlySet<string>,
  seen: Set<string>,
  depth: number,
): string | undefined {
  if (!symbol || depth > 16) return undefined;
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return undefined;
  seen.add(key);

  try {
    const aliased = symbol.getAliasedSymbol();
    if (aliased && aliased !== symbol) {
      const resolved = requestModuleMethodForSymbol(
        aliased,
        moduleMatches,
        methods,
        seen,
        depth + 1,
      );
      if (resolved) return resolved;
    }
  } catch {
    // Fall back to the import declaration's exact module/export identity.
  }

  for (const declaration of symbol.getDeclarations()) {
    if (Node.isImportSpecifier(declaration)) {
      const module = declaration.getImportDeclaration().getModuleSpecifierValue();
      const imported = declaration.getName();
      if (moduleMatches(module) && methods.has(imported)) return imported;
    }
    if (Node.isExportSpecifier(declaration)) {
      const exportDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ExportDeclaration);
      const module = exportDeclaration?.getModuleSpecifierValue();
      const imported = declaration.getName();
      if (module && moduleMatches(module) && methods.has(imported)) {
        return imported;
      }
    }
    if (Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer) {
        const resolved = requestModuleMethodForExpression(
          initializer,
          moduleMatches,
          methods,
          seen,
          depth + 1,
        );
        if (resolved) return resolved;
      }
    }
    if (Node.isBindingElement(declaration)) {
      const member = staticMemberName(
        declaration.getPropertyNameNode() ?? declaration.getNameNode(),
      );
      const source = bindingElementSourceExpression(declaration);
      if (
        member &&
        methods.has(member) &&
        source &&
        expressionResolvesToModuleNamespace(source, moduleMatches, new Set(), depth + 1)
      ) {
        return member;
      }
    }
  }
  return undefined;
}

function expressionResolvesToModuleNamespace(
  expression: Node,
  moduleMatches: (specifier: string | undefined) => boolean,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 16) return false;
  const node = unwrapStaticExpression(expression);
  if (
    Node.isCallExpression(node) &&
    isStaticRequireOf(node, (specifier) => moduleMatches(specifier))
  ) {
    return true;
  }
  if (Node.isCallExpression(node) && isProcessGetBuiltinModuleCall(node)) {
    const [specifier] = node.getArguments();
    if (specifier && isStringLiteralLike(specifier) && moduleMatches(specifier.getLiteralText())) {
      return true;
    }
  }
  if (
    Node.isCallExpression(node) &&
    expressionResolvesToCreatedRequire(node.getExpression(), new Set(), 0)
  ) {
    const [specifier] = node.getArguments();
    if (specifier && isStringLiteralLike(specifier) && moduleMatches(specifier.getLiteralText())) {
      return true;
    }
  }
  if (
    Node.isPropertyAccessExpression(node) &&
    REQUEST_MODULE_NAMESPACE_MEMBERS.has(node.getName()) &&
    expressionResolvesToModuleNamespace(node.getExpression(), moduleMatches, seen, depth + 1)
  ) {
    return true;
  }
  if (
    Node.isElementAccessExpression(node) &&
    REQUEST_MODULE_NAMESPACE_MEMBERS.has(staticMemberName(node.getArgumentExpression()) ?? '') &&
    expressionResolvesToModuleNamespace(node.getExpression(), moduleMatches, seen, depth + 1)
  ) {
    return true;
  }

  if (Node.isIdentifier(node)) {
    const name = node.getText();
    for (const declaration of node.getSourceFile().getImportDeclarations()) {
      if (!moduleMatches(declaration.getModuleSpecifierValue())) continue;
      if (declaration.getNamespaceImport()?.getText() === name) return true;
      if (declaration.getDefaultImport()?.getText() === name) return true;
      for (const named of declaration.getNamedImports()) {
        if (
          (named.getAliasNode()?.getText() ?? named.getName()) === name &&
          REQUEST_MODULE_NAMESPACE_MEMBERS.has(named.getName())
        ) {
          return true;
        }
      }
    }
  }

  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return false;
    seen.add(key);
    for (const declaration of symbol.getDeclarations()) {
      if (Node.isNamespaceImport(declaration) || Node.isImportClause(declaration)) {
        const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
        if (moduleMatches(importDeclaration?.getModuleSpecifierValue())) return true;
      }
      if (Node.isImportSpecifier(declaration)) {
        const module = declaration.getImportDeclaration().getModuleSpecifierValue();
        if (moduleMatches(module) && REQUEST_MODULE_NAMESPACE_MEMBERS.has(declaration.getName())) {
          return true;
        }
      }
      if (Node.isBindingElement(declaration)) {
        const member = staticMemberName(
          declaration.getPropertyNameNode() ?? declaration.getNameNode(),
        );
        const source = bindingElementSourceExpression(declaration);
        if (
          member &&
          REQUEST_MODULE_NAMESPACE_MEMBERS.has(member) &&
          source &&
          expressionResolvesToModuleNamespace(source, moduleMatches, seen, depth + 1)
        ) {
          return true;
        }
      }
      const initializer = valueDeclarationInitializer(declaration);
      if (
        initializer &&
        expressionResolvesToModuleNamespace(initializer, moduleMatches, seen, depth + 1)
      ) {
        return true;
      }
    }
  }

  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      return expressionResolvesToModuleNamespace(initializer, moduleMatches, seen, depth + 1);
    }
  }
  return false;
}

const REQUEST_MODULE_NAMESPACE_MEMBERS = new Set(['posix', 'promises', 'win32']);

function opaqueBareModuleForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
): string | undefined {
  if (depth > 16) return undefined;
  const node = unwrapStaticExpression(expression);

  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const receiver = node.getExpression();
    const module = opaqueBareModuleForExpression(receiver, seen, depth + 1);
    if (module) return module;
  }
  if (Node.isCallExpression(node) && isStaticRequireOf(node, isOpaqueBareModule)) {
    const [specifier] = node.getArguments();
    return specifier && isStringLiteralLike(specifier) ? specifier.getLiteralText() : undefined;
  }
  if (Node.isIdentifier(node)) {
    const local = node.getText();
    for (const declaration of node.getSourceFile().getImportDeclarations()) {
      const module = declaration.getModuleSpecifierValue();
      if (!isOpaqueBareModule(module)) continue;
      if (declaration.getDefaultImport()?.getText() === local) return module;
      if (declaration.getNamespaceImport()?.getText() === local) return module;
      for (const named of declaration.getNamedImports()) {
        if ((named.getAliasNode()?.getText() ?? named.getName()) === local) return module;
      }
    }
  }

  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (!seen.has(key)) {
      seen.add(key);
      for (const declaration of symbol.getDeclarations()) {
        if (Node.isImportSpecifier(declaration)) {
          const module = declaration.getImportDeclaration().getModuleSpecifierValue();
          if (isOpaqueBareModule(module)) return module;
        }
        if (Node.isNamespaceImport(declaration) || Node.isImportClause(declaration)) {
          const importDeclaration = declaration.getFirstAncestorByKind(
            SyntaxKind.ImportDeclaration,
          );
          const module = importDeclaration?.getModuleSpecifierValue();
          if (module && isOpaqueBareModule(module)) return module;
        }
        const initializer = valueDeclarationInitializer(declaration);
        if (initializer) {
          const module = opaqueBareModuleForExpression(initializer, seen, depth + 1);
          if (module) return module;
        }
      }
    }
  }
  return undefined;
}

function localValueDeclaration(identifier: Node): Node | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;
  const name = identifier.getText();
  const sourceFile = identifier.getSourceFile();
  return (
    sourceFile.getFunctions().find((declaration) => declaration.getName() === name) ??
    sourceFile.getVariableDeclarations().find((declaration) => {
      const nameNode = declaration.getNameNode();
      if (Node.isIdentifier(nameNode)) return nameNode.getText() === name;
      return (
        Node.isObjectBindingPattern(nameNode) &&
        nameNode
          .getElements()
          .some((element) =>
            Node.isIdentifier(element.getNameNode())
              ? element.getNameNode().getText() === name
              : false,
          )
      );
    })
  );
}

function valueDeclarationInitializer(declaration: Node): Node | undefined {
  if (Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration)) {
    return declaration.getInitializer();
  }
  if (Node.isBindingElement(declaration)) return bindingElementSourceExpression(declaration);
  return undefined;
}

function bindingElementSourceExpression(binding: Node): Node | undefined {
  if (!Node.isBindingElement(binding)) return undefined;
  const pattern = binding.getFirstAncestorByKind(SyntaxKind.ObjectBindingPattern);
  return pattern?.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getInitializer();
}

function isStaticRequireOf(call: Node, predicate: (specifier: string) => boolean): boolean {
  if (!Node.isCallExpression(call)) return false;
  const callee = call.getExpression();
  const [specifier] = call.getArguments();
  return (
    Node.isIdentifier(callee) &&
    callee.getText() === 'require' &&
    !callee.getSymbol()?.getDeclarations().length &&
    !!specifier &&
    isStringLiteralLike(specifier) &&
    predicate(specifier.getLiteralText())
  );
}

function isProcessModule(specifier: string | undefined): boolean {
  return specifier === 'child_process' || specifier === 'node:child_process';
}

function isVmModule(specifier: string | undefined): boolean {
  return specifier === 'vm' || specifier === 'node:vm';
}

function isFilesystemModule(specifier: string | undefined): boolean {
  return (
    specifier === 'fs' ||
    specifier === 'node:fs' ||
    specifier === 'fs/promises' ||
    specifier === 'node:fs/promises'
  );
}

function isPathModule(specifier: string | undefined): boolean {
  return (
    specifier === 'path' ||
    specifier === 'node:path' ||
    specifier === 'path/posix' ||
    specifier === 'node:path/posix' ||
    specifier === 'path/win32' ||
    specifier === 'node:path/win32'
  );
}

function isWorkerModule(specifier: string | undefined): boolean {
  return specifier === 'worker_threads' || specifier === 'node:worker_threads';
}

function isClusterModule(specifier: string | undefined): boolean {
  return specifier === 'cluster' || specifier === 'node:cluster';
}

function isNodeModuleModule(specifier: string | undefined): boolean {
  return specifier === 'module' || specifier === 'node:module';
}

function isNodeProcessModule(specifier: string | undefined): boolean {
  return specifier === 'process' || specifier === 'node:process';
}

function isProcessGetBuiltinModuleCall(call: Node): boolean {
  if (!Node.isCallExpression(call)) return false;
  return (
    requestGlobalNamespaceMethodForExpression(
      call.getExpression(),
      'process',
      REQUEST_PROCESS_MODULE_METHODS,
      new Set(),
      0,
    ) === 'getBuiltinModule'
  );
}

const NODE_BUILTIN_MODULES = new Set(
  builtinNodeModules.flatMap((specifier) => [specifier, `node:${specifier}`]),
);

const REQUEST_SAFE_BUILTIN_MODULES = new Set([
  'assert',
  'assert/strict',
  'buffer',
  'events',
  'querystring',
  'string_decoder',
  'url',
  'util',
  'util/types',
]);

function normalizeBuiltinModuleSpecifier(specifier: string): string {
  return specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
}

function isReviewedSafeBuiltinModule(specifier: string | undefined): boolean {
  return (
    specifier !== undefined &&
    REQUEST_SAFE_BUILTIN_MODULES.has(normalizeBuiltinModuleSpecifier(specifier))
  );
}

function isHandledRequestBuiltinModule(specifier: string): boolean {
  return (
    isProcessModule(specifier) ||
    isFilesystemModule(specifier) ||
    isPathModule(specifier) ||
    isVmModule(specifier) ||
    isWorkerModule(specifier) ||
    isClusterModule(specifier) ||
    isNodeProcessModule(specifier)
  );
}

function isUnreviewedRequestBuiltinModule(specifier: string): boolean {
  return (
    NODE_BUILTIN_MODULES.has(specifier) &&
    !isHandledRequestBuiltinModule(specifier) &&
    !REQUEST_SAFE_BUILTIN_MODULES.has(normalizeBuiltinModuleSpecifier(specifier))
  );
}

interface RequestImportedModuleExport {
  readonly exportName: string;
  readonly module: string;
}

function requestImportedModuleExportForExpression(
  expression: Node,
  moduleMatches: (specifier: string) => boolean,
  seen: Set<string>,
  depth: number,
): RequestImportedModuleExport | undefined {
  if (depth > 16) return undefined;
  const node = unwrapStaticExpression(expression);
  if (
    isReceiverOfMemberAccess(node) &&
    requestModuleNamespaceSpecifier(node, moduleMatches, new Set(), depth + 1)
  ) {
    return undefined;
  }

  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'bind') {
      return requestImportedModuleExportForExpression(
        callee.getExpression(),
        moduleMatches,
        seen,
        depth + 1,
      );
    }
    if (isStaticRequireOf(node, moduleMatches)) {
      const [specifier] = node.getArguments();
      if (specifier && isStringLiteralLike(specifier)) {
        return { exportName: 'namespace', module: specifier.getLiteralText() };
      }
    }
  }

  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const module = requestModuleNamespaceSpecifier(
      node.getExpression(),
      moduleMatches,
      new Set(),
      depth + 1,
    );
    const exportName = Node.isPropertyAccessExpression(node)
      ? node.getName()
      : (staticMemberName(node.getArgumentExpression()) ?? '[computed]');
    if (module) return { exportName, module };
  }

  if (Node.isIdentifier(node)) {
    const local = node.getText();
    for (const declaration of node.getSourceFile().getImportDeclarations()) {
      const module = declaration.getModuleSpecifierValue();
      if (!moduleMatches(module)) continue;
      if (declaration.getNamespaceImport()?.getText() === local) {
        return { exportName: 'namespace', module };
      }
      if (declaration.getDefaultImport()?.getText() === local) {
        return { exportName: 'default', module };
      }
      for (const named of declaration.getNamedImports()) {
        if ((named.getAliasNode()?.getText() ?? named.getName()) === local) {
          return { exportName: named.getName(), module };
        }
      }
    }
  }

  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (!seen.has(key)) {
      seen.add(key);
      for (const declaration of symbol.getDeclarations()) {
        if (Node.isImportSpecifier(declaration)) {
          const module = declaration.getImportDeclaration().getModuleSpecifierValue();
          if (moduleMatches(module)) return { exportName: declaration.getName(), module };
        }
        if (Node.isNamespaceImport(declaration) || Node.isImportClause(declaration)) {
          const importDeclaration = declaration.getFirstAncestorByKind(
            SyntaxKind.ImportDeclaration,
          );
          const module = importDeclaration?.getModuleSpecifierValue();
          if (module && moduleMatches(module)) return { exportName: 'namespace', module };
        }
        if (Node.isBindingElement(declaration)) {
          const module = requestModuleNamespaceSpecifier(
            bindingElementSourceExpression(declaration),
            moduleMatches,
            new Set(),
            depth + 1,
          );
          const exportName = staticMemberName(
            declaration.getPropertyNameNode() ?? declaration.getNameNode(),
          );
          if (module && exportName) return { exportName, module };
        }
        const initializer = valueDeclarationInitializer(declaration);
        if (initializer) {
          const imported = requestImportedModuleExportForExpression(
            initializer,
            moduleMatches,
            seen,
            depth + 1,
          );
          if (imported) return imported;
        }
      }
    }
  }

  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      return requestImportedModuleExportForExpression(initializer, moduleMatches, seen, depth + 1);
    }
  }
  return undefined;
}

function requestModuleNamespaceSpecifier(
  expression: Node | undefined,
  moduleMatches: (specifier: string) => boolean,
  seen: Set<string>,
  depth: number,
): string | undefined {
  if (!expression || depth > 16) return undefined;
  const node = unwrapStaticExpression(expression);
  if (Node.isCallExpression(node) && isStaticRequireOf(node, moduleMatches)) {
    const [specifier] = node.getArguments();
    return specifier && isStringLiteralLike(specifier) ? specifier.getLiteralText() : undefined;
  }
  if (Node.isIdentifier(node)) {
    const local = node.getText();
    for (const declaration of node.getSourceFile().getImportDeclarations()) {
      const module = declaration.getModuleSpecifierValue();
      if (!moduleMatches(module)) continue;
      if (declaration.getNamespaceImport()?.getText() === local) return module;
      if (declaration.getDefaultImport()?.getText() === local) return module;
    }
  }

  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return undefined;
    seen.add(key);
    for (const declaration of symbol.getDeclarations()) {
      if (Node.isNamespaceImport(declaration) || Node.isImportClause(declaration)) {
        const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
        const module = importDeclaration?.getModuleSpecifierValue();
        if (module && moduleMatches(module)) return module;
      }
      const initializer = valueDeclarationInitializer(declaration);
      if (initializer) {
        const module = requestModuleNamespaceSpecifier(initializer, moduleMatches, seen, depth + 1);
        if (module) return module;
      }
    }
  }
  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      return requestModuleNamespaceSpecifier(initializer, moduleMatches, seen, depth + 1);
    }
  }
  return undefined;
}

function isOpaqueBareModule(specifier: string): boolean {
  if (isUnreviewedRequestBuiltinModule(specifier)) return true;
  return (
    !specifier.startsWith('.') &&
    !specifier.startsWith('/') &&
    !specifier.startsWith('@kovojs/') &&
    !isProcessModule(specifier) &&
    !NODE_BUILTIN_MODULES.has(specifier)
  );
}

function staticMemberName(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}

function unwrapStaticExpression(node: Node): Node {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

function requestSymbolKey(symbol: NonNullable<ReturnType<Node['getSymbol']>>): string {
  return `${symbol.getFullyQualifiedName()}:${symbol
    .getDeclarations()
    .map((declaration) => `${declaration.getSourceFile().getFilePath()}:${declaration.getStart()}`)
    .join('|')}`;
}

function optionalOpaqueModule(opaqueModule: string | undefined): { opaqueModule?: string } {
  return opaqueModule === undefined ? {} : { opaqueModule };
}

function unregisteredSinksForSourceFile(
  file: TrustEscapeSourceFileInput,
  sourceFile: SourceFile,
): UnregisteredSinkFact[] {
  const facts: UnregisteredSinkFact[] = [];

  for (const handler of handlerBodies(sourceFile)) {
    // Assignments: el.innerHTML = ..., el.outerHTML = ...
    for (const binary of handler.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (binary.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
      const left = binary.getLeft();
      if (!Node.isPropertyAccessExpression(left)) continue;
      const member = left.getName();
      if (member !== 'innerHTML' && member !== 'outerHTML') continue;
      facts.push({
        sink: member,
        safePath: 'trustedHtml',
        site: siteFor(file, binary),
        ...sourceField(binary.getRight()),
      });
    }

    // Calls: eval(...), setTimeout('...'), document.write(...), new Function(...)
    for (const call of handler.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const match = dangerousCallSink(call);
      if (match) {
        facts.push({
          sink: match.sink,
          safePath: match.safePath,
          site: siteFor(file, call),
          ...(match.source ? { source: match.source } : {}),
        });
      }
    }
    for (const construct of handler.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      const callee = construct.getExpression();
      if (unshadowedGlobalIdentifier(callee, 'Function')) {
        const [arg] = construct.getArguments();
        facts.push({
          sink: 'Function',
          safePath: 'remove dynamic code evaluation',
          site: siteFor(file, construct),
          ...(arg ? { source: shortSource(arg) } : {}),
        });
      }
    }
  }

  return facts;
}

function dangerousCallSink(call: Node): DangerousSinkMatch | null {
  if (!Node.isCallExpression(call)) return null;
  const callee = call.getExpression();

  if (Node.isIdentifier(callee)) {
    const name = callee.getText();
    if (name === 'eval' && unshadowedGlobalIdentifier(callee, 'eval')) {
      const [arg] = call.getArguments();
      return { sink: 'eval', safePath: 'remove dynamic code evaluation', ...sourceField(arg) };
    }
    if (
      (name === 'setTimeout' || name === 'setInterval') &&
      unshadowedGlobalIdentifier(callee, name)
    ) {
      const [arg] = call.getArguments();
      // Only the string-body form is the dangerous code-injection sink.
      if (arg && isStringLiteralLike(arg)) {
        return {
          sink: name,
          safePath: `${name}(fn, ...) with a function callback`,
          source: shortSource(arg),
        };
      }
    }
    return null;
  }

  if (Node.isPropertyAccessExpression(callee)) {
    const receiver = callee.getExpression();
    const method = callee.getName();
    if (
      (method === 'write' || method === 'writeln') &&
      unshadowedGlobalIdentifier(receiver, 'document')
    ) {
      const [arg] = call.getArguments();
      return {
        sink: `document.${method}`,
        safePath: 'trustedHtml',
        ...sourceField(arg),
      };
    }
  }

  return null;
}

function unshadowedGlobalIdentifier(node: Node, expectedName: string): boolean {
  if (!Node.isIdentifier(node) || !identifierTextEquals(node, expectedName)) return false;

  // Syntactic trust pass: global built-in/DOM recognizer only; local/imported shadows fail closed.
  return !(node.getSymbol()?.getDeclarations() ?? []).some(
    (declaration) =>
      declaration.getSourceFile().getFilePath() === node.getSourceFile().getFilePath(),
  );
}

function identifierTextEquals(identifier: Node & { getText(): string }, expected: string): boolean {
  return identifier.getText() === expected;
}

function sourceField(node: Node | undefined): { source?: string } {
  return node ? { source: shortSource(node) } : {};
}

/**
 * The handler-shaped closures whose bodies the compiler serializes across the KV201
 * boundary: arrow/function expressions passed as JSX event-handler attributes
 * (`onClick={...}` / `on:click={...}`) or assigned to `on*` properties. Narrowing to
 * these bodies (rather than arbitrary module code) keeps the KV424 gate fail-safe.
 */
function handlerBodies(sourceFile: SourceFile): Node[] {
  const bodies: Node[] = [];
  const seen = new Set<Node>();

  const add = (node: Node | undefined): void => {
    if (!node) return;
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const body = node.getBody();
      if (body && !seen.has(body)) {
        seen.add(body);
        bodies.push(body);
      }
    }
  };

  // JSX attributes whose name starts with `on` (onClick, on:click, onSubmit, ...).
  for (const attribute of sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const name = attribute.getNameNode().getText();
    if (!/^on[:A-Z]/.test(name) && !/^on[a-z]/.test(name)) continue;
    const initializer = attribute.getInitializer();
    if (initializer && Node.isJsxExpression(initializer)) add(initializer.getExpression());
  }

  // `element.onclick = () => {...}` style property assignments to on* handlers.
  for (const binary of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (binary.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = binary.getLeft();
    if (!Node.isPropertyAccessExpression(left)) continue;
    if (!/^on[a-z]/.test(left.getName())) continue;
    add(binary.getRight());
  }

  // addEventListener('click', () => {...}) callbacks.
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'addEventListener') {
      add(call.getArguments()[1]);
    }
  }

  return bodies;
}

// =====================================================================================
// TASK C — capability-escape collector (SPEC §6.6, AUDIT-ONLY, threat-matrix M3)
// =====================================================================================
//
// The static producer that surfaces every APP-AUTHORED escape hatch as a `CapabilityExplain`
// so `kovo explain --capabilities` (packages/cli/src/graph-output.ts) enumerates the whole
// intentional-security-hole surface from one place (threat-matrix-plan.md M3). This mirrors the
// `publishToClient` call-site pattern (packages/compiler/src/app-graph.ts): detect the escape at
// its CALL SITE during graph construction and emit a fact — it does NOT depend on the runtime
// `drain*Facts()` collectors, which only fire during live request execution and so never populate
// a merely-built (not run) graph. Like the trust-escape pass, this ENFORCES NOTHING; it emits one
// row per escape regardless of whether a justification is present, and the reviewer decides.
//
// Two detection strategies (both syntactic, no type-checker):
//   - IMPORT-RESOLVED named calls (serverValue/trustedAssign/unsafeRegex/declarePublicRelation/
//     usePostgresSystemDb/accept.unverified/unsafeCookie): the callee resolves to a `@kovojs/server`
//     or `@kovojs/drizzle` export (same `expressionResolvesToFrameworkExport` identity the trust
//     pass uses), so a local same-named helper does not false-positive.
//   - METHOD-NAME calls (crossOwnerRead/rawRead/declareSystemRead/declareSystemWrite/actAs): these
//     are runtime methods on a managed-DB reader or task/webhook principal scope — never imports —
//     so they are matched by their distinctive method name. This over-reports rather than under-
//     reports (an audit surface is fail-loud), consistent with the trust pass's addEventListener match.
//
// FRAMEWORK-FIXED capabilities (`managedSqlStatement`, `postgresRoleTopology`, `authAdapterDb`) have
// NO per-app call site: they are framework-owned identities tracked by the capability-surface census
// gate (scripts/capability-surface-census.manifest.json). They are intentionally NOT produced here;
// see plans/threat-matrix-plan.md M3 for why they stay census-tracked instead of graph-produced.

/** A `@kovojs/server`/`@kovojs/drizzle` export whose CALL is an audited capability escape. */
const FRAMEWORK_CAPABILITY_CALLS: Readonly<Record<string, CapabilityExplain['kind']>> = {
  declarePublicRelation: 'publicRelation',
  serverValue: 'serverValue',
  trustedAssign: 'serverValue',
  unsafeCookie: 'unsafeCookie',
  unsafeInline: 'unsafeInline',
  unsafeRegex: 'unsafeRegex',
  usePostgresSystemDb: 'systemDb',
};

const CAPABILITY_ESCAPE_MODULES = ['@kovojs/server', '@kovojs/drizzle', '@kovojs/browser'] as const;

/**
 * The ORIGINAL export name a call's callee identifier is imported under from a `@kovojs/*` package
 * (alias-aware, so `import { unsafeRegex as ur }` still resolves to `unsafeRegex`). Self-contained
 * syntactic import resolution — deliberately independent of the shared framework-identity catalog so
 * surfacing a new escape here never has to widen that catalog's blast radius. Mirrors the same
 * `getSymbol()` provenance the KV424 sink pass already relies on (`unshadowedGlobalIdentifier`).
 */
function importedKovoExportName(callee: Node): string | undefined {
  if (!Node.isIdentifier(callee)) return undefined;
  for (const declaration of callee.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isImportSpecifier(declaration)) continue;
    const module = declaration.getImportDeclaration().getModuleSpecifierValue();
    if (
      CAPABILITY_ESCAPE_MODULES.some(
        (prefix) => module === prefix || module.startsWith(`${prefix}/`),
      )
    ) {
      return declaration.getName();
    }
  }
  return undefined;
}

/** Distinctive runtime METHOD names whose call is an audited capability escape (no import to resolve). */
function methodCapabilityKind(name: string): CapabilityExplain['kind'] | undefined {
  // SPEC §6.6: this audit classifier is an exact, closed allowlist. A plain record lookup would
  // inherit Object.prototype names such as `valueOf` and emit non-JSON function values as alleged
  // capability kinds, breaking build preflight and making unrelated method calls authoritatively
  // visible as security escapes.
  switch (name) {
    case 'actAs':
      return 'actAs';
    case 'crossOwnerRead':
      return 'crossOwnerRead';
    case 'declareSystemRead':
      return 'declareSystemRead';
    case 'declareSystemWrite':
      return 'declareSystemWrite';
    case 'rawRead':
      return 'rawRead';
    default:
      return undefined;
  }
}

/**
 * Collect every app-authored escape-hatch call site as a `CapabilityExplain` (SPEC §6.6,
 * AUDIT-ONLY for `kovo explain --capabilities`, threat-matrix M3). One row per escape call; the
 * recorded `justification` (from a `reason`/`justification` argument, a trailing string, or a
 * leading `// justification:` comment) is the load-bearing audit field but is never required here.
 *
 * @internal
 */
export function collectCapabilityEscapesFromProject(
  options: TrustEscapeProjectOptions,
): CapabilityExplain[] {
  const { sourceFiles, dispose } = createSyntacticProject(options.files);
  try {
    const escapes: CapabilityExplain[] = [];
    for (const [index, sourceFile] of sourceFiles.entries()) {
      const file = options.files[index];
      if (!file) continue;
      escapes.push(...capabilityEscapesForSourceFile(file, sourceFile));
    }
    return escapes.sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.site.localeCompare(right.site) ||
        (left.target ?? '').localeCompare(right.target ?? ''),
    );
  } finally {
    dispose();
  }
}

function capabilityEscapesForSourceFile(
  file: TrustEscapeSourceFileInput,
  sourceFile: SourceFile,
): CapabilityExplain[] {
  const escapes: CapabilityExplain[] = [];

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const escape =
      frameworkCapabilityEscape(file, call) ??
      acceptUnverifiedEscape(file, call) ??
      methodCapabilityEscape(file, call);
    if (escape) escapes.push(escape);
  }

  for (const property of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    escapes.push(...egressAllowInternalEscapes(file, property));
  }

  return escapes;
}

function frameworkCapabilityEscape(
  file: TrustEscapeSourceFileInput,
  call: Node,
): CapabilityExplain | null {
  if (!Node.isCallExpression(call)) return null;
  const exportName = importedKovoExportName(call.getExpression());
  const kind = exportName ? FRAMEWORK_CAPABILITY_CALLS[exportName] : undefined;
  if (!exportName || !kind) return null;

  const args = call.getArguments();
  const target = capabilityTargetForCall(exportName, args);
  const justification = capabilityJustificationForCall(exportName, args, call);
  return {
    kind,
    site: siteFor(file, call),
    ...(target === undefined ? {} : { target }),
    ...(justification === undefined ? {} : { justification }),
  };
}

function capabilityTargetForCall(exportName: string, args: readonly Node[]): string | undefined {
  if (exportName === 'unsafeRegex') return args[0] ? shortSource(args[0]) : undefined;
  if (exportName === 'declarePublicRelation') {
    const options = args[0];
    return options && Node.isObjectLiteralExpression(options)
      ? objectStringProperty(options, 'relation')
      : undefined;
  }
  if (exportName === 'usePostgresSystemDb') return args[0] ? shortSource(args[0]) : undefined;
  if (exportName === 'unsafeCookie') {
    const options = args[0];
    return options && Node.isObjectLiteralExpression(options)
      ? cookieDowngradeSummary(options)
      : undefined;
  }
  return exportName; // serverValue / trustedAssign: the escape kind is shared, so name the fn.
}

function capabilityJustificationForCall(
  exportName: string,
  args: readonly Node[],
  call: Node,
): string | undefined {
  if (exportName === 'declarePublicRelation') {
    const options = args[0];
    return options && Node.isObjectLiteralExpression(options)
      ? objectStringProperty(options, 'reason')
      : leadingJustification(call);
  }
  if (exportName === 'unsafeCookie') {
    const options = args[0];
    return (
      (options && Node.isObjectLiteralExpression(options)
        ? objectStringProperty(options, 'justification')
        : undefined) ?? leadingJustification(call)
    );
  }
  if (exportName === 'unsafeInline') {
    const justification = args[0];
    return justification && isStringLiteralLike(justification)
      ? justification.getLiteralText()
      : leadingJustification(call);
  }
  if (exportName === 'usePostgresSystemDb') return leadingJustification(call);
  // serverValue(v, reason) / trustedAssign(v, reason|{reason}) / unsafeRegex(re, justification):
  // the reason is the SECOND argument, as a string or a `{ reason }` object.
  const reasonArg = args[1];
  if (reasonArg && isStringLiteralLike(reasonArg)) return reasonArg.getLiteralText();
  if (reasonArg && Node.isObjectLiteralExpression(reasonArg)) {
    return (
      objectStringProperty(reasonArg, 'reason') ?? objectStringProperty(reasonArg, 'justification')
    );
  }
  return leadingJustification(call);
}

function acceptUnverifiedEscape(
  file: TrustEscapeSourceFileInput,
  call: Node,
): CapabilityExplain | null {
  if (!Node.isCallExpression(call)) return null;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'unverified') return null;
  if (importedKovoExportName(callee.getExpression()) !== 'accept') return null;

  const args = call.getArguments();
  const justification =
    args[1] && isStringLiteralLike(args[1]) ? args[1].getLiteralText() : undefined;
  return {
    kind: 'acceptUnverified',
    site: siteFor(file, call),
    ...(args[0] ? { target: shortSource(args[0]) } : {}),
    ...(justification === undefined ? {} : { justification }),
  };
}

function methodCapabilityEscape(
  file: TrustEscapeSourceFileInput,
  call: Node,
): CapabilityExplain | null {
  if (!Node.isCallExpression(call)) return null;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;
  const kind = methodCapabilityKind(callee.getName());
  if (!kind) return null;

  const args = call.getArguments();
  const declaration = args[0];
  const justification =
    (declaration && Node.isObjectLiteralExpression(declaration)
      ? (objectStringProperty(declaration, 'reason') ??
        objectStringProperty(declaration, 'justification'))
      : declaration && isStringLiteralLike(declaration)
        ? declaration.getLiteralText()
        : undefined) ?? leadingJustification(call);
  const target =
    declaration && Node.isObjectLiteralExpression(declaration)
      ? objectStringProperty(declaration, 'relation')
      : declaration && isStringLiteralLike(declaration) && kind === 'actAs'
        ? declaration.getLiteralText()
        : undefined;
  return {
    kind,
    site: siteFor(file, call),
    ...(target === undefined ? {} : { target }),
    ...(justification === undefined ? {} : { justification }),
  };
}

/**
 * `createApp({ egress: { allowInternal: ['10.0.0.5:9090', ...] } })` — one private-network egress
 * allow entry is one held capability. Detects the `allowInternal` array property nested under an
 * `egress` options object and emits one row per host:port literal.
 */
function egressAllowInternalEscapes(
  file: TrustEscapeSourceFileInput,
  property: Node,
): CapabilityExplain[] {
  if (!Node.isPropertyAssignment(property) || property.getName() !== 'allowInternal') return [];
  const grandparent = property.getParentIfKind(SyntaxKind.ObjectLiteralExpression);
  const owningProperty = grandparent?.getParentIfKind(SyntaxKind.PropertyAssignment);
  if (!grandparent || !owningProperty || owningProperty.getName() !== 'egress') return [];
  const initializer = property.getInitializer();
  if (!initializer || !Node.isArrayLiteralExpression(initializer)) return [];
  const justification =
    objectStringProperty(grandparent, 'allowInternalJustification') ??
    leadingJustification(property);
  const escapes: CapabilityExplain[] = [];
  for (const element of initializer.getElements()) {
    if (!isStringLiteralLike(element)) continue;
    escapes.push({
      kind: 'egressAllowInternal',
      site: siteFor(file, element),
      target: element.getLiteralText(),
      ...(justification === undefined ? {} : { justification }),
    });
  }
  return escapes;
}

// =====================================================================================
// TASK D — cookie-downgrade collector (SPEC §6.6/§9.1, AUDIT-ONLY, `kovo explain --cookies`)
// =====================================================================================
//
// The static producer for `graph.cookieDowngrades` (`CookieDowngradeExplain`), previously
// PRODUCER-LESS: only the runtime `drainCookieDowngradeFacts()` sink populated it, so a merely-built
// app surfaced nothing under `--cookies`. Detects `serializeCookie(name, value, { class, unsafe:
// unsafeCookie({ downgrade, justification }) })` call sites and reads the credential class, cookie
// name, weakened floor, and justification directly off the literal call — the same fields the
// runtime fact carries. Audit-only: the downgrade is gated at the `serializeCookie` sink (KV432).

/** @internal */
export function collectCookieDowngradesFromProject(
  options: TrustEscapeProjectOptions,
): CookieDowngradeExplain[] {
  const { sourceFiles, dispose } = createSyntacticProject(options.files);
  try {
    const downgrades: CookieDowngradeExplain[] = [];
    for (const [index, sourceFile] of sourceFiles.entries()) {
      const file = options.files[index];
      if (!file) continue;
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const downgrade = cookieDowngradeForCall(file, call);
        if (downgrade) downgrades.push(downgrade);
      }
    }
    return downgrades.sort(
      (left, right) =>
        left.name.localeCompare(right.name) || (left.site ?? '').localeCompare(right.site ?? ''),
    );
  } finally {
    dispose();
  }
}

function cookieDowngradeForCall(
  file: TrustEscapeSourceFileInput,
  call: Node,
): CookieDowngradeExplain | null {
  if (!Node.isCallExpression(call)) return null;
  if (importedKovoExportName(call.getExpression()) !== 'serializeCookie') return null;

  const args = call.getArguments();
  const nameArg = args[0];
  const optionsArg = args[2];
  if (!nameArg || !isStringLiteralLike(nameArg)) return null;
  if (!optionsArg || !Node.isObjectLiteralExpression(optionsArg)) return null;

  const unsafe = optionsArg.getProperty('unsafe');
  if (!Node.isPropertyAssignment(unsafe)) return null;
  const unsafeCall = unsafe.getInitializer();
  if (!unsafeCall || !Node.isCallExpression(unsafeCall)) return null;
  const downgradeOptions = unsafeCall.getArguments()[0];
  if (!downgradeOptions || !Node.isObjectLiteralExpression(downgradeOptions)) return null;

  const cookieClass = objectStringProperty(optionsArg, 'class');
  if (cookieClass !== 'app-data' && cookieClass !== 'auth' && cookieClass !== 'session')
    return null;
  const downgradeLiteral = downgradeOptions.getProperty('downgrade');
  const downgrade =
    Node.isPropertyAssignment(downgradeLiteral) &&
    Node.isObjectLiteralExpression(downgradeLiteral.getInitializer())
      ? cookieDowngradeFlags(
          downgradeLiteral.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression),
        )
      : {};
  const justification = objectStringProperty(downgradeOptions, 'justification') ?? '';
  return {
    class: cookieClass,
    downgrade,
    justification,
    name: nameArg.getLiteralText(),
    site: siteFor(file, call),
  };
}

function cookieDowngradeFlags(object: Node | undefined): CookieDowngradeExplain['downgrade'] {
  if (!object || !Node.isObjectLiteralExpression(object)) return {};
  const flags: CookieDowngradeExplain['downgrade'] = {};
  const httpOnly = objectBooleanProperty(object, 'httpOnly');
  if (httpOnly !== undefined) flags.httpOnly = httpOnly;
  const secure = objectBooleanProperty(object, 'secure');
  if (secure !== undefined) flags.secure = secure;
  const sameSite = objectStringProperty(object, 'sameSite');
  if (sameSite === 'lax' || sameSite === 'none' || sameSite === 'strict') flags.sameSite = sameSite;
  return flags;
}

function cookieDowngradeSummary(unsafeOptions: Node): string | undefined {
  if (!Node.isObjectLiteralExpression(unsafeOptions)) return undefined;
  const downgrade = unsafeOptions.getProperty('downgrade');
  const object = Node.isPropertyAssignment(downgrade)
    ? downgrade.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression)
    : undefined;
  const flags = cookieDowngradeFlags(object);
  const parts = [
    flags.httpOnly === false ? 'httpOnly' : undefined,
    flags.secure === false ? 'secure' : undefined,
    flags.sameSite ? `sameSite=${flags.sameSite}` : undefined,
  ].filter((value): value is string => value !== undefined);
  return parts.length > 0 ? parts.join('|') : undefined;
}

function objectBooleanProperty(object: Node, propertyName: string): boolean | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const property = object.getProperty(propertyName);
  if (!Node.isPropertyAssignment(property)) return undefined;
  const initializer = property.getInitializer();
  if (initializer?.getKind() === SyntaxKind.TrueKeyword) return true;
  if (initializer?.getKind() === SyntaxKind.FalseKeyword) return false;
  return undefined;
}
