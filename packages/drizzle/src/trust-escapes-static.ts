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

import { Node, Project, SyntaxKind, VariableDeclarationKind, ts, type SourceFile } from 'ts-morph';
import { builtinModules as builtinNodeModules } from 'node:module';
import { posix as nodePath } from 'node:path';
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
  /** Exact authored build-config entry whose deferred preset authority must use built-in witnesses. */
  buildConfigEntryFileName?: string;
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
      // `forget()` detaches wrappers but ts-morph's compiler language service otherwise retains
      // its program caches until GC. Build test processes create many short-lived projects; dispose
      // the service eagerly so security analysis stays bounded under the default Node heap.
      project.getLanguageService().compilerObject.dispose();
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

/**
 * Build-only aggregate for the three static trust surfaces consumed together by `kovo build`.
 * One immutable in-memory syntactic project is shared across the passes so repeated build checks
 * do not retain three ts-morph programs for the same source snapshot. The project still has no
 * ambient filesystem/module-resolution authority: unresolved package code remains a closed
 * verdict (SPEC §6.6 / §11.4).
 *
 * @internal
 */
export function collectStaticBuildTrustFactsFromProject(options: TrustEscapeProjectOptions): {
  capabilities: CapabilityExplain[];
  cookieDowngrades: CookieDowngradeExplain[];
  unregisteredSinks: UnregisteredSinkFact[];
} {
  if (!options.buildConfigEntryFileName && !staticBuildTrustAnalysisRequired(options.files)) {
    return { capabilities: [], cookieDowngrades: [], unregisteredSinks: [] };
  }
  const { sourceFiles, dispose } = createSyntacticProject(options.files);
  try {
    const capabilities: CapabilityExplain[] = [];
    const cookieDowngrades: CookieDowngradeExplain[] = [];
    const unregisteredSinks: UnregisteredSinkFact[] = [];
    for (const [index, sourceFile] of sourceFiles.entries()) {
      const file = options.files[index];
      if (!file) continue;
      capabilities.push(...capabilityEscapesForSourceFile(file, sourceFile));
      unregisteredSinks.push(...unregisteredSinksForSourceFile(file, sourceFile));
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const downgrade = cookieDowngradeForCall(file, call);
        if (downgrade) cookieDowngrades.push(downgrade);
      }
    }
    if (options.buildConfigEntryFileName) {
      const entryIndex = options.files.findIndex(
        (file) => file.fileName === options.buildConfigEntryFileName,
      );
      const entry = entryIndex < 0 ? undefined : options.files[entryIndex];
      const entrySourceFile = entryIndex < 0 ? undefined : sourceFiles[entryIndex];
      if (!entry || !entrySourceFile) {
        unregisteredSinks.push({
          safePath:
            'snapshot the exact kovo.config source entry before evaluating build configuration',
          sink: 'build-config.opaque-authority',
          site: `${options.buildConfigEntryFileName}:1`,
          source: '<missing-build-config-entry>',
        });
      } else {
        const opaqueConfig = requestBuildConfigOpaqueNode(entrySourceFile);
        if (opaqueConfig) {
          unregisteredSinks.push({
            safePath:
              "export default defineConfig({ preset: node|vercel|cloudflare(<closed options>) }) from '@kovojs/server/build'",
            sink: 'build-config.opaque-authority',
            site: siteFor(entry, opaqueConfig),
            source: shortSource(opaqueConfig),
          });
        }
      }
    }
    unregisteredSinks.push(...requestProcessSinksForProject(options.files, sourceFiles));
    return {
      capabilities: capabilities.sort(
        (left, right) =>
          left.kind.localeCompare(right.kind) ||
          left.site.localeCompare(right.site) ||
          (left.target ?? '').localeCompare(right.target ?? ''),
      ),
      cookieDowngrades: cookieDowngrades.sort(
        (left, right) =>
          left.name.localeCompare(right.name) || (left.site ?? '').localeCompare(right.site ?? ''),
      ),
      unregisteredSinks: unregisteredSinks.sort(
        (left, right) => left.site.localeCompare(right.site) || left.sink.localeCompare(right.sink),
      ),
    };
  } finally {
    dispose();
  }
}

const STATIC_BUILD_TRUST_LEXICAL_SIGNAL = new RegExp(
  [
    '\\b(?:Bun|Deno|Function|Worker|cluster|cmd|commandAllowlist|createFileSystemStorage|createRequire|createS3CompatibleStorage|declarePublicRelation|eval|getBuiltinModule|process|require|rootedFiles|serializeCookie|serverValue|setInterval|setTimeout|trustedAssign|unsafeCookie|unsafeInline|unsafeRegex|usePostgresSystemDb)\\b',
    '\\bheaders\\b',
    '\\bimport\\s*\\.\\s*meta\\b',
    '\\.(?:actAs|crossOwnerRead|declareSystemRead|declareSystemWrite|innerHTML|outerHTML|rawRead|unverified)\\b',
    '\\ballowInternal\\b',
    '\\bdocument\\s*(?:\\.|\\[)\\s*[\'"]?write\\b',
  ].join('|'),
  'u',
);

const STATIC_BUILD_REQUEST_PROPERTIES = new Set([
  'access',
  'args',
  'auth',
  'bootstrapScript',
  'boundaries',
  'clientModules',
  'csrf',
  'db',
  'document',
  'errorShells',
  'guard',
  'handler',
  'idempotency',
  'i18n',
  'input',
  'instanceKey',
  'layout',
  'load',
  'meta',
  'modulepreloads',
  'mutationReplayStore',
  'onError',
  'onUnauthenticated',
  'output',
  'page',
  'params',
  'parent',
  'queries',
  'redirectTo',
  'regions',
  'render',
  'renderRoute',
  'replayStore',
  'requestLimits',
  'run',
  'search',
  'sessionProvider',
  'stream',
  'stylesheets',
  'transaction',
  'version',
  'verify',
]);

function staticBuildTrustAnalysisRequired(files: readonly TrustEscapeSourceFileInput[]): boolean {
  const snapshotHasFactoryToken = files.some((file) =>
    /\b(?:createApp|endpoint|layout|mutation|query|route|task|webhook)\b/u.test(file.source),
  );
  return files.some((file) =>
    staticBuildTrustSourceRequiresAnalysis(file, snapshotHasFactoryToken),
  );
}

function staticBuildTrustSourceRequiresAnalysis(
  file: TrustEscapeSourceFileInput,
  snapshotHasFactoryToken: boolean,
): boolean {
  if (STATIC_BUILD_TRUST_LEXICAL_SIGNAL.test(file.source)) return true;
  const sourceFile = ts.createSourceFile(
    file.fileName,
    file.source,
    ts.ScriptTarget.ESNext,
    false,
    staticBuildTrustScriptKind(file.fileName),
  );
  const factoryAliases = new Map<string, (typeof REQUEST_HANDLER_FACTORIES)[number]['exportName']>(
    REQUEST_HANDLER_FACTORIES.map((factory) => [factory.exportName, factory.exportName]),
  );
  const serverNamespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    if (staticBuildTrustBareModuleRequiresAnalysis(specifier)) return true;
    if (!specifier.startsWith('@kovojs/server')) continue;
    const clause = statement.importClause;
    if (!clause?.namedBindings) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      serverNamespaces.add(clause.namedBindings.name.text);
      continue;
    }
    for (const element of clause.namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      const factory = REQUEST_HANDLER_FACTORIES.find(
        (candidate) => candidate.exportName === imported,
      );
      if (factory) factoryAliases.set(element.name.text, factory.exportName);
    }
  }

  let required = false;
  const visit = (node: ts.Node): void => {
    if (required) return;
    if (staticBuildTrustImportMeta(node)) {
      required = true;
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const spread = node.properties.some(ts.isSpreadAssignment);
      if (spread && snapshotHasFactoryToken) {
        required = true;
        return;
      }
      for (const property of node.properties) {
        const name = staticBuildTrustElementName(property);
        if (!name || !STATIC_BUILD_REQUEST_PROPERTIES.has(name)) continue;
        if (staticBuildTrustHandlerPropertyRequiresAnalysis(property)) {
          required = true;
          return;
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const factory = staticBuildTrustFactoryForCall(
        node.expression,
        factoryAliases,
        serverNamespaces,
      );
      if (factory) {
        const definition = [...node.arguments].reverse().find(ts.isObjectLiteralExpression);
        if (!definition) {
          required = true;
          return;
        }
        const property = definition.properties.find(
          (candidate) => staticBuildTrustElementName(candidate) === factory.property,
        );
        if (
          (!property && definition.properties.some(ts.isSpreadAssignment)) ||
          (property && staticBuildTrustHandlerPropertyRequiresAnalysis(property))
        ) {
          required = true;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return required;
}

function staticBuildTrustImportMeta(node: ts.Node): boolean {
  return ts.isMetaProperty(node) && isStaticBuildImportMeta(node);
}

function isStaticBuildImportMeta(node: ts.Expression): boolean {
  let expression = node;
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  return (
    ts.isMetaProperty(expression) &&
    expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    expression.name.text === 'meta'
  );
}

function staticBuildTrustBareModuleRequiresAnalysis(specifier: string): boolean {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@kovojs/')) {
    return false;
  }
  // Ordinary packages and Node builtins can hide request-reachable authority outside the supplied
  // snapshot. The full identity-aware pass decides the verdict; this lightweight prepass only
  // decides whether it is sound to avoid constructing a ts-morph project at all.
  return true;
}

function staticBuildTrustFactoryForCall(
  callee: ts.Expression,
  aliases: ReadonlyMap<string, (typeof REQUEST_HANDLER_FACTORIES)[number]['exportName']>,
  namespaces: ReadonlySet<string>,
): (typeof REQUEST_HANDLER_FACTORIES)[number] | undefined {
  let exportName: (typeof REQUEST_HANDLER_FACTORIES)[number]['exportName'] | undefined;
  if (ts.isIdentifier(callee)) exportName = aliases.get(callee.text);
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    namespaces.has(callee.expression.text)
  ) {
    exportName = REQUEST_HANDLER_FACTORIES.find(
      (candidate) => candidate.exportName === callee.name.text,
    )?.exportName;
  }
  return exportName
    ? REQUEST_HANDLER_FACTORIES.find((candidate) => candidate.exportName === exportName)
    : undefined;
}

function staticBuildTrustHandlerPropertyRequiresAnalysis(
  property: ts.ObjectLiteralElementLike,
): boolean {
  if (ts.isMethodDeclaration(property)) {
    return !!property.body && staticBuildTrustHandlerBodyRequiresAnalysis(property.body);
  }
  if (ts.isPropertyAssignment(property)) {
    const initializer = property.initializer;
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
      return staticBuildTrustHandlerBodyRequiresAnalysis(initializer.body);
    }
  }
  // Shorthands, accessors, imported handlers, and dynamic property values need symbol resolution.
  return true;
}

function staticBuildTrustHandlerBodyRequiresAnalysis(body: ts.ConciseBody): boolean {
  let required = false;
  const visit = (node: ts.Node): void => {
    if (required) return;
    if (
      ts.isCallExpression(node) ||
      ts.isNewExpression(node) ||
      ts.isTaggedTemplateExpression(node) ||
      (ts.isElementAccessExpression(node) && !ts.isStringLiteralLike(node.argumentExpression))
    ) {
      required = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return required;
}

function staticBuildTrustElementName(element: ts.ObjectLiteralElementLike): string | undefined {
  if (
    ts.isMethodDeclaration(element) ||
    ts.isPropertyAssignment(element) ||
    ts.isShorthandPropertyAssignment(element) ||
    ts.isGetAccessorDeclaration(element) ||
    ts.isSetAccessorDeclaration(element)
  ) {
    const name = element.name;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  }
  return undefined;
}

function staticBuildTrustScriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/u.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
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

type RequestRootParameterRole = 'capability' | 'hybrid' | 'input' | 'request';

type RequestWireCarrier =
  | 'context'
  | 'header-enumerator'
  | 'header-getter'
  | 'headers'
  | 'request'
  | 'verification';

interface RequestRootCarrier {
  readonly carrier: Extract<RequestWireCarrier, 'context' | 'request' | 'verification'>;
  readonly index: number;
}

interface RequestRootCallbackSpec {
  readonly carriers?: readonly RequestRootCarrier[];
  readonly kind?: 'direct' | 'meta' | 'record';
  readonly property: string;
  readonly publicWire?: boolean;
  readonly publicWireMethods?: readonly string[];
  readonly publicWirePaths?: readonly (readonly string[])[];
  readonly roles?: readonly RequestRootParameterRole[];
  readonly staticValue?: 'access' | 'guard' | 'redirect' | 'scalar';
}

interface RequestHandlerFactory {
  readonly callbacks: readonly RequestRootCallbackSpec[];
  readonly exportName:
    | 'createApp'
    | 'endpoint'
    | 'layout'
    | 'mutation'
    | 'query'
    | 'route'
    | 'task'
    | 'webhook';
  /** Primary callback retained for the lightweight build prefilter. */
  readonly property: string;
}

/**
 * Public request-reachable callback census (SPEC §6.6). The callback list is intentionally
 * broader than only the value-producing handler: guards, transaction wrappers, metadata,
 * boundaries, and layout composition all execute after request ingress and therefore belong to
 * the same closed authority call graph. `publicWire` marks only callbacks whose return value is
 * serialized or rendered; server-side decisions still receive process-authority analysis.
 */
const REQUEST_HANDLER_FACTORIES = [
  {
    exportName: 'createApp',
    property: 'renderRoute',
    callbacks: [
      {
        carriers: [{ carrier: 'context', index: 1 }],
        property: 'renderRoute',
        publicWire: true,
        roles: ['input', 'capability'],
      },
      {
        kind: 'record',
        property: 'errorShells',
        publicWire: true,
        roles: ['capability'],
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        property: 'sessionProvider',
        publicWirePaths: [['setCookies']],
        roles: ['request'],
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        property: 'db',
        roles: ['request'],
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        property: 'requestLimits.clientIp',
        roles: ['request'],
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        property: 'csrf.sessionId',
        roles: ['request'],
      },
      {
        property: 'onError',
        roles: ['input', 'input'],
      },
      { property: 'clientModules.buildToken', publicWire: true, roles: [] },
      { property: 'clientModules.resolve', publicWire: true, roles: ['input'] },
      { property: 'mutationReplayStore.get', publicWire: true, roles: ['input', 'input', 'input'] },
      { property: 'mutationReplayStore.reserve', roles: ['input', 'input', 'input'] },
      {
        property: 'mutationReplayStore.set',
        roles: ['input', 'input', 'input', 'input'],
      },
    ],
  },
  {
    exportName: 'endpoint',
    property: 'handler',
    callbacks: [
      {
        carriers: [{ carrier: 'request', index: 0 }],
        property: 'handler',
        publicWire: true,
        roles: ['request', 'capability'],
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        kind: 'meta',
        property: 'access',
        roles: ['request'],
        staticValue: 'access',
      },
      {
        carriers: [{ carrier: 'verification', index: 0 }],
        property: 'auth.verify.verify',
        roles: ['input'],
      },
      {
        carriers: [{ carrier: 'verification', index: 0 }],
        property: 'auth.verify.payload',
        roles: ['input', 'capability'],
      },
      {
        carriers: [{ carrier: 'verification', index: 0 }],
        property: 'auth.verify.tolerance.timestamp',
        roles: ['input', 'capability'],
      },
      { property: 'auth.verify.multiSig', roles: ['input'] },
      {
        carriers: [{ carrier: 'verification', index: 0 }],
        property: 'auth.verify.config.payload',
        roles: ['input', 'capability'],
      },
      {
        carriers: [{ carrier: 'verification', index: 0 }],
        property: 'auth.verify.config.tolerance.timestamp',
        roles: ['input', 'capability'],
      },
      { property: 'auth.verify.config.multiSig', roles: ['input'] },
    ],
  },
  {
    exportName: 'mutation',
    property: 'handler',
    callbacks: [
      {
        carriers: [{ carrier: 'request', index: 1 }],
        property: 'handler',
        publicWire: true,
        roles: ['input', 'request', 'capability'],
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        kind: 'meta',
        property: 'access',
        roles: ['request'],
        staticValue: 'access',
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        property: 'guard',
        roles: ['request'],
        staticValue: 'guard',
      },
      { property: 'input.parse', roles: ['input'] },
      { property: 'input.parseAsync', roles: ['input'] },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        property: 'transaction',
        roles: ['request', 'capability'],
      },
      {
        carriers: [{ carrier: 'context', index: 0 }],
        property: 'stream',
        publicWire: true,
        roles: ['capability'],
      },
      {
        property: 'redirectTo',
        publicWire: true,
        roles: ['input'],
        staticValue: 'redirect',
      },
    ],
  },
  {
    exportName: 'query',
    property: 'load',
    callbacks: [
      {
        carriers: [{ carrier: 'context', index: 1 }],
        property: 'load',
        publicWire: true,
        roles: ['input', 'capability'],
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        kind: 'meta',
        property: 'access',
        roles: ['request'],
        staticValue: 'access',
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        property: 'guard',
        roles: ['request'],
        staticValue: 'guard',
      },
      { property: 'args.parse', roles: ['input'] },
      { property: 'args.parseAsync', roles: ['input'] },
      { property: 'output.parse', publicWire: true, roles: ['input'] },
      { property: 'output.parseAsync', publicWire: true, roles: ['input'] },
      { property: 'instanceKey', roles: ['input'], staticValue: 'scalar' },
      { property: 'version', roles: ['input', 'input'], staticValue: 'scalar' },
    ],
  },
  {
    exportName: 'task',
    property: 'run',
    callbacks: [{ property: 'run', roles: ['input', 'capability'] }],
  },
  {
    exportName: 'webhook',
    property: 'handler',
    callbacks: [
      {
        carriers: [{ carrier: 'context', index: 1 }],
        property: 'handler',
        publicWireMethods: ['fail'],
        roles: ['input', 'capability'],
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        kind: 'meta',
        property: 'access',
        roles: ['request'],
        staticValue: 'access',
      },
      { property: 'input.parse', roles: ['input'] },
      { property: 'input.parseAsync', roles: ['input'] },
      { property: 'idempotency', roles: ['input'] },
      {
        carriers: [{ carrier: 'context', index: 0 }],
        property: 'transaction',
        roles: ['capability', 'capability'],
      },
      {
        carriers: [{ carrier: 'verification', index: 0 }],
        property: 'verify.verify',
        roles: ['input'],
      },
      {
        carriers: [{ carrier: 'verification', index: 0 }],
        property: 'verify.payload',
        roles: ['input', 'capability'],
      },
      {
        carriers: [{ carrier: 'verification', index: 0 }],
        property: 'verify.tolerance.timestamp',
        roles: ['input', 'capability'],
      },
      { property: 'verify.multiSig', roles: ['input'] },
      {
        carriers: [{ carrier: 'verification', index: 0 }],
        property: 'verify.config.payload',
        roles: ['input', 'capability'],
      },
      {
        carriers: [{ carrier: 'verification', index: 0 }],
        property: 'verify.config.tolerance.timestamp',
        roles: ['input', 'capability'],
      },
      { property: 'verify.config.multiSig', roles: ['input'] },
      { property: 'replayStore.get', publicWire: true, roles: ['input', 'input'] },
      { property: 'replayStore.reserve', roles: ['input', 'input'] },
      { property: 'replayStore.set', roles: ['input', 'input', 'input'] },
    ],
  },
  {
    exportName: 'route',
    property: 'page',
    callbacks: [
      {
        carriers: [{ carrier: 'request', index: 1 }],
        property: 'page',
        publicWire: true,
        roles: ['hybrid', 'request'],
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        kind: 'meta',
        property: 'access',
        roles: ['request'],
        staticValue: 'access',
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        property: 'guard',
        roles: ['request'],
        staticValue: 'guard',
      },
      { property: 'params.parse', roles: ['input'] },
      { property: 'params.parseAsync', roles: ['input'] },
      { property: 'search.parse', roles: ['input'] },
      { property: 'search.parseAsync', roles: ['input'] },
      {
        carriers: [{ carrier: 'context', index: 0 }],
        property: 'onUnauthenticated',
        publicWire: true,
        roles: ['capability'],
      },
      {
        carriers: [{ carrier: 'context', index: 0 }],
        kind: 'record',
        property: 'boundaries',
        publicWire: true,
        roles: ['capability'],
      },
      {
        carriers: [{ carrier: 'request', index: 1 }],
        kind: 'record',
        property: 'regions',
        publicWire: true,
        roles: ['hybrid', 'request'],
      },
      { kind: 'meta', property: 'meta', publicWire: true, roles: ['hybrid', 'input'] },
    ],
  },
  {
    exportName: 'layout',
    property: 'render',
    callbacks: [
      {
        carriers: [{ carrier: 'context', index: 2 }],
        property: 'render',
        publicWire: true,
        roles: ['input', 'input', 'capability'],
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        kind: 'meta',
        property: 'access',
        roles: ['request'],
        staticValue: 'access',
      },
      {
        carriers: [{ carrier: 'request', index: 0 }],
        property: 'guard',
        roles: ['request'],
        staticValue: 'guard',
      },
      {
        carriers: [{ carrier: 'context', index: 0 }],
        kind: 'record',
        property: 'boundaries',
        publicWire: true,
        roles: ['capability'],
      },
    ],
  },
] as const satisfies readonly RequestHandlerFactory[];

type RequestHandlerFactoryName = (typeof REQUEST_HANDLER_FACTORIES)[number]['exportName'];

const REQUEST_PROCESS_SAFE_PATH =
  'runCommand(cmd(...), ...) with commandAllowlist(...) from @kovojs/server';

const REQUEST_FILESYSTEM_SAFE_PATH =
  'use Kovo rooted file responses or storage capabilities instead of raw filesystem access';

const REQUEST_DYNAMIC_CODE_SAFE_PATH = 'remove request-reachable dynamic code evaluation';

const REQUEST_ENVIRONMENT_SAFE_PATH =
  'read validated server configuration at module initialization and return only an explicitly public projection';

const REQUEST_WIRE_CREDENTIAL_SAFE_PATH =
  'consume request credentials only for server-side authorization and return an app-owned result';

const REQUEST_FETCH_CREDENTIAL_SAFE_PATH =
  'do not forward ambient request credentials through outbound fetch; derive an explicit app-owned credential or authorization decision';

const REQUEST_REVIEWED_DRIZZLE_EXPRESSIONS = new Set([
  'and',
  'arrayContained',
  'arrayContains',
  'arrayOverlaps',
  'asc',
  'between',
  'desc',
  'eq',
  'exists',
  'gt',
  'gte',
  'ilike',
  'inArray',
  'isNotNull',
  'isNull',
  'like',
  'lt',
  'lte',
  'ne',
  'not',
  'notBetween',
  'notExists',
  'notIlike',
  'notInArray',
  'notLike',
  'or',
]);

const REQUEST_REVIEWED_PG_COLUMN_BUILDERS = new Set([
  'bigint',
  'bigserial',
  'bit',
  'boolean',
  'char',
  'cidr',
  'date',
  'doublePrecision',
  'geometry',
  'halfvec',
  'inet',
  'integer',
  'interval',
  'json',
  'jsonb',
  'macaddr',
  'macaddr8',
  'numeric',
  'real',
  'serial',
  'smallint',
  'smallserial',
  'sparsevec',
  'text',
  'time',
  'timestamp',
  'uuid',
  'varchar',
  'vector',
]);

// Callback-bearing column methods (`references`, `$defaultFn`, `$onUpdateFn`, generated
// expressions) are deliberately absent. Their authored code must not inherit pgTable trust.
const REQUEST_REVIEWED_PG_COLUMN_METHODS = new Set([
  'array',
  'default',
  'defaultNow',
  'notNull',
  'primaryKey',
  'unique',
]);

const REQUEST_REVIEWED_DRIZZLE_DB_DATA_METHODS = new Set([
  'delete',
  'from',
  'fullJoin',
  'groupBy',
  'having',
  'innerJoin',
  'insert',
  'leftJoin',
  'limit',
  'offset',
  'onConflictDoNothing',
  'onConflictDoUpdate',
  'orderBy',
  'returning',
  'rightJoin',
  'select',
  'selectDistinct',
  'selectDistinctOn',
  'set',
  'update',
  'values',
  'where',
]);

const REQUEST_REVIEWED_DRIZZLE_DB_READ_SUFFIX_METHODS = new Set([
  'from',
  'fullJoin',
  'groupBy',
  'having',
  'innerJoin',
  'leftJoin',
  'limit',
  'offset',
  'orderBy',
  'rightJoin',
  'where',
]);

const REQUEST_REVIEWED_DRIZZLE_DB_READ_ROOT_METHODS = new Set([
  'select',
  'selectDistinct',
  'selectDistinctOn',
]);

const REQUEST_REVIEWED_RESPOND_METHODS = new Set(['file', 'storedFile', 'stream']);

const REQUEST_SENSITIVE_WIRE_HEADERS: ReadonlyMap<string, string> = new Map([
  ['authorization', 'Authorization'],
  ['cookie', 'Cookie'],
  ['proxy-authorization', 'Proxy-Authorization'],
] as const);

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
  /**
   * True only for a render callback recovered from the canonical `@kovojs/core` `component()`
   * authoring surface. The compiler replaces exact `onX` JSX handler expressions in these
   * callbacks with generated client-module references, so the function object is not public wire
   * data (SPEC §5.2 / §6.6).
   */
  readonly compilerOwnedJsxEventHandlers?: boolean;
  readonly declaration: Node;
  readonly publicWire?: boolean;
  readonly publicWireMethods?: readonly string[];
  readonly publicWirePaths?: readonly (readonly string[])[];
  readonly rootCallback?: string;
  readonly rootCarriers?: readonly RequestRootCarrier[];
  readonly rootFactory?: RequestHandlerFactoryName;
  readonly rootParameterRoles?: readonly RequestRootParameterRole[];
  /** Pre-import source-file execution root; never a public wire-producing callable. */
  readonly moduleInitializer?: boolean;
}

interface RequestCallableResolution {
  readonly callables: readonly RequestCallable[];
  readonly opaqueModule?: string;
}

interface RequestProcessScanContext {
  readonly facts: UnregisteredSinkFact[];
  readonly filesByPath: ReadonlyMap<string, TrustEscapeSourceFileInput>;
  readonly provenance: RequestProvenanceSession;
  readonly retainedConfigTargets: Set<string>;
  readonly scanned: Set<string>;
}

const REQUEST_PROVENANCE_BUDGET = 250_000;
// Independent framework roots multiply every downstream provenance phase. Keep that fan-out
// explicitly bounded as well as the individual graph walk so adversarial source breadth cannot
// turn a fail-closed compiler check into an unbounded release path.
const REQUEST_ROOT_BUDGET = 512;

interface RequestProvenanceSession {
  readonly assignedBindingMemo: Map<string, readonly RequestAssignedBindingProjection[]>;
  readonly callableActive: Set<string>;
  readonly callableMemo: Map<string, RequestCallableResolution>;
  readonly callableSymbolActive: Set<string>;
  readonly callableSymbolMemo: Map<string, RequestCallableResolution>;
  readonly carrierActive: Set<string>;
  readonly carrierMemo: Map<string, RequestWireCarrier | null>;
  readonly drizzleTablePristineMemo: Map<string, boolean>;
  exhaustedAt?: Node;
  readonly factoryActive: Set<string>;
  readonly factoryMemo: Map<string, readonly RequestHandlerFactoryName[]>;
  readonly factorySymbolActive: Set<string>;
  readonly factorySymbolMemo: Map<string, readonly RequestHandlerFactoryName[]>;
  readonly moduleMethodMemo: Map<string, string | null>;
  readonly mutableFactoryReadActive: Set<string>;
  readonly mutableFactoryReadMemo: Map<string, RequestMutableFactoryRead>;
  readonly mutationInvocationActive: Set<string>;
  readonly mutationInvocationMemo: Map<string, readonly Node[]>;
  readonly promiseSettlementCallables: Set<string>;
  readonly prototypeSourceActive: Set<string>;
  readonly prototypeSourceMemo: Map<string, readonly Node[]>;
  readonly protocolPrototypeMemo: Map<string, RequestProtocolPrototypeMutations>;
  readonly reflectivePropertyActive: Set<string>;
  readonly reflectivePropertyMemo: Map<string, RequestReflectivePropertyRead | null>;
  readonly retainedConfigGrammarActive: Set<string>;
  readonly retainedConfigGrammarMemo: Map<string, Node | null>;
  readonly schemaBuilderPristineMemo: Map<string, boolean>;
  remaining: number;
  readonly wireActive: Set<string>;
  readonly wireMemo: Map<string, readonly RequestWireAuthority[]>;
  readonly writeActive: Set<string>;
  readonly writeMemo: Map<string, readonly RequestWireAuthority[]>;
}

function createRequestProvenanceSession(): RequestProvenanceSession {
  return {
    assignedBindingMemo: new Map(),
    callableActive: new Set(),
    callableMemo: new Map(),
    callableSymbolActive: new Set(),
    callableSymbolMemo: new Map(),
    carrierActive: new Set(),
    carrierMemo: new Map(),
    drizzleTablePristineMemo: new Map(),
    factoryActive: new Set(),
    factoryMemo: new Map(),
    factorySymbolActive: new Set(),
    factorySymbolMemo: new Map(),
    moduleMethodMemo: new Map(),
    mutableFactoryReadActive: new Set(),
    mutableFactoryReadMemo: new Map(),
    mutationInvocationActive: new Set(),
    mutationInvocationMemo: new Map(),
    promiseSettlementCallables: new Set(),
    prototypeSourceActive: new Set(),
    prototypeSourceMemo: new Map(),
    protocolPrototypeMemo: new Map(),
    reflectivePropertyActive: new Set(),
    reflectivePropertyMemo: new Map(),
    retainedConfigGrammarActive: new Set(),
    retainedConfigGrammarMemo: new Map(),
    schemaBuilderPristineMemo: new Map(),
    remaining: REQUEST_PROVENANCE_BUDGET,
    wireActive: new Set(),
    wireMemo: new Map(),
    writeActive: new Set(),
    writeMemo: new Map(),
  };
}

function requestProvenanceStep(session: RequestProvenanceSession, node: Node): boolean {
  if (session.remaining > 0) {
    session.remaining -= 1;
    return true;
  }
  session.exhaustedAt ??= node;
  return false;
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
    provenance: createRequestProvenanceSession(),
    retainedConfigTargets: new Set(),
    scanned: new Set(),
  };
  let requestRootCount = 0;

  scanRequestModuleInitializers(sourceFiles, context);

  // Only supplied app snapshots may establish request roots. Resolved local helpers can then be
  // followed transitively, but a package import absent from this project is a closed verdict.
  for (const sourceFile of sourceFiles) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const opaqueFactoryRead = requestOpaqueMutableFactoryRead(
        call.getExpression(),
        context.provenance,
        new Set(),
      );
      if (opaqueFactoryRead) {
        appendOpaqueRequestHandlerFact(context, call, '<unresolved-mutable-factory-provenance>');
      }
      const factoryInvocations = requestHandlerFactoryInvocationsForCall(call, context.provenance);
      for (const invocation of factoryInvocations) {
        if (requestRootCount >= REQUEST_ROOT_BUDGET) {
          appendRequestProvenanceBudgetFact(context, invocation.site);
          flushRequestRetainedConfigPristine(context, sourceFiles);
          return context.facts;
        }
        requestRootCount += 1;
        const { args, factory, site } = invocation;
        if (!args || args.length === 0) {
          appendOpaqueRequestHandlerFact(context, site, '<dynamic-or-empty-config>');
          continue;
        }
        const literalDefinition = [...args]
          .reverse()
          .find((argument) => Node.isObjectLiteralExpression(argument));
        const definition =
          literalDefinition && Node.isObjectLiteralExpression(literalDefinition)
            ? literalDefinition
            : resolveStaticObjectLiteral(args[args.length - 1], new Set(), 0);
        if (!definition) {
          if (args.length > 0) {
            const candidate = args[args.length - 1]!;
            scanRequestRetainedConfigPristine(candidate, context);
            appendOpaqueRequestHandlerFact(
              context,
              candidate,
              opaqueBareModuleForExpression(candidate, new Set(), 0) ?? '<dynamic-config>',
            );
          }
          continue;
        }
        scanRequestRootCallbacks(
          definition,
          factory,
          context,
          args[args.length - 1]!,
          invocation.site.getStart(),
        );
      }
    }
  }

  flushRequestRetainedConfigPristine(context, sourceFiles);

  if (context.provenance.exhaustedAt) {
    appendRequestProvenanceBudgetFact(context, context.provenance.exhaustedAt);
  }

  return context.facts;
}

function scanRequestModuleInitializers(
  sourceFiles: readonly SourceFile[],
  context: RequestProcessScanContext,
): void {
  for (const sourceFile of sourceFiles) {
    scanRequestModuleInitializerEdges(sourceFile.getStatements(), context);
    // The CLI evaluates the supplied app graph only after KV424. Only eager initializers belong to
    // this pre-import graph: lazy function bodies remain owned by request-root reachability. This
    // avoids both false positives and repeated whole-file provenance walks over inert aliases.
    for (const statement of sourceFile.getStatements()) {
      for (const root of requestModuleInitializerRoots(statement)) {
        const body = unwrapStaticExpression(root.body);
        if (
          Node.isCallExpression(body) &&
          (requestRetainedConfigCallIsReviewed(body, context.provenance) ||
            requestModuleInitializerFrameworkAuthorityCallIsClosed(body) ||
            requestModuleInitializerStaticRequireIsReviewed(body) ||
            requestModuleInitializerPublicStyleCallIsClosed(body))
        ) {
          continue;
        }
        scanRequestCallable(root, context);
      }
    }
  }
}

function scanRequestModuleInitializerEdges(
  statements: readonly Node[],
  context: RequestProcessScanContext,
): void {
  for (const statement of statements) {
    if (Node.isImportEqualsDeclaration(statement)) {
      if (statement.isTypeOnly()) continue;
      const reference = statement.getModuleReference();
      if (Node.isExternalModuleReference(reference)) {
        const expression = reference.getExpression();
        const module = isStringLiteralLike(expression) ? expression.getLiteralText() : undefined;
        if (
          !module ||
          requestBuildEvaluatedModuleEdgeRequiresReview(
            module,
            statement.getExternalModuleReferenceSourceFile(),
            context,
          )
        ) {
          appendOpaqueRequestHandlerFact(
            context,
            statement,
            `<opaque-module-initializer:${module ?? shortSource(reference)}>`,
          );
        }
      } else if (reference.getKind() === SyntaxKind.QualifiedName) {
        // `import alias = Namespace.member` lowers to an eager property read. The namespace may
        // have been reflectively given a getter, so a qualified internal alias needs an explicit
        // closed proof before module evaluation; no generated Kovo surface relies on this syntax.
        appendOpaqueRequestHandlerFact(
          context,
          statement,
          `<opaque-module-initializer:import-alias:${shortSource(reference)}>`,
        );
      }
      continue;
    }
    if (Node.isImportDeclaration(statement)) {
      const module = statement.getModuleSpecifierValue();
      if (
        requestImportDeclarationHasRuntimeBindings(statement) &&
        requestBuildEvaluatedModuleEdgeRequiresReview(
          module,
          statement.getModuleSpecifierSourceFile(),
          context,
        )
      ) {
        appendOpaqueRequestHandlerFact(context, statement, `<opaque-module-initializer:${module}>`);
      }
      continue;
    }
    if (Node.isExportDeclaration(statement)) {
      const module = statement.getModuleSpecifierValue();
      if (
        module &&
        requestExportDeclarationHasRuntimeBindings(statement) &&
        requestBuildEvaluatedModuleEdgeRequiresReview(
          module,
          statement.getModuleSpecifierSourceFile(),
          context,
        )
      ) {
        appendOpaqueRequestHandlerFact(context, statement, `<opaque-module-initializer:${module}>`);
      }
      continue;
    }
    if (Node.isModuleDeclaration(statement)) {
      if (
        statement.hasDeclareKeyword() ||
        statement.getSourceFile().isDeclarationFile() ||
        isStringLiteralLike(statement.getNameNode())
      ) {
        continue;
      }
      const body = statement.getBody();
      if (Node.isModuleBlock(body)) {
        scanRequestModuleInitializerEdges(body.getStatements(), context);
      } else if (Node.isModuleDeclaration(body)) {
        scanRequestModuleInitializerEdges([body], context);
      }
    }
  }
}

function requestModuleInitializerRoots(statement: Node): RequestCallable[] {
  if (Node.isVariableStatement(statement)) {
    const declarationKind = statement.getDeclarationKind();
    if (
      declarationKind === VariableDeclarationKind.Using ||
      declarationKind === VariableDeclarationKind.AwaitUsing
    ) {
      // Explicit resource management runs the disposal protocol at scope exit even when the
      // initializer itself is an inert literal or alias. Keep the declaration as the eager root so
      // scanRequestImplicitExecutionProtocols can close Symbol.dispose/Symbol.asyncDispose before
      // the CLI imports the authored module (SPEC.md §6.5).
      return [{ body: statement, declaration: statement, moduleInitializer: true }];
    }
    return statement.getDeclarations().flatMap((declaration): RequestCallable[] => {
      const initializer = declaration.getInitializer();
      if (!initializer) return [];
      const binding = declaration.getNameNode();
      const eagerBinding =
        Node.isObjectBindingPattern(binding) || Node.isArrayBindingPattern(binding);
      if (eagerBinding) {
        // The binding itself is executable: getters/iterators run before nested defaults, and a
        // default initializer may call authority even when the source is otherwise inert.
        return [{ body: declaration, declaration, moduleInitializer: true }];
      }
      return requestModuleInitializerExpressionMayExecute(initializer)
        ? [{ body: initializer, declaration, moduleInitializer: true }]
        : [];
    });
  }
  if (Node.isClassDeclaration(statement)) {
    return requestModuleClassInitializerRoots(statement);
  }
  if (Node.isExpressionStatement(statement) || Node.isExportAssignment(statement)) {
    const expression = statement.getExpression();
    return [{ body: expression, declaration: statement, moduleInitializer: true }];
  }
  if (Node.isModuleDeclaration(statement)) {
    return requestModuleDeclarationInitializerRoots(statement);
  }
  if (Node.isFunctionDeclaration(statement)) return [];
  if (
    Node.isInterfaceDeclaration(statement) ||
    Node.isTypeAliasDeclaration(statement) ||
    Node.isImportDeclaration(statement) ||
    Node.isImportEqualsDeclaration(statement) ||
    Node.isExportDeclaration(statement)
  ) {
    return [];
  }
  return [{ body: statement, declaration: statement, moduleInitializer: true }];
}

function requestModuleDeclarationInitializerRoots(
  declaration: import('ts-morph').ModuleDeclaration,
): RequestCallable[] {
  // Ambient modules/namespaces are erased. A runtime namespace, however, lowers to an eager IIFE;
  // scan its body recursively rather than treating the TypeScript syntax as a lazy declaration.
  if (
    declaration.hasDeclareKeyword() ||
    declaration.getSourceFile().isDeclarationFile() ||
    isStringLiteralLike(declaration.getNameNode())
  ) {
    return [];
  }
  const body = declaration.getBody();
  if (!body) return [];
  if (Node.isModuleDeclaration(body)) {
    return requestModuleDeclarationInitializerRoots(body);
  }
  if (!Node.isModuleBlock(body)) return [];
  return body.getStatements().flatMap(requestModuleInitializerRoots);
}

function requestModuleClassInitializerRoots(
  declaration: import('ts-morph').ClassDeclaration | import('ts-morph').ClassExpression,
): RequestCallable[] {
  const roots: RequestCallable[] = [];
  const add = (body: Node, owner: Node): void => {
    roots.push({ body, declaration: owner, moduleInitializer: true });
  };
  const heritage = declaration.getExtends()?.getExpression();
  if (heritage) add(heritage, declaration);
  for (const decorator of declaration
    .getDescendantsOfKind(SyntaxKind.Decorator)
    .filter(
      (candidate) =>
        candidate.getFirstAncestor(
          (owner) => Node.isClassDeclaration(owner) || Node.isClassExpression(owner),
        ) === declaration,
    )) {
    add(decorator.getExpression(), decorator);
  }
  for (const name of declaration
    .getDescendantsOfKind(SyntaxKind.ComputedPropertyName)
    .filter(
      (candidate) =>
        candidate.getFirstAncestor(
          (owner) => Node.isClassDeclaration(owner) || Node.isClassExpression(owner),
        ) === declaration,
    )) {
    add(name.getExpression(), name);
  }
  for (const property of declaration.getProperties().filter((candidate) => candidate.isStatic())) {
    const initializer = property.getInitializer();
    if (initializer) add(initializer, property);
  }
  for (const block of declaration.getStaticBlocks()) add(block, block);
  return roots;
}

function requestModuleInitializerExpressionMayExecute(expression: Node): boolean {
  const node = unwrapStaticExpression(expression);
  if (
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isFunctionDeclaration(node)
  ) {
    return false;
  }
  if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
    return requestModuleClassInitializerRoots(node).length > 0;
  }
  if (
    Node.isCallExpression(node) ||
    Node.isNewExpression(node) ||
    Node.isAwaitExpression(node) ||
    Node.isTaggedTemplateExpression(node) ||
    Node.isPropertyAccessExpression(node) ||
    Node.isElementAccessExpression(node) ||
    Node.isDeleteExpression(node) ||
    Node.isPrefixUnaryExpression(node) ||
    Node.isPostfixUnaryExpression(node) ||
    Node.isSpreadElement(node) ||
    Node.isSpreadAssignment(node) ||
    Node.isJsxElement(node) ||
    Node.isJsxSelfClosingElement(node) ||
    Node.isJsxFragment(node) ||
    Node.isTemplateExpression(node) ||
    Node.isBinaryExpression(node)
  ) {
    return true;
  }
  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().some((property) => {
      if (Node.isSpreadAssignment(property)) return true;
      const name = requestObjectLiteralElementNameNode(property);
      if (Node.isComputedPropertyName(name)) return true;
      const value = requestHandlerPropertyExpression(property);
      return !!value && requestModuleInitializerExpressionMayExecute(value);
    });
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().some((element) => {
      if (Node.isSpreadElement(element)) return true;
      return requestModuleInitializerExpressionMayExecute(element);
    });
  }
  if (Node.isConditionalExpression(node)) {
    return [node.getCondition(), node.getWhenTrue(), node.getWhenFalse()].some(
      requestModuleInitializerExpressionMayExecute,
    );
  }
  return node.getChildren().some(requestModuleInitializerExpressionMayExecute);
}

const REQUEST_BUILD_CONFIG_EXPORTS = new Set(['cloudflare', 'defineConfig', 'node', 'vercel']);

function requestBuildConfigOpaqueNode(sourceFile: SourceFile): Node | undefined {
  const assignments: import('ts-morph').ExportAssignment[] = [];
  for (const statement of sourceFile.getStatements()) {
    if (Node.isImportDeclaration(statement)) {
      if (statement.isTypeOnly()) continue;
      if (
        statement.getModuleSpecifierValue() !== '@kovojs/server/build' ||
        statement.getDefaultImport() ||
        statement.getNamespaceImport()
      ) {
        return statement;
      }
      const imports = statement.getNamedImports().filter((entry) => !entry.isTypeOnly());
      if (
        imports.length === 0 ||
        imports.some(
          (entry) =>
            entry.getAliasNode() !== undefined ||
            !REQUEST_BUILD_CONFIG_EXPORTS.has(entry.getName()),
        )
      ) {
        return statement;
      }
      continue;
    }
    if (Node.isImportEqualsDeclaration(statement) && statement.isTypeOnly()) continue;
    if (Node.isExportAssignment(statement)) {
      assignments.push(statement);
      continue;
    }
    if (
      Node.isInterfaceDeclaration(statement) ||
      Node.isTypeAliasDeclaration(statement) ||
      (Node.isExportDeclaration(statement) && statement.isTypeOnly()) ||
      statement.getKind() === SyntaxKind.EmptyStatement
    ) {
      continue;
    }
    return statement;
  }
  if (assignments.length !== 1) return assignments[1] ?? sourceFile;
  const assignment = assignments[0]!;
  if (assignment.isExportEquals()) return assignment;
  const expression = unwrapStaticExpression(assignment.getExpression());
  if (
    !Node.isCallExpression(expression) ||
    !requestExpressionIsDirectImportedExport(
      expression.getExpression(),
      '@kovojs/server/build',
      'defineConfig',
    ) ||
    expression.getArguments().length !== 1
  ) {
    return expression;
  }
  const config = unwrapStaticExpression(expression.getArguments()[0]!);
  if (!Node.isObjectLiteralExpression(config)) return config;
  let sawPreset = false;
  for (const property of config.getProperties()) {
    if (
      !Node.isPropertyAssignment(property) ||
      Node.isComputedPropertyName(property.getNameNode())
    ) {
      return property;
    }
    if (staticMemberName(property.getNameNode()) !== 'preset' || sawPreset) return property;
    sawPreset = true;
    const initializer = property.getInitializer();
    if (!initializer || !requestBuildConfigPresetCallIsClosed(initializer)) {
      return initializer ?? property;
    }
  }
  return undefined;
}

function requestBuildConfigPresetCallIsClosed(expression: Node): boolean {
  const node = unwrapStaticExpression(expression);
  if (!Node.isCallExpression(node)) return false;
  const identity = requestImportedModuleExportForExpression(
    node.getExpression(),
    (specifier) => specifier === '@kovojs/server/build',
    new Set(),
    0,
  );
  if (!identity || !['cloudflare', 'node', 'vercel'].includes(identity.exportName)) return false;
  const args = node.getArguments();
  return args.length <= 1 && args.every(requestExpressionIsClosedStaticData);
}

function requestBuildConfigConstructorCallIsClosed(
  call: import('ts-morph').CallExpression,
): boolean {
  if (requestBuildConfigPresetCallIsClosed(call)) return true;
  if (
    !requestExpressionIsDirectImportedExport(
      call.getExpression(),
      '@kovojs/server/build',
      'defineConfig',
    ) ||
    call.getArguments().length !== 1
  ) {
    return false;
  }
  const config = unwrapStaticExpression(call.getArguments()[0]!);
  if (!Node.isObjectLiteralExpression(config)) return false;
  let sawPreset = false;
  return config.getProperties().every((property) => {
    if (
      !Node.isPropertyAssignment(property) ||
      Node.isComputedPropertyName(property.getNameNode())
    ) {
      return false;
    }
    if (staticMemberName(property.getNameNode()) !== 'preset' || sawPreset) return false;
    sawPreset = true;
    const initializer = property.getInitializer();
    return !!initializer && requestBuildConfigPresetCallIsClosed(initializer);
  });
}

// Import declarations are executable module-initializer edges even when none of their bindings
// are referenced. Keep the SSR-evaluated third-party graph finite: only the exact dependencies
// whose initializer behavior is part of Kovo's reviewed starter/runtime contract may cross the
// pre-import KV424 gate. Explicit type-only imports are erased and therefore inert.
const REQUEST_REVIEWED_BUILD_EVALUATED_MODULES = new Set([
  '@electric-sql/pglite',
  '@kovojs/better-auth',
  '@kovojs/browser',
  '@kovojs/core',
  '@kovojs/drizzle',
  '@kovojs/server',
  '@kovojs/server/build',
  '@kovojs/style',
  '@kovojs/ui/badge',
  '@kovojs/ui/button',
  '@kovojs/ui/card',
  'better-auth',
  'better-auth/adapters/drizzle',
  'better-sqlite3',
  'drizzle-orm',
  'drizzle-orm/better-sqlite3',
  'drizzle-orm/pg-core',
  'drizzle-orm/pglite',
  'drizzle-orm/relations',
  'drizzle-orm/sqlite-core',
]);

function requestBuildEvaluatedModuleRequiresReview(module: string): boolean {
  // Only graph-relative modules are eligible for inclusion in the immutable app snapshot.
  // Rooted/Vite `/@fs/` specifiers can escape that boundary and must never inherit local trust.
  if (module.startsWith('.')) return false;
  if (NODE_BUILTIN_MODULES.has(module)) return false;
  return !REQUEST_REVIEWED_BUILD_EVALUATED_MODULES.has(module);
}

function requestBuildStaticAssetModuleSpecifierIsReviewed(module: string): boolean {
  // CSS is parsed as data by Kovo's configFile:false Vite pipeline, not evaluated as JavaScript.
  // Keep this finite and same-directory rooted; other extensions and parent/rooted paths remain
  // behind the immutable source-graph gate.
  return /^\.\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.css$/u.test(module);
}

function requestBuildEvaluatedModuleEdgeRequiresReview(
  module: string,
  resolved: SourceFile | undefined,
  context: RequestProcessScanContext,
): boolean {
  if (requestBuildStaticAssetModuleSpecifierIsReviewed(module)) return false;
  if (!module.startsWith('.')) return requestBuildEvaluatedModuleRequiresReview(module);
  // A relative spelling is not proof that Vite will stay inside the immutable preflight graph.
  // The exact resolved source must be one of the caller-supplied snapshots; unresolved `../`
  // edges fail before SSR evaluation.
  return !resolved || !context.filesByPath.has(resolved.getFilePath());
}

function requestImportDeclarationHasRuntimeBindings(
  declaration: import('ts-morph').ImportDeclaration,
): boolean {
  if (declaration.isTypeOnly()) return false;
  const clause = declaration.getImportClause();
  if (!clause) return true;
  if (clause.getDefaultImport() || clause.getNamespaceImport()) return true;
  const named = declaration.getNamedImports();
  return named.length === 0 || named.some((specifier) => !specifier.isTypeOnly());
}

function requestExportDeclarationHasRuntimeBindings(
  declaration: import('ts-morph').ExportDeclaration,
): boolean {
  if (declaration.isTypeOnly()) return false;
  const named = declaration.getNamedExports();
  return named.length === 0 || named.some((specifier) => !specifier.isTypeOnly());
}

function requestModuleInitializerFrameworkAuthorityCallIsClosed(
  call: import('ts-morph').CallExpression,
): boolean {
  const minter = REQUEST_FRAMEWORK_AUTHORITY_MINTERS.find((candidate) =>
    [candidate.module, '@kovojs/server'].some((module) =>
      requestExpressionIsDirectImportedExport(call.getExpression(), module, candidate.exportName),
    ),
  );
  if (!minter || call.getArguments().length === 0) return false;
  return call
    .getArguments()
    .every((argument) => requestModuleInitializerAuthorityArgumentIsClosed(argument, new Set()));
}

function requestModuleInitializerStaticRequireIsReviewed(
  call: import('ts-morph').CallExpression,
): boolean {
  return isStaticRequireOf(call, (module) => {
    if (module.startsWith('.')) return false;
    return !requestBuildEvaluatedModuleRequiresReview(module);
  });
}

function requestModuleInitializerPublicStyleCallIsClosed(
  call: import('ts-morph').CallExpression,
): boolean {
  return !!(
    requestCallIsPublicStyleCreate(call) &&
    call.getArguments().every((argument) => requestModuleInitializerStyleValueIsClosed(argument))
  );
}

function requestModuleInitializerStyleValueIsClosed(expression: Node): boolean {
  if (requestExpressionIsClosedStaticData(expression)) return true;
  const node = unwrapStaticExpression(expression);
  if (requestExpressionIsExactStyleTokenPath(node)) return true;
  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().every((element) => {
      if (Node.isSpreadElement(element)) return false;
      return requestModuleInitializerStyleValueIsClosed(element);
    });
  }
  if (Node.isObjectLiteralExpression(node)) {
    return node
      .getProperties()
      .every(
        (property) =>
          Node.isPropertyAssignment(property) &&
          !Node.isComputedPropertyName(property.getNameNode()) &&
          !!property.getInitializer() &&
          requestModuleInitializerStyleValueIsClosed(property.getInitializer()!),
      );
  }
  return false;
}

function requestExpressionIsExactStyleTokenPath(expression: Node): boolean {
  let node = unwrapStaticExpression(expression);
  const path: string[] = [];
  while (Node.isPropertyAccessExpression(node)) {
    path.unshift(node.getName());
    node = unwrapStaticExpression(node.getExpression());
  }
  if (path[0] !== 'tokens' || !Node.isIdentifier(node)) return false;
  return (node.getSymbol()?.getDeclarations() ?? []).some((declaration) => {
    if (!Node.isNamespaceImport(declaration)) return false;
    return (
      declaration
        .getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
        ?.getModuleSpecifierValue() === '@kovojs/style'
    );
  });
}

function requestModuleInitializerAuthorityArgumentIsClosed(
  expression: Node,
  seen: Set<string>,
): boolean {
  if (requestExpressionIsClosedStaticData(expression)) return true;
  const node = unwrapStaticExpression(expression);
  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().every((element) => {
      if (Node.isSpreadElement(element)) return false;
      return requestModuleInitializerAuthorityArgumentIsClosed(element, new Set(seen));
    });
  }
  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().every((property) => {
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        return (
          !Node.isComputedPropertyName(property.getNameNode()) &&
          !!initializer &&
          requestModuleInitializerAuthorityArgumentIsClosed(initializer, new Set(seen))
        );
      }
      if (Node.isShorthandPropertyAssignment(property)) {
        return requestModuleInitializerAuthorityArgumentIsClosed(
          property.getNameNode(),
          new Set(seen),
        );
      }
      return false;
    });
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = requestIdentifierValueSymbol(node) ?? node.getSymbol();
  if (!symbol) return false;
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return false;
  seen.add(key);
  return symbol.getDeclarations().some((declaration) => {
    if (
      !Node.isVariableDeclaration(declaration) ||
      declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
    ) {
      return false;
    }
    const initializer = declaration.getInitializer();
    const value = initializer ? unwrapStaticExpression(initializer) : undefined;
    return !!(
      value &&
      Node.isCallExpression(value) &&
      requestModuleInitializerFrameworkAuthorityCallIsClosed(value)
    );
  });
}

interface RequestHandlerFactoryInvocation {
  readonly args?: readonly Node[];
  readonly factory: (typeof REQUEST_HANDLER_FACTORIES)[number];
  readonly site: Node;
}

function requestHandlerFactoryInvocationsForCall(
  call: import('ts-morph').CallExpression,
  session: RequestProvenanceSession,
): RequestHandlerFactoryInvocation[] {
  const callee = unwrapStaticExpression(call.getExpression());
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  let names: readonly RequestHandlerFactoryName[] = [];
  let args: readonly Node[] | undefined = call.getArguments();
  const adapted = requestAdaptedFactoryInvocation(call);

  if (adapted) {
    names = requestFrameworkFactoriesForExpression(adapted.target, session);
    args = adapted.args;
  } else if (
    receiver &&
    member === 'apply' &&
    expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0)
  ) {
    const [target, _thisArg, argumentList] = call.getArguments();
    if (target) names = requestFrameworkFactoriesForExpression(target, session);
    args = requestStaticArgumentList(argumentList);
  } else if (receiver && (member === 'call' || member === 'apply')) {
    names = requestFrameworkFactoriesForExpression(receiver, session);
    args =
      member === 'call'
        ? call.getArguments().slice(1)
        : requestStaticArgumentList(call.getArguments()[1]);
  } else {
    names = requestFrameworkFactoriesForExpression(callee, session);
  }

  return names.flatMap((name) => {
    const factory = REQUEST_HANDLER_FACTORIES.find((candidate) => candidate.exportName === name);
    return factory ? [{ ...(args === undefined ? {} : { args }), factory, site: call }] : [];
  });
}

interface RequestAdaptedFactoryInvocation {
  readonly args?: readonly Node[];
  readonly target: Node;
}

type RequestInvocationAdapter =
  | 'function-apply'
  | 'function-call'
  | 'reflect-apply'
  | 'reflect-construct';

function requestAdaptedFactoryInvocation(
  call: import('ts-morph').CallExpression,
): RequestAdaptedFactoryInvocation | undefined {
  const callee = unwrapStaticExpression(call.getExpression());
  const direct = requestInvocationAdapterForExpression(callee, new Set());
  if (direct === 'reflect-apply' || direct === 'reflect-construct') {
    const [target, _thisArgOrArgs, maybeArgs] = call.getArguments();
    if (!target) return undefined;
    const argumentList =
      direct === 'reflect-construct'
        ? requestStaticArgumentList(_thisArgOrArgs)
        : requestStaticArgumentList(maybeArgs);
    return { ...(argumentList === undefined ? {} : { args: argumentList }), target };
  }

  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  if (!receiver || (member !== 'call' && member !== 'apply')) return undefined;
  const nested = requestInvocationAdapterForExpression(receiver, new Set());
  if (!nested) return undefined;
  const outerArgs = call.getArguments();
  if (nested === 'reflect-apply' || nested === 'reflect-construct') {
    const nestedArgs =
      member === 'call' ? outerArgs.slice(1) : requestStaticArgumentList(outerArgs[1]);
    if (!nestedArgs) return undefined;
    const [target, _thisArgOrArgs, maybeArgs] = nestedArgs;
    if (!target) return undefined;
    const argumentList =
      nested === 'reflect-construct'
        ? requestStaticArgumentList(_thisArgOrArgs)
        : requestStaticArgumentList(maybeArgs);
    return { ...(argumentList === undefined ? {} : { args: argumentList }), target };
  }
  if (member === 'apply') {
    const applied = requestStaticArgumentList(outerArgs[1]);
    if (!applied) return undefined;
    const [target, thisArg, argumentList] = applied;
    if (!target) return undefined;
    const args =
      nested === 'function-call'
        ? applied.slice(2)
        : requestStaticArgumentList(argumentList ?? thisArg);
    return { ...(args === undefined ? {} : { args }), target };
  }
  const [target, _thisArg, ...rest] = outerArgs;
  if (!target) return undefined;
  const args = nested === 'function-call' ? rest.slice(1) : requestStaticArgumentList(rest[1]);
  return { ...(args === undefined ? {} : { args }), target };
}

function requestInvocationAdapterForExpression(
  expression: Node,
  seen: Set<string>,
): RequestInvocationAdapter | undefined {
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  if (seen.has(key)) return undefined;
  seen.add(key);
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    const owner = unwrapStaticExpression(node.getExpression());
    if (
      (member === 'apply' || member === 'construct') &&
      expressionResolvesToGlobalNamespace(owner, 'Reflect', new Set(), 0)
    ) {
      return member === 'apply' ? 'reflect-apply' : 'reflect-construct';
    }
    if (member === 'call' || member === 'apply') {
      if (Node.isPropertyAccessExpression(owner) || Node.isElementAccessExpression(owner)) {
        const prototype = Node.isPropertyAccessExpression(owner)
          ? staticMemberName(owner.getNameNode())
          : staticMemberName(owner.getArgumentExpression());
        const global = unwrapStaticExpression(owner.getExpression());
        if (
          prototype === 'prototype' &&
          Node.isIdentifier(global) &&
          unshadowedGlobalIdentifier(global, 'Function')
        ) {
          return member === 'call' ? 'function-call' : 'function-apply';
        }
      }
    }
  }
  if (!Node.isIdentifier(node) || !node.getSymbol()) return undefined;
  for (const declaration of node.getSymbol()!.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (!initializer) continue;
    const adapter = requestInvocationAdapterForExpression(initializer, new Set(seen));
    if (adapter) return adapter;
  }
  return undefined;
}

function requestStaticArgumentList(
  expression: Node | undefined,
  seen = new Set<string>(),
): readonly Node[] | undefined {
  const node = expression ? unwrapStaticExpression(expression) : undefined;
  if (!node) return undefined;
  if (Node.isArrayLiteralExpression(node)) return node.getElements();
  if (!Node.isIdentifier(node)) return undefined;
  const symbol = requestIdentifierValueSymbol(node);
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return undefined;
    seen.add(key);
    for (const declaration of symbol.getDeclarations()) {
      const initializer = valueDeclarationInitializer(declaration);
      const args = requestStaticArgumentList(initializer, seen);
      if (args) return args;
    }
  }
  const declaration = localValueDeclaration(node);
  const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
  return requestStaticArgumentList(initializer, seen);
}

interface RequestReflectivePropertyRead {
  readonly member?: string;
  readonly owner: Node;
}

function requestReflectivePropertyRead(
  expression: Node,
  seen: Set<string>,
  session?: RequestProvenanceSession,
): RequestReflectivePropertyRead | undefined {
  if (!session) return requestReflectivePropertyReadUncached(expression, seen);
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  const memoized = session.reflectivePropertyMemo.get(key);
  if (memoized !== undefined) return memoized ?? undefined;
  if (session.reflectivePropertyActive.has(key)) return undefined;
  session.reflectivePropertyActive.add(key);
  try {
    const resolved = requestReflectivePropertyReadUncached(expression, seen, session);
    session.reflectivePropertyMemo.set(key, resolved ?? null);
    return resolved;
  } finally {
    session.reflectivePropertyActive.delete(key);
  }
}

function requestReflectivePropertyReadUncached(
  expression: Node,
  seen: Set<string>,
  session?: RequestProvenanceSession,
): RequestReflectivePropertyRead | undefined {
  const node = unwrapStaticExpression(expression);
  const key = `reflective-property:${requestNodeIdentity(node)}`;
  if (seen.has(key)) return undefined;
  seen.add(key);

  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    if (
      receiver &&
      requestStaticCallMember(callee) === 'get' &&
      expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0)
    ) {
      const [owner, property] = node.getArguments();
      return owner ? { owner, ...optionalMember(staticMemberName(property)) } : undefined;
    }
  }

  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    if (member === 'value') {
      return requestDescriptorPropertyRead(node.getExpression(), seen);
    }
  }

  if (Node.isConditionalExpression(node)) {
    return (
      requestReflectivePropertyRead(node.getWhenTrue(), new Set(seen), session) ??
      requestReflectivePropertyRead(node.getWhenFalse(), new Set(seen), session)
    );
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (operator === SyntaxKind.CommaToken) {
      return requestReflectivePropertyRead(node.getRight(), seen, session);
    }
    if (
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return (
        requestReflectivePropertyRead(node.getLeft(), new Set(seen), session) ??
        requestReflectivePropertyRead(node.getRight(), new Set(seen), session)
      );
    }
  }
  if (!Node.isIdentifier(node)) return undefined;
  const symbol = requestIdentifierValueSymbol(node);
  if (!symbol) return undefined;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return undefined;
  seen.add(symbolKey);
  for (const declaration of symbol.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (!initializer) continue;
    const reflected = requestReflectivePropertyRead(initializer, new Set(seen), session);
    if (reflected) return reflected;
  }
  for (const projection of requestAssignedBindingProjections(symbol)) {
    if (projection.path.length > 0) continue;
    const reflected = requestReflectivePropertyRead(projection.expression, new Set(seen), session);
    if (reflected) return reflected;
  }
  return undefined;
}

function requestDescriptorPropertyRead(
  expression: Node,
  seen: Set<string>,
): RequestReflectivePropertyRead | undefined {
  const node = unwrapStaticExpression(expression);
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    const method = requestStaticCallMember(callee);
    if (
      receiver &&
      method === 'getOwnPropertyDescriptor' &&
      (expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) ||
        expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0))
    ) {
      const [owner, property] = node.getArguments();
      return owner ? { owner, ...optionalMember(staticMemberName(property)) } : undefined;
    }
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    const call = unwrapStaticExpression(node.getExpression());
    if (Node.isCallExpression(call)) {
      const callee = unwrapStaticExpression(call.getExpression());
      const receiver = requestCallReceiver(callee);
      if (
        receiver &&
        requestStaticCallMember(callee) === 'getOwnPropertyDescriptors' &&
        expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0)
      ) {
        const [owner] = call.getArguments();
        return owner ? { owner, ...optionalMember(member) } : undefined;
      }
    }
  }
  if (!Node.isIdentifier(node)) return undefined;
  const symbol = node.getSymbol();
  if (!symbol) return undefined;
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return undefined;
  seen.add(key);
  for (const declaration of symbol.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (!initializer) continue;
    const reflected = requestDescriptorPropertyRead(initializer, new Set(seen));
    if (reflected) return reflected;
  }
  for (const projection of requestAssignedBindingProjections(symbol)) {
    if (projection.path.length > 0) continue;
    const reflected = requestDescriptorPropertyRead(projection.expression, new Set(seen));
    if (reflected) return reflected;
  }
  return undefined;
}

function optionalMember(member: string | undefined): { readonly member?: string } {
  return member === undefined ? {} : { member };
}

type RequestFrameworkFallbackIdentity = RequestHandlerFactoryName | 'namespace';

function requestFrameworkFallbackIdentities(
  expression: Node,
  session: RequestProvenanceSession,
  seen: Set<string>,
  depth: number,
): readonly RequestFrameworkFallbackIdentity[] {
  const node = unwrapStaticExpression(expression);
  const key = `framework-fallback:${requestNodeIdentity(node)}`;
  if (depth > 64 || seen.has(key) || !requestProvenanceStep(session, node)) return [];
  seen.add(key);
  const resolved = new Set<RequestFrameworkFallbackIdentity>();
  const canonical = canonicalFrameworkExportForExpression(node);
  if (
    canonical?.module === '@kovojs/server' &&
    REQUEST_HANDLER_FACTORIES.some((factory) => factory.exportName === canonical.exportName)
  ) {
    resolved.add(canonical.exportName as RequestHandlerFactoryName);
  }
  if (Node.isAwaitExpression(node)) {
    for (const identity of requestFrameworkFallbackIdentities(
      node.getExpression(),
      session,
      new Set(seen),
      depth + 1,
    )) {
      resolved.add(identity);
    }
  }
  if (Node.isCallExpression(node) && node.getExpression().getKind() === SyntaxKind.ImportKeyword) {
    const [specifier] = node.getArguments();
    if (
      specifier &&
      isStringLiteralLike(specifier) &&
      specifier.getLiteralText() === '@kovojs/server'
    ) {
      resolved.add('namespace');
    }
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    if (
      member &&
      REQUEST_HANDLER_FACTORIES.some((factory) => factory.exportName === member) &&
      requestFrameworkFallbackIdentities(
        node.getExpression(),
        session,
        new Set(seen),
        depth + 1,
      ).includes('namespace')
    ) {
      resolved.add(member as RequestHandlerFactoryName);
    }
  }
  if (Node.isConditionalExpression(node)) {
    for (const branch of [node.getWhenTrue(), node.getWhenFalse()]) {
      for (const identity of requestFrameworkFallbackIdentities(
        branch,
        session,
        new Set(seen),
        depth + 1,
      )) {
        resolved.add(identity);
      }
    }
  }
  if (!Node.isIdentifier(node)) return [...resolved];

  const local = node.getText();
  for (const declaration of node.getSourceFile().getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (declaration.getNamespaceImport()?.getText() === local) {
      for (const identity of requestFrameworkModuleExportIdentities(
        node.getSourceFile(),
        specifier,
        'namespace',
        session,
        new Set(seen),
        depth + 1,
      )) {
        resolved.add(identity);
      }
    }
    if (declaration.getDefaultImport()?.getText() === local) {
      for (const identity of requestFrameworkModuleExportIdentities(
        node.getSourceFile(),
        specifier,
        'default',
        session,
        new Set(seen),
        depth + 1,
      )) {
        resolved.add(identity);
      }
    }
    for (const named of declaration.getNamedImports()) {
      if ((named.getAliasNode()?.getText() ?? named.getName()) !== local) continue;
      for (const identity of requestFrameworkModuleExportIdentities(
        node.getSourceFile(),
        specifier,
        named.getName(),
        session,
        new Set(seen),
        depth + 1,
      )) {
        resolved.add(identity);
      }
    }
  }
  const symbol = node.getSymbol();
  for (const declaration of symbol?.getDeclarations() ?? []) {
    const initializer = valueDeclarationInitializer(declaration);
    if (!initializer) continue;
    for (const identity of requestFrameworkFallbackIdentities(
      initializer,
      session,
      new Set(seen),
      depth + 1,
    )) {
      resolved.add(identity);
    }
  }
  return [...resolved];
}

function requestFrameworkModuleExportIdentities(
  from: SourceFile,
  specifier: string,
  exported: string,
  session: RequestProvenanceSession,
  seen: Set<string>,
  depth: number,
): readonly RequestFrameworkFallbackIdentity[] {
  if (specifier === '@kovojs/server') {
    if (exported === 'namespace') return ['namespace'];
    return REQUEST_HANDLER_FACTORIES.some((factory) => factory.exportName === exported)
      ? [exported as RequestHandlerFactoryName]
      : [];
  }
  const sourceFile = requestRelativeModuleSourceFile(from, specifier);
  if (!sourceFile) return [];
  return requestFrameworkSourceExportIdentities(sourceFile, exported, session, seen, depth + 1);
}

function requestFrameworkSourceExportIdentities(
  sourceFile: SourceFile,
  exported: string,
  session: RequestProvenanceSession,
  seen: Set<string>,
  depth: number,
): readonly RequestFrameworkFallbackIdentity[] {
  const key = `framework-source-export:${sourceFile.getFilePath()}:${exported}`;
  if (depth > 64 || seen.has(key)) return [];
  seen.add(key);
  const resolved = new Set<RequestFrameworkFallbackIdentity>();
  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    const namespace = declaration.getNamespaceExport()?.getName();
    if (namespace === exported && specifier) {
      for (const identity of requestFrameworkModuleExportIdentities(
        sourceFile,
        specifier,
        'namespace',
        session,
        new Set(seen),
        depth + 1,
      )) {
        resolved.add(identity);
      }
    }
    for (const named of declaration.getNamedExports()) {
      if ((named.getAliasNode()?.getText() ?? named.getName()) !== exported) continue;
      const local = named.getName();
      if (specifier) {
        for (const identity of requestFrameworkModuleExportIdentities(
          sourceFile,
          specifier,
          local,
          session,
          new Set(seen),
          depth + 1,
        )) {
          resolved.add(identity);
        }
      } else {
        for (const identity of requestFrameworkLocalExportIdentities(
          sourceFile,
          local,
          session,
          new Set(seen),
          depth + 1,
        )) {
          resolved.add(identity);
        }
      }
    }
    if (!namespace && declaration.getNamedExports().length === 0 && specifier) {
      for (const identity of requestFrameworkModuleExportIdentities(
        sourceFile,
        specifier,
        exported,
        session,
        new Set(seen),
        depth + 1,
      )) {
        resolved.add(identity);
      }
    }
  }
  if (exported === 'default') {
    for (const assignment of sourceFile.getExportAssignments()) {
      if (assignment.isExportEquals()) continue;
      for (const identity of requestFrameworkFallbackIdentities(
        assignment.getExpression(),
        session,
        new Set(seen),
        depth + 1,
      )) {
        resolved.add(identity);
      }
    }
  }
  for (const identity of requestFrameworkLocalExportIdentities(
    sourceFile,
    exported,
    session,
    new Set(seen),
    depth + 1,
  )) {
    resolved.add(identity);
  }
  return [...resolved];
}

function requestFrameworkLocalExportIdentities(
  sourceFile: SourceFile,
  local: string,
  session: RequestProvenanceSession,
  seen: Set<string>,
  depth: number,
): readonly RequestFrameworkFallbackIdentity[] {
  const resolved = new Set<RequestFrameworkFallbackIdentity>();
  for (const declaration of sourceFile.getVariableDeclarations()) {
    if (declaration.getName() !== local) continue;
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    for (const identity of requestFrameworkFallbackIdentities(
      initializer,
      session,
      new Set(seen),
      depth + 1,
    )) {
      resolved.add(identity);
    }
  }
  for (const declaration of sourceFile.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (declaration.getDefaultImport()?.getText() === local) {
      for (const identity of requestFrameworkModuleExportIdentities(
        sourceFile,
        specifier,
        'default',
        session,
        new Set(seen),
        depth + 1,
      )) {
        resolved.add(identity);
      }
    }
    if (declaration.getNamespaceImport()?.getText() === local) {
      for (const identity of requestFrameworkModuleExportIdentities(
        sourceFile,
        specifier,
        'namespace',
        session,
        new Set(seen),
        depth + 1,
      )) {
        resolved.add(identity);
      }
    }
    for (const named of declaration.getNamedImports()) {
      if ((named.getAliasNode()?.getText() ?? named.getName()) !== local) continue;
      for (const identity of requestFrameworkModuleExportIdentities(
        sourceFile,
        specifier,
        named.getName(),
        session,
        new Set(seen),
        depth + 1,
      )) {
        resolved.add(identity);
      }
    }
  }
  return [...resolved];
}

function requestRelativeModuleSourceFile(
  from: SourceFile,
  specifier: string,
): SourceFile | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const target = nodePath.normalize(nodePath.join(nodePath.dirname(from.getFilePath()), specifier));
  const base = target.replace(/\.[cm]?[jt]sx?$/, '');
  return from
    .getProject()
    .getSourceFiles()
    .find((candidate) => candidate.getFilePath().replace(/\.[cm]?[jt]sx?$/, '') === base);
}

function requestFrameworkFactoriesForExpression(
  expression: Node,
  session: RequestProvenanceSession,
): readonly RequestHandlerFactoryName[] {
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  const memoized = session.factoryMemo.get(key);
  if (memoized) return memoized;
  if (session.factoryActive.has(key) || !requestProvenanceStep(session, node)) return [];
  session.factoryActive.add(key);

  // Immutable, unshadowed module aliases are a syntactically complete provenance chain. Flatten
  // them before asking TypeScript for a symbol: the checker recursively resolves identifier aliases
  // and can otherwise overflow its own stack on adversarially long but valid chains.
  const moduleAlias = requestModuleConstAliasChain(node);
  if (moduleAlias) {
    let withinBudget = true;
    for (const alias of moduleAlias.nodes.slice(1)) {
      if (!requestProvenanceStep(session, alias)) {
        withinBudget = false;
        break;
      }
    }
    const result =
      withinBudget && moduleAlias.terminal
        ? requestFrameworkFactoriesForExpression(moduleAlias.terminal, session)
        : [];
    for (const alias of moduleAlias.nodes) {
      session.factoryMemo.set(requestNodeIdentity(alias), result);
    }
    session.factoryActive.delete(key);
    return result;
  }

  const symbol = node.getSymbol();

  const resolved = new Set<RequestHandlerFactoryName>();
  for (const identity of requestFrameworkFallbackIdentities(node, session, new Set(), 0)) {
    if (identity !== 'namespace') resolved.add(identity);
  }
  const reflective = requestReflectivePropertyRead(node, new Set(), session);
  if (reflective) {
    if (
      reflective.member === undefined &&
      expressionResolvesToModuleNamespace(
        reflective.owner,
        (specifier) => specifier === '@kovojs/server',
        new Set(),
        0,
      )
    ) {
      for (const factory of REQUEST_HANDLER_FACTORIES) resolved.add(factory.exportName);
    } else if (reflective.member !== undefined) {
      for (const name of requestFrameworkFactoriesForProjectedExpression(
        reflective.owner,
        [reflective.member],
        session,
      )) {
        resolved.add(name);
      }
    }
  }
  const appAuthoringFactory = requestAppAuthoringFactoryForExpression(node, session);
  if (appAuthoringFactory) resolved.add(appAuthoringFactory);
  if (
    Node.isElementAccessExpression(node) &&
    staticMemberName(node.getArgumentExpression()) === undefined &&
    requestExpressionIsCreateAppAuthoringContext(node.getExpression(), new Set(), session)
  ) {
    for (const factory of REQUEST_APP_AUTHORING_FACTORIES) resolved.add(factory);
  }
  // A bound identifier's declarations (including aliased imports and authored assignments) are
  // the complete local provenance graph. Resolve that graph once below instead of asking the
  // generic export resolver to replay the same potentially long alias chain for every factory
  // export. Non-identifiers still need the generic resolver for namespace/member expression forms.
  if (!Node.isIdentifier(node) || !symbol) {
    for (const { exportName } of REQUEST_HANDLER_FACTORIES) {
      if (
        expressionResolvesToFrameworkExport(node, frameworkExport('@kovojs/server', exportName), {
          legacyGlobals: [frameworkExport('@kovojs/server', exportName)],
        })
      ) {
        resolved.add(exportName);
      }
    }
  }

  if (
    Node.isBinaryExpression(node) &&
    node.getOperatorToken().getKind() === SyntaxKind.CommaToken
  ) {
    for (const name of requestFrameworkFactoriesForExpression(node.getRight(), session)) {
      resolved.add(name);
    }
  }
  if (Node.isConditionalExpression(node)) {
    for (const branch of [node.getWhenTrue(), node.getWhenFalse()]) {
      for (const name of requestFrameworkFactoriesForExpression(branch, session)) {
        resolved.add(name);
      }
    }
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      for (const branch of [node.getLeft(), node.getRight()]) {
        for (const name of requestFrameworkFactoriesForExpression(branch, session)) {
          resolved.add(name);
        }
      }
    }
  }

  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    if (member === 'bind') {
      for (const name of requestFrameworkFactoriesForExpression(node.getExpression(), session)) {
        resolved.add(name);
      }
    } else if (member) {
      for (const name of requestFrameworkFactoriesForProjectedExpression(
        node.getExpression(),
        [member],
        session,
      )) {
        resolved.add(name);
      }
    } else if (Node.isElementAccessExpression(node)) {
      const receiver = node.getExpression();
      if (
        expressionResolvesToModuleNamespace(
          receiver,
          (specifier) => specifier === '@kovojs/server',
          new Set(),
          0,
        )
      ) {
        for (const factory of REQUEST_HANDLER_FACTORIES) resolved.add(factory.exportName);
      }
      for (const candidate of requestStaticContainerValues(receiver, new Set(), session)) {
        for (const name of requestFrameworkFactoriesForExpression(candidate, session)) {
          resolved.add(name);
        }
      }
    }
  }

  if (Node.isCallExpression(node)) {
    const mutableRead = requestMutableFactoryReadForCall(node, session);
    for (const value of mutableRead.values) {
      for (const name of requestFrameworkFactoriesForExpression(value, session)) {
        resolved.add(name);
      }
    }
    const called = unwrapStaticExpression(node.getExpression());
    const calledReceiver = requestCallReceiver(called);
    if (calledReceiver && requestStaticCallMember(called) === 'bind') {
      for (const name of requestFrameworkFactoriesForExpression(calledReceiver, session)) {
        resolved.add(name);
      }
    } else {
      const factoryResolution = resolveRequestCallable(called, new Set(), 0, session);
      for (const callable of factoryResolution.callables) {
        for (const output of requestWireOutputExpressions(callable)) {
          for (const name of requestFrameworkFactoriesForExpression(output, session)) {
            resolved.add(name);
          }
        }
      }
    }
    for (const candidate of [...(calledReceiver ? [calledReceiver] : []), ...node.getArguments()]) {
      for (const name of requestFrameworkFactoriesInAggregate(candidate, session, new Set())) {
        resolved.add(name);
      }
    }
  }

  if (symbol) {
    for (const name of requestFrameworkFactoriesForSymbol(symbol, session)) {
      resolved.add(name);
    }
  }
  if (Node.isIdentifier(node)) {
    const parent = node.getParent();
    if (Node.isShorthandPropertyAssignment(parent)) {
      const valueSymbol = parent.getValueSymbol();
      if (valueSymbol) {
        for (const name of requestFrameworkFactoriesForSymbol(valueSymbol, session)) {
          resolved.add(name);
        }
      }
    }
    const declaration = symbol ? undefined : localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      for (const name of requestFrameworkFactoriesForExpression(initializer, session)) {
        resolved.add(name);
      }
    }
  }

  session.factoryActive.delete(key);
  const result = [...resolved];
  session.factoryMemo.set(key, result);
  return result;
}

function requestFrameworkFactoriesForProjectedExpression(
  expression: Node,
  path: readonly string[],
  session: RequestProvenanceSession,
): readonly RequestHandlerFactoryName[] {
  if (path.length === 0) return requestFrameworkFactoriesForExpression(expression, session);
  const node = unwrapStaticExpression(expression);
  if (Node.isConditionalExpression(node)) {
    return [node.getWhenTrue(), node.getWhenFalse()].flatMap((branch) =>
      requestFrameworkFactoriesForProjectedExpression(branch, path, session),
    );
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return [node.getLeft(), node.getRight()].flatMap((branch) =>
        requestFrameworkFactoriesForProjectedExpression(branch, path, session),
      );
    }
  }
  const [member, ...rest] = path;
  if (
    rest.length === 0 &&
    REQUEST_HANDLER_FACTORIES.some((factory) => factory.exportName === member) &&
    expressionResolvesToModuleNamespace(
      node,
      (specifier) => specifier === '@kovojs/server',
      new Set(),
      0,
    )
  ) {
    return [member as RequestHandlerFactoryName];
  }
  if (Node.isObjectLiteralExpression(node)) {
    const resolved = new Set<RequestHandlerFactoryName>();
    for (const property of node.getProperties()) {
      if (Node.isSpreadAssignment(property)) {
        for (const name of requestFrameworkFactoriesForProjectedExpression(
          property.getExpression(),
          path,
          session,
        )) {
          resolved.add(name);
        }
        continue;
      }
      if (staticMemberName(requestObjectLiteralElementNameNode(property)) !== member) continue;
      const value = requestHandlerPropertyExpression(property) ?? property;
      for (const name of requestFrameworkFactoriesForProjectedExpression(value, rest, session)) {
        resolved.add(name);
      }
    }
    return [...resolved];
  }
  if (Node.isArrayLiteralExpression(node)) {
    const index = Number(member);
    if (Number.isSafeInteger(index) && index >= 0) {
      const element = node.getElements()[index];
      if (element && !Node.isOmittedExpression(element)) {
        if (Node.isSpreadElement(element) && rest.length === 0) {
          return requestFrameworkFactoriesInAggregate(element.getExpression(), session, new Set());
        }
        return requestFrameworkFactoriesForProjectedExpression(
          Node.isSpreadElement(element) ? element.getExpression() : element,
          rest,
          session,
        );
      }
    }
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    const method = requestStaticCallMember(callee);
    if (
      receiver &&
      method === 'values' &&
      expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0)
    ) {
      const [source] = node.getArguments();
      const object = source ? resolveStaticObjectLiteral(source, new Set(), 0) : undefined;
      const index = Number(member);
      if (object && Number.isSafeInteger(index) && index >= 0) {
        const property = object.getProperties()[index];
        const value = property
          ? Node.isSpreadAssignment(property)
            ? property.getExpression()
            : (requestHandlerPropertyExpression(property) ?? property)
          : undefined;
        if (value) {
          return requestFrameworkFactoriesForProjectedExpression(value, rest, session);
        }
      }
    }
    if (
      receiver &&
      method === 'assign' &&
      expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0)
    ) {
      return node
        .getArguments()
        .flatMap((argument) =>
          requestFrameworkFactoriesForProjectedExpression(argument, path, session),
        );
    }
    const aggregate = [...(receiver ? [receiver] : []), ...node.getArguments()].flatMap(
      (candidate) => requestFrameworkFactoriesInAggregate(candidate, session, new Set()),
    );
    if (rest.length === 0 && aggregate.length > 0) return aggregate;
  }
  if (Node.isNewExpression(node)) {
    const aggregate = node
      .getArguments()
      .flatMap((candidate) => requestFrameworkFactoriesInAggregate(candidate, session, new Set()));
    if (rest.length === 0 && aggregate.length > 0) return aggregate;
  }
  if (Node.isIdentifier(node) && node.getSymbol()) {
    const resolved = new Set<RequestHandlerFactoryName>();
    for (const declaration of node.getSymbol()!.getDeclarations()) {
      const initializer = valueDeclarationInitializer(declaration);
      if (!initializer) continue;
      for (const name of requestFrameworkFactoriesForProjectedExpression(
        initializer,
        path,
        session,
      )) {
        resolved.add(name);
      }
    }
    for (const assignment of requestAssignedBindingProjections(node.getSymbol()!, session)) {
      for (const name of requestFrameworkFactoriesForProjectedExpression(
        assignment.expression,
        [...assignment.path, ...path],
        session,
      )) {
        resolved.add(name);
      }
    }
    if (resolved.size > 0) return [...resolved];
  }
  const resolved = new Set<RequestHandlerFactoryName>();
  for (const value of requestClassFactoryMemberValues(node, member!, session)) {
    for (const name of requestFrameworkFactoriesForProjectedExpression(value, rest, session)) {
      resolved.add(name);
    }
  }
  const mutableRead = requestMutableFactoryProjectedValues(node, member!, node.getStart(), session);
  for (const value of mutableRead.values) {
    for (const name of requestFrameworkFactoriesForProjectedExpression(value, rest, session)) {
      resolved.add(name);
    }
  }
  const projected = requestWireProjectedExpression(node, [member!], new Set(), 0);
  if (projected) {
    for (const name of requestFrameworkFactoriesForProjectedExpression(projected, rest, session)) {
      resolved.add(name);
    }
  }
  for (const assigned of requestAssignedMemberExpressions(
    node,
    member!,
    node.getStart(),
    session,
  )) {
    for (const name of requestFrameworkFactoriesForProjectedExpression(assigned, rest, session)) {
      resolved.add(name);
    }
  }
  for (const output of requestGetterOutputExpressions(node, member, new Set())) {
    for (const name of requestFrameworkFactoriesForProjectedExpression(output, rest, session)) {
      resolved.add(name);
    }
  }
  return [...resolved];
}

function requestFrameworkFactoriesInAggregate(
  expression: Node,
  session: RequestProvenanceSession,
  seen: Set<string>,
): readonly RequestHandlerFactoryName[] {
  const node = unwrapStaticExpression(expression);
  const key = `factory-aggregate:${requestNodeIdentity(node)}`;
  if (seen.has(key) || !requestProvenanceStep(session, node)) return [];
  seen.add(key);
  const resolved = new Set<RequestHandlerFactoryName>();
  const mutableRead = requestMutableFactoryContainerValues(
    node,
    node.getStart(),
    undefined,
    true,
    session,
  );
  if (mutableRead.recognized) {
    for (const value of mutableRead.values) {
      for (const name of requestFrameworkFactoriesForExpression(value, session)) {
        resolved.add(name);
      }
    }
  }
  for (const factory of REQUEST_HANDLER_FACTORIES) {
    if (
      expressionResolvesToFrameworkExport(
        node,
        frameworkExport('@kovojs/server', factory.exportName),
        { legacyGlobals: [frameworkExport('@kovojs/server', factory.exportName)] },
      )
    ) {
      resolved.add(factory.exportName);
    }
  }
  if (
    expressionResolvesToModuleNamespace(
      node,
      (specifier) => specifier === '@kovojs/server',
      new Set(),
      0,
    )
  ) {
    for (const factory of REQUEST_HANDLER_FACTORIES) resolved.add(factory.exportName);
  }

  const visit = (candidate: Node): void => {
    for (const name of requestFrameworkFactoriesInAggregate(candidate, session, new Set(seen))) {
      resolved.add(name);
    }
  };
  if (Node.isArrayLiteralExpression(node)) {
    for (const element of node.getElements()) {
      if (!Node.isOmittedExpression(element)) {
        visit(Node.isSpreadElement(element) ? element.getExpression() : element);
      }
    }
  } else if (Node.isObjectLiteralExpression(node)) {
    for (const property of node.getProperties()) {
      const value = Node.isSpreadAssignment(property)
        ? property.getExpression()
        : (requestHandlerPropertyExpression(property) ??
          (Node.isMethodDeclaration(property) ? property : undefined));
      if (value) visit(value);
    }
  } else if (Node.isConditionalExpression(node)) {
    visit(node.getWhenTrue());
    visit(node.getWhenFalse());
  } else if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (operator === SyntaxKind.CommaToken) visit(node.getRight());
    if (
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      visit(node.getLeft());
      visit(node.getRight());
    }
  } else if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
    const receiver = Node.isCallExpression(node)
      ? requestCallReceiver(unwrapStaticExpression(node.getExpression()))
      : undefined;
    if (receiver) visit(receiver);
    for (const argument of node.getArguments()) visit(argument);
    if (Node.isCallExpression(node)) {
      for (const callable of resolveRequestCallable(node.getExpression(), new Set(), 0, session)
        .callables) {
        for (const output of requestWireOutputExpressions(callable)) visit(output);
      }
    }
  } else if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    if (member !== undefined) {
      for (const name of requestFrameworkFactoriesForProjectedExpression(
        node.getExpression(),
        [member],
        session,
      )) {
        resolved.add(name);
      }
    } else {
      visit(node.getExpression());
    }
  } else if (Node.isIdentifier(node) && node.getSymbol()) {
    for (const declaration of node.getSymbol()!.getDeclarations()) {
      const initializer = valueDeclarationInitializer(declaration);
      if (initializer) visit(initializer);
    }
    for (const assignment of requestAssignedBindingProjections(node.getSymbol()!, session)) {
      const names =
        assignment.path.length === 0
          ? requestFrameworkFactoriesInAggregate(assignment.expression, session, new Set(seen))
          : requestFrameworkFactoriesForProjectedExpression(
              assignment.expression,
              assignment.path,
              session,
            );
      for (const name of names) resolved.add(name);
    }
  }
  return [...resolved];
}

const REQUEST_APP_AUTHORING_FACTORIES = new Set<RequestHandlerFactoryName>([
  'layout',
  'mutation',
  'query',
  'route',
  'task',
]);

function requestAppAuthoringFactoryForExpression(
  expression: Node,
  session: RequestProvenanceSession,
): RequestHandlerFactoryName | undefined {
  const node = unwrapStaticExpression(expression);
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? node.getName()
      : staticMemberName(node.getArgumentExpression());
    if (!member || !REQUEST_APP_AUTHORING_FACTORIES.has(member as RequestHandlerFactoryName)) {
      return undefined;
    }
    const receiver = unwrapStaticExpression(node.getExpression());
    const context = requestExpressionIsCreateAppAuthoringContext(receiver, new Set(), session);
    return context ? (member as RequestHandlerFactoryName) : undefined;
  }
  if (!Node.isIdentifier(node)) return undefined;
  for (const declaration of node.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isBindingElement(declaration)) continue;
    const name = staticMemberName(
      declaration.getPropertyNameNode() ?? declaration.getNameNode(),
    ) as RequestHandlerFactoryName | undefined;
    if (!name || !REQUEST_APP_AUTHORING_FACTORIES.has(name)) continue;
    const parameter = declaration.getFirstAncestorByKind(SyntaxKind.Parameter);
    const owner = parameter?.getParent();
    if (
      parameter &&
      owner &&
      requestNodesAreSame(requestCallableParameters(owner)[0], parameter) &&
      requestCallableIsCreateAppAuthoringCallback(owner, session)
    ) {
      return name;
    }
    const source = bindingElementSourceExpression(declaration);
    if (source && requestExpressionIsCreateAppAuthoringContext(source, new Set(), session)) {
      return name;
    }
  }
  return undefined;
}

function requestExpressionIsCreateAppAuthoringContext(
  expression: Node,
  seen: Set<string>,
  session: RequestProvenanceSession,
): boolean {
  const node = unwrapStaticExpression(expression);
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (!symbol) return false;
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return false;
  seen.add(key);
  for (const declaration of symbol.getDeclarations()) {
    if (Node.isParameterDeclaration(declaration)) {
      const owner = declaration.getParent();
      if (
        requestNodesAreSame(requestCallableParameters(owner)[0], declaration) &&
        requestCallableIsCreateAppAuthoringCallback(owner, session)
      ) {
        return true;
      }
      const parameterIndex = requestCallableParameters(owner).indexOf(declaration);
      if (parameterIndex >= 0) {
        for (const call of owner.getSourceFile().getDescendantsOfKind(SyntaxKind.CallExpression)) {
          const invocation = requestNormalizedCall(call);
          if (
            !resolveRequestCallable(invocation.target, new Set(), 0, session).callables.some(
              (callable) => requestNodesAreSame(callable.declaration, owner),
            )
          ) {
            continue;
          }
          const argument = invocation.args?.[parameterIndex];
          if (
            argument &&
            requestExpressionIsCreateAppAuthoringContext(argument, new Set(seen), session)
          ) {
            return true;
          }
        }
      }
    }
    const initializer = valueDeclarationInitializer(declaration);
    if (initializer && requestExpressionIsCreateAppAuthoringContext(initializer, seen, session)) {
      return true;
    }
  }
  return false;
}

function requestCallableIsCreateAppAuthoringCallback(
  declaration: Node,
  session: RequestProvenanceSession,
): boolean {
  const authoringProperties = new Set(['mutations', 'queries', 'routes', 'tasks']);
  for (const call of declaration.getSourceFile().getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const isCreateApp = expressionResolvesToFrameworkExport(
      call.getExpression(),
      frameworkExport('@kovojs/server', 'createApp'),
    );
    if (!isCreateApp) {
      continue;
    }
    const config = [...call.getArguments()]
      .reverse()
      .map((argument) => resolveStaticObjectLiteral(argument, new Set(), 0))
      .find((candidate) => candidate !== undefined);
    if (!config) continue;
    for (const property of config.getProperties()) {
      const name = staticMemberName(requestObjectLiteralElementNameNode(property));
      if (!name || !authoringProperties.has(name)) continue;
      const candidate = requestHandlerPropertyExpression(property) ?? property;
      const direct = requestCallableForFunctionNode(candidate);
      if (direct && requestNodesAreSame(direct.declaration, declaration)) return true;
      if (
        resolveRequestCallable(candidate, new Set(), 0, session).callables.some((callable) =>
          requestNodesAreSame(callable.declaration, declaration),
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function requestStaticContainerValues(
  expression: Node,
  seen: Set<string>,
  session: RequestProvenanceSession,
): Node[] {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `node:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey)) return [];
  seen.add(nodeKey);
  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().flatMap((property) => {
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        return initializer ? [initializer] : [];
      }
      if (Node.isShorthandPropertyAssignment(property)) return [property.getNameNode()];
      if (Node.isSpreadAssignment(property)) {
        return requestStaticContainerValues(property.getExpression(), new Set(seen), session);
      }
      return [];
    });
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node
      .getElements()
      .flatMap((element) =>
        Node.isSpreadElement(element)
          ? requestStaticContainerValues(element.getExpression(), new Set(seen), session)
          : [element],
      );
  }
  if (Node.isCallExpression(node)) {
    return resolveRequestCallable(node.getExpression(), new Set(), 0, session).callables.flatMap(
      (callable) =>
        requestWireOutputExpressions(callable).flatMap((output) => [
          output,
          ...requestStaticContainerValues(output, new Set(seen), session),
        ]),
    );
  }
  if (!Node.isIdentifier(node)) return [];
  const symbol = node.getSymbol();
  if (!symbol) return [];
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return [];
  seen.add(key);
  return symbol.getDeclarations().flatMap((declaration) => {
    const initializer = valueDeclarationInitializer(declaration);
    return initializer ? requestStaticContainerValues(initializer, new Set(seen), session) : [];
  });
}

function requestFrameworkFactoriesForSymbol(
  symbol: NonNullable<ReturnType<Node['getSymbol']>>,
  session: RequestProvenanceSession,
): readonly RequestHandlerFactoryName[] {
  const key = requestSymbolKey(symbol);
  const memoized = session.factorySymbolMemo.get(key);
  if (memoized) return memoized;
  if (session.factorySymbolActive.has(key)) return [];
  session.factorySymbolActive.add(key);
  const resolved = new Set<RequestHandlerFactoryName>();
  try {
    const aliased = symbol.getAliasedSymbol();
    if (aliased && aliased !== symbol) {
      for (const name of requestFrameworkFactoriesForSymbol(aliased, session)) resolved.add(name);
    }
  } catch {
    // Unresolved in-memory package aliases are classified from their import declaration below.
  }
  for (const declaration of symbol.getDeclarations()) {
    if (Node.isParameterDeclaration(declaration)) {
      const owner = declaration.getParent();
      const parameterIndex = requestCallableParameters(owner).indexOf(declaration);
      if (parameterIndex >= 0) {
        for (const call of owner.getSourceFile().getDescendantsOfKind(SyntaxKind.CallExpression)) {
          const invocation = requestNormalizedCall(call);
          if (
            !resolveRequestCallable(invocation.target, new Set(), 0, session).callables.some(
              (callable) => callable.declaration === owner,
            )
          ) {
            continue;
          }
          const argument = invocation.args?.[parameterIndex];
          if (!argument) continue;
          for (const name of requestFrameworkFactoriesForExpression(argument, session)) {
            resolved.add(name);
          }
        }
      }
    }
    if (Node.isImportSpecifier(declaration)) {
      const module = declaration.getImportDeclaration().getModuleSpecifierValue();
      const imported = declaration.getName() as RequestHandlerFactoryName;
      if (
        module === '@kovojs/server' &&
        REQUEST_HANDLER_FACTORIES.some((factory) => factory.exportName === imported)
      ) {
        resolved.add(imported);
      }
    }
    if (Node.isBindingElement(declaration)) {
      const name = staticMemberName(
        declaration.getPropertyNameNode() ?? declaration.getNameNode(),
      ) as RequestHandlerFactoryName | undefined;
      const source = bindingElementSourceExpression(declaration);
      if (name && REQUEST_HANDLER_FACTORIES.some((factory) => factory.exportName === name)) {
        if (
          source &&
          expressionResolvesToModuleNamespace(
            source,
            (specifier) => specifier === '@kovojs/server',
            new Set(),
            0,
          )
        ) {
          resolved.add(name);
        }
        if (source) {
          const projected = requestWireProjectedExpression(source, [name], new Set(), 0);
          if (projected) {
            for (const candidate of requestFrameworkFactoriesForExpression(projected, session)) {
              resolved.add(candidate);
            }
          }
        }
      }
      const projection = requestBindingElementProjection(declaration);
      if (projection) {
        for (const candidate of requestFrameworkFactoriesForProjectedExpression(
          projection.expression,
          projection.path,
          session,
        )) {
          resolved.add(candidate);
        }
      }
      const fallback = declaration.getInitializer();
      if (fallback) {
        for (const candidate of requestFrameworkFactoriesForExpression(fallback, session)) {
          resolved.add(candidate);
        }
      }
    }
    const initializer = valueDeclarationInitializer(declaration);
    if (!initializer) continue;
    for (const name of requestFrameworkFactoriesForExpression(initializer, session)) {
      resolved.add(name);
    }
  }
  for (const assigned of requestAssignedBindingProjections(symbol, session)) {
    for (const name of requestFrameworkFactoriesForProjectedExpression(
      assigned.expression,
      assigned.path,
      session,
    )) {
      resolved.add(name);
    }
  }
  session.factorySymbolActive.delete(key);
  const result = [...resolved];
  session.factorySymbolMemo.set(key, result);
  return result;
}

function scanRequestRootCallbacks(
  definition: import('ts-morph').ObjectLiteralExpression,
  factory: (typeof REQUEST_HANDLER_FACTORIES)[number],
  context: RequestProcessScanContext,
  definitionSource: Node = definition,
  snapshotBoundary = Number.POSITIVE_INFINITY,
): void {
  scanRequestRetainedConfigPristine(definitionSource, context);
  for (const spec of factory.callbacks as readonly RequestRootCallbackSpec[]) {
    for (const property of requestRootPropertyCandidates(
      definitionSource,
      definition,
      spec.property.split('.'),
      context,
      snapshotBoundary,
    )) {
      scanRequestRootCallbackProperty(property, factory, spec, context);
    }
  }

  scanRequestNestedDeclarations(
    definitionSource,
    definition,
    factory.exportName,
    context,
    snapshotBoundary,
  );
  scanRequestStaticPublicWire(
    definitionSource,
    definition,
    factory.exportName,
    context,
    snapshotBoundary,
  );

  if (definition.getProperties().some((entry) => Node.isSpreadAssignment(entry))) {
    appendOpaqueRequestHandlerFact(context, definition, '<spread>');
  }
  for (const entry of definition.getProperties()) {
    const name = requestObjectLiteralElementNameNode(entry);
    if (name && Node.isComputedPropertyName(name) && staticMemberName(name) === undefined) {
      appendOpaqueRequestHandlerFact(context, entry, '<computed-config-property>');
    }
  }
}

/**
 * SPEC §6.6: framework definitions retain nested guard, schema, adapter, and callback containers.
 * Static resolution is sound only while every authored identity feeding that retained graph stays
 * pristine. Prove that invariant project-wide so aliases, imports, helper calls, containers, and
 * reflective mutators cannot rewrite a callback after the source literal was inspected.
 */
function scanRequestRetainedConfigPristine(
  expression: Node,
  context: RequestProcessScanContext,
): void {
  const opaque = requestRetainedConfigOpaqueDerivation(expression, context.provenance);
  if (opaque) {
    appendOpaqueRequestHandlerFact(context, opaque, '<opaque-retained-config-derivation>');
    return;
  }
  for (const target of requestRetainedConfigInitialTargets(expression, new Set(), 0)) {
    context.retainedConfigTargets.add(target);
  }
}

function requestRetainedConfigOpaqueDerivation(
  expression: Node,
  session: RequestProvenanceSession,
): Node | undefined {
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  const memoized = session.retainedConfigGrammarMemo.get(key);
  if (memoized !== undefined) return memoized ?? undefined;
  if (session.retainedConfigGrammarActive.has(key)) return node;
  session.retainedConfigGrammarActive.add(key);
  const close = (opaque: Node | undefined): Node | undefined => {
    session.retainedConfigGrammarActive.delete(key);
    session.retainedConfigGrammarMemo.set(key, opaque ?? null);
    return opaque;
  };
  const firstOpaque = (values: readonly (Node | undefined)[]): Node | undefined => {
    for (const value of values) {
      if (!value) continue;
      const opaque = requestRetainedConfigOpaqueDerivation(value, session);
      if (opaque) return opaque;
    }
    return undefined;
  };

  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isNumericLiteral(node) ||
    Node.isBigIntLiteral(node) ||
    Node.isTrueLiteral(node) ||
    Node.isFalseLiteral(node) ||
    node.getKind() === SyntaxKind.NullKeyword ||
    (Node.isIdentifier(node) && unshadowedGlobalIdentifier(node, 'undefined')) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node)
  ) {
    return close(undefined);
  }
  if (Node.isObjectLiteralExpression(node)) {
    const values: Node[] = [];
    for (const property of node.getProperties()) {
      const name = requestObjectLiteralElementNameNode(property);
      if (name && Node.isComputedPropertyName(name) && staticMemberName(name) === undefined) {
        return close(name);
      }
      if (
        Node.isPropertyAssignment(property) &&
        name &&
        !Node.isComputedPropertyName(name) &&
        staticMemberName(name) === '__proto__'
      ) {
        return close(property);
      }
      if (Node.isMethodDeclaration(property)) continue;
      if (
        Node.isSpreadAssignment(property) ||
        Node.isGetAccessorDeclaration(property) ||
        Node.isSetAccessorDeclaration(property)
      ) {
        return close(property);
      }
      const value = Node.isPropertyAssignment(property)
        ? property.getInitializer()
        : Node.isShorthandPropertyAssignment(property)
          ? property.getNameNode()
          : undefined;
      if (!value) return close(property);
      values.push(value);
    }
    return close(firstOpaque(values));
  }
  if (Node.isArrayLiteralExpression(node)) {
    const values: Node[] = [];
    for (const element of node.getElements()) {
      if (Node.isOmittedExpression(element)) continue;
      if (Node.isSpreadElement(element)) return close(element);
      values.push(element);
    }
    return close(firstOpaque(values));
  }
  if (Node.isIdentifier(node)) {
    const symbol = requestIdentifierValueSymbol(node) ?? node.getSymbol();
    if (!symbol) return close(node);
    const declarations = symbol.getDeclarations();
    if (declarations.length === 0) return close(node);
    const values: Node[] = [];
    for (const declaration of declarations) {
      if (Node.isFunctionDeclaration(declaration)) continue;
      if (Node.isVariableDeclaration(declaration)) {
        if (
          declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
        ) {
          return close(declaration);
        }
        const initializer = declaration.getInitializer();
        if (!initializer) return close(declaration);
        values.push(initializer);
        continue;
      }
      if (Node.isBindingElement(declaration)) {
        if (declaration.getInitializer()) return close(declaration);
        const variable = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
        if (
          !variable ||
          variable.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
        ) {
          return close(declaration);
        }
        const projection = requestBindingElementProjection(declaration);
        if (!projection) return close(declaration);
        const projected = requestWireProjectedExpression(
          projection.expression,
          projection.path,
          new Set(),
          0,
        );
        if (!projected) return close(declaration);
        values.push(projected);
        continue;
      }
      return close(declaration);
    }
    return close(firstOpaque(values));
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const identity = canonicalFrameworkExportForExpression(node);
    if (
      identity &&
      requestRetainedConfigFrameworkValueIsReviewed(identity.module, identity.exportName)
    ) {
      return close(undefined);
    }
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    const projected = member
      ? requestWireProjectedExpression(node.getExpression(), [member], new Set(), 0)
      : undefined;
    return close(projected ? requestRetainedConfigOpaqueDerivation(projected, session) : node);
  }
  if (Node.isCallExpression(node)) {
    if (!requestRetainedConfigCallIsReviewed(node, session)) return close(node);
    return close(firstOpaque(node.getArguments()));
  }
  if (Node.isTemplateExpression(node)) {
    return close(firstOpaque(node.getTemplateSpans().map((span) => span.getExpression())));
  }
  if (Node.isPrefixUnaryExpression(node)) {
    return close(requestRetainedConfigOpaqueDerivation(node.getOperand(), session));
  }
  return close(node);
}

function requestRetainedConfigFrameworkValueIsReviewed(
  module: string,
  exportName: string,
): boolean {
  return ['@kovojs/core:standardWebhooks', '@kovojs/server:standardWebhooks'].includes(
    `${module}:${exportName}`,
  );
}

function flushRequestRetainedConfigPristine(
  context: RequestProcessScanContext,
  sourceFiles: readonly SourceFile[],
): void {
  const targets = context.retainedConfigTargets;
  if (targets.size === 0) return;

  let changed = true;
  while (changed) {
    changed = false;
    for (const sourceFile of sourceFiles) {
      const declarations: Node[] = [
        ...sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.Parameter),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.PropertyDeclaration),
      ];
      for (const declaration of declarations) {
        const initializer = Node.isPropertyDeclaration(declaration)
          ? declaration.getInitializer()
          : valueDeclarationInitializer(declaration);
        if (
          !initializer ||
          !requestRetainedConfigExpressionContainsTarget(initializer, targets, new Set(), 0)
        ) {
          continue;
        }
        const name =
          Node.isVariableDeclaration(declaration) || Node.isParameterDeclaration(declaration)
            ? declaration.getNameNode()
            : Node.isPropertyDeclaration(declaration)
              ? declaration.getNameNode()
              : undefined;
        for (const symbol of name ? requestRetainedConfigBindingSymbols(name) : []) {
          const key = requestSymbolKey(symbol);
          if (!targets.has(key)) {
            targets.add(key);
            changed = true;
          }
        }
      }
      for (const binding of sourceFile.getDescendantsOfKind(SyntaxKind.BindingElement)) {
        const fallback = binding.getInitializer();
        if (
          !fallback ||
          !requestRetainedConfigExpressionContainsTarget(fallback, targets, new Set(), 0)
        ) {
          continue;
        }
        for (const symbol of requestRetainedConfigBindingSymbols(binding.getNameNode())) {
          const key = requestSymbolKey(symbol);
          if (!targets.has(key)) {
            targets.add(key);
            changed = true;
          }
        }
      }
      for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
        if (
          assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken ||
          !requestRetainedConfigExpressionTargetsIdentity(
            assignment.getLeft(),
            targets,
            new Set(),
            0,
          )
        ) {
          continue;
        }
        for (const target of requestRetainedConfigInitialTargets(
          assignment.getRight(),
          new Set(),
          0,
        )) {
          if (!targets.has(target)) {
            targets.add(target);
            changed = true;
          }
        }
      }
    }
  }

  const reject = (site: Node): void => {
    appendOpaqueRequestHandlerFact(context, site, '<mutated-retained-config>');
  };
  for (const sourceFile of sourceFiles) {
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const operator = assignment.getOperatorToken().getKind();
      if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
      const targetsLeft = requestRetainedConfigExpressionTargetsIdentity(
        assignment.getLeft(),
        targets,
        new Set(),
        0,
      );
      if (
        (targetsLeft &&
          !requestRetainedConfigAssignmentIsFreshInitialization(assignment, targets)) ||
        requestRetainedConfigExpressionTargetsIdentity(assignment.getRight(), targets, new Set(), 0)
      ) {
        reject(assignment);
      }
    }
    for (const deletion of sourceFile.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
      if (
        requestRetainedConfigExpressionTargetsIdentity(
          deletion.getExpression(),
          targets,
          new Set(),
          0,
        )
      ) {
        reject(deletion);
      }
    }
    for (const update of [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
    ]) {
      if (
        requestRetainedConfigExpressionTargetsIdentity(update.getOperand(), targets, new Set(), 0)
      ) {
        reject(update);
      }
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = unwrapStaticExpression(call.getExpression());
      const receiver = requestCallReceiver(callee);
      const receiverTargets =
        !!receiver &&
        requestRetainedConfigExpressionTargetsIdentity(receiver, targets, new Set(), 0);
      const argumentTargets = call
        .getArguments()
        .some((argument) =>
          requestRetainedConfigExpressionTargetsIdentity(argument, targets, new Set(), 0),
        );
      if (
        (receiverTargets || argumentTargets) &&
        !requestRetainedConfigCallIsReviewed(call, context.provenance)
      ) {
        reject(call);
        scanRequestRetainedConfigMutationCallables(call, context);
      }
    }
    for (const construct of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      if (
        construct
          .getArguments()
          .some((argument) =>
            requestRetainedConfigExpressionTargetsIdentity(argument, targets, new Set(), 0),
          )
      ) {
        reject(construct);
      }
    }
    for (const returned of sourceFile.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      const value = returned.getExpression();
      if (value && requestRetainedConfigExpressionTargetsIdentity(value, targets, new Set(), 0)) {
        reject(returned);
      }
    }
  }
}

function requestRetainedConfigAssignmentIsFreshInitialization(
  assignment: import('ts-morph').BinaryExpression,
  targets: ReadonlySet<string>,
): boolean {
  if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return false;
  const left = unwrapStaticExpression(assignment.getLeft());
  if (!Node.isIdentifier(left)) return false;
  const symbol = requestIdentifierValueSymbol(left) ?? left.getSymbol();
  if (!symbol || !targets.has(requestSymbolKey(symbol))) return false;
  const declarations = symbol.getDeclarations();
  if (
    declarations.length === 0 ||
    declarations.some(
      (declaration) =>
        !Node.isVariableDeclaration(declaration) || declaration.getInitializer() !== undefined,
    )
  ) {
    return false;
  }
  const right = unwrapStaticExpression(assignment.getRight());
  if (
    !Node.isObjectLiteralExpression(right) &&
    !Node.isArrayLiteralExpression(right) &&
    !Node.isNewExpression(right) &&
    !Node.isCallExpression(right)
  ) {
    return false;
  }
  return !assignment
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .some(
      (candidate) =>
        candidate.getStart() < assignment.getStart() &&
        candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        requestRetainedConfigExpressionTargetsIdentity(
          candidate.getLeft(),
          new Set([requestSymbolKey(symbol)]),
          new Set(),
          0,
        ),
    );
}

function requestRetainedConfigInitialTargets(
  expression: Node,
  seen: Set<string>,
  depth: number,
): Set<string> {
  const targets = new Set<string>();
  if (depth > 64) return targets;
  const node = unwrapStaticExpression(expression);
  const nodeKey = requestNodeIdentity(node);
  if (seen.has(nodeKey)) return targets;
  seen.add(nodeKey);
  const collect = (candidate: Node | undefined): void => {
    if (!candidate) return;
    for (const target of requestRetainedConfigInitialTargets(candidate, new Set(seen), depth + 1)) {
      targets.add(target);
    }
  };

  if (Node.isIdentifier(node)) {
    const symbol = requestIdentifierValueSymbol(node) ?? node.getSymbol();
    if (!symbol) return targets;
    const symbolKey = requestSymbolKey(symbol);
    if (seen.has(symbolKey)) return targets;
    seen.add(symbolKey);
    let retainedIdentity = false;
    for (const declaration of symbol.getDeclarations()) {
      if (Node.isClassDeclaration(declaration) || Node.isClassExpression(declaration)) {
        retainedIdentity = true;
        collect(declaration.getExtends()?.getExpression());
        for (const property of declaration.getProperties()) collect(property.getInitializer());
        for (const constructor of declaration.getConstructors()) {
          const body = constructor.getBody();
          if (!body) continue;
          for (const output of requestWireOutputExpressions({ body, declaration: constructor })) {
            collect(output);
          }
          for (const assignment of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
            const operator = assignment.getOperatorToken().getKind();
            if (operator >= SyntaxKind.FirstAssignment && operator <= SyntaxKind.LastAssignment) {
              collect(assignment.getRight());
            }
          }
        }
        continue;
      }
      if (Node.isFunctionDeclaration(declaration)) {
        retainedIdentity = true;
        continue;
      }
      if (Node.isBindingElement(declaration)) {
        retainedIdentity = true;
        const projection = requestBindingElementProjection(declaration);
        if (projection) {
          const projected = requestWireProjectedExpression(
            projection.expression,
            projection.path,
            new Set(),
            0,
          );
          collect(projected ?? projection.expression);
        }
        continue;
      }
      const initializer = valueDeclarationInitializer(declaration);
      if (Node.isVariableDeclaration(declaration)) retainedIdentity = true;
      if (!initializer) continue;
      const initialNode = unwrapStaticExpression(initializer);
      if (
        !Node.isStringLiteral(initialNode) &&
        !Node.isNoSubstitutionTemplateLiteral(initialNode) &&
        !Node.isNumericLiteral(initialNode) &&
        !Node.isBigIntLiteral(initialNode) &&
        !Node.isTrueLiteral(initialNode) &&
        !Node.isFalseLiteral(initialNode) &&
        initialNode.getKind() !== SyntaxKind.NullKeyword &&
        !Node.isArrowFunction(initialNode) &&
        !Node.isFunctionExpression(initialNode)
      ) {
        retainedIdentity = true;
      }
      collect(initializer);
    }
    if (retainedIdentity) targets.add(symbolKey);
    return targets;
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    collect(node.getExpression());
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    if (member) {
      collect(requestWireProjectedExpression(node.getExpression(), [member], new Set(), 0));
    }
    return targets;
  }
  if (Node.isObjectLiteralExpression(node)) {
    for (const property of node.getProperties()) {
      collect(
        Node.isPropertyAssignment(property)
          ? property.getInitializer()
          : Node.isShorthandPropertyAssignment(property)
            ? property.getNameNode()
            : Node.isSpreadAssignment(property)
              ? property.getExpression()
              : undefined,
      );
    }
    return targets;
  }
  if (Node.isArrayLiteralExpression(node)) {
    for (const element of node.getElements()) {
      collect(Node.isSpreadElement(element) ? element.getExpression() : element);
    }
    return targets;
  }
  if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
    for (const argument of node.getArguments()) collect(argument);
    if (Node.isCallExpression(node)) {
      const receiver = requestCallReceiver(unwrapStaticExpression(node.getExpression()));
      if (receiver) collect(receiver);
      for (const callable of resolveRequestCallable(node.getExpression(), new Set(), 0).callables) {
        for (const output of requestWireOutputExpressions(callable)) collect(output);
        for (const yielded of callable.body.getDescendantsOfKind(SyntaxKind.YieldExpression)) {
          collect(yielded.getExpression());
        }
      }
    } else {
      collect(node.getExpression());
      for (const callable of resolveRequestCallable(node.getExpression(), new Set(), 0).callables) {
        for (const output of requestWireOutputExpressions(callable)) collect(output);
        for (const yielded of callable.body.getDescendantsOfKind(SyntaxKind.YieldExpression)) {
          collect(yielded.getExpression());
        }
      }
      for (const declaration of requestClassDeclarationsForExpression(
        node.getExpression(),
        new Set(),
      )) {
        for (const constructor of declaration.getConstructors()) {
          const body = constructor.getBody();
          if (!body) continue;
          for (const output of requestWireOutputExpressions({ body, declaration: constructor })) {
            collect(output);
          }
        }
      }
    }
    return targets;
  }
  if (Node.isConditionalExpression(node)) {
    collect(node.getWhenTrue());
    collect(node.getWhenFalse());
    return targets;
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      [
        SyntaxKind.AmpersandAmpersandToken,
        SyntaxKind.BarBarToken,
        SyntaxKind.QuestionQuestionToken,
        SyntaxKind.CommaToken,
        SyntaxKind.EqualsToken,
      ].includes(operator)
    ) {
      collect(node.getLeft());
      collect(node.getRight());
    }
    return targets;
  }
  if (Node.isAwaitExpression(node) || Node.isSpreadElement(node)) collect(node.getExpression());
  return targets;
}

function requestRetainedConfigBindingSymbols(
  name: Node,
): NonNullable<ReturnType<Node['getSymbol']>>[] {
  if (Node.isIdentifier(name)) return name.getSymbol() ? [name.getSymbol()!] : [];
  if (!Node.isObjectBindingPattern(name) && !Node.isArrayBindingPattern(name)) return [];
  return name
    .getElements()
    .flatMap((element) =>
      Node.isOmittedExpression(element)
        ? []
        : requestRetainedConfigBindingSymbols(element.getNameNode()),
    );
}

function requestRetainedConfigExpressionContainsTarget(
  expression: Node,
  targets: ReadonlySet<string>,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 64) return true;
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  if (seen.has(key)) return false;
  seen.add(key);
  if (Node.isIdentifier(node)) {
    const symbol = requestIdentifierValueSymbol(node) ?? node.getSymbol();
    return !!symbol && targets.has(requestSymbolKey(symbol));
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return requestRetainedConfigExpressionContainsTarget(
      node.getExpression(),
      targets,
      new Set(seen),
      depth + 1,
    );
  }
  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().some((property) => {
      const value = Node.isPropertyAssignment(property)
        ? property.getInitializer()
        : Node.isShorthandPropertyAssignment(property)
          ? property.getNameNode()
          : Node.isSpreadAssignment(property)
            ? property.getExpression()
            : undefined;
      return (
        !!value &&
        requestRetainedConfigExpressionContainsTarget(value, targets, new Set(seen), depth + 1)
      );
    });
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node
      .getElements()
      .some((element) =>
        requestRetainedConfigExpressionContainsTarget(
          Node.isSpreadElement(element) ? element.getExpression() : element,
          targets,
          new Set(seen),
          depth + 1,
        ),
      );
  }
  if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
    if (Node.isCallExpression(node)) {
      const callee = unwrapStaticExpression(node.getExpression());
      const receiver = requestCallReceiver(callee);
      const [value] = node.getArguments();
      return !!(
        receiver &&
        requestStaticCallMember(callee) === 'freeze' &&
        expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
        value &&
        requestRetainedConfigExpressionContainsTarget(value, targets, new Set(seen), depth + 1)
      );
    }
    return false;
  }
  if (Node.isConditionalExpression(node)) {
    return [node.getWhenTrue(), node.getWhenFalse()].some((branch) =>
      requestRetainedConfigExpressionContainsTarget(branch, targets, new Set(seen), depth + 1),
    );
  }
  if (Node.isBinaryExpression(node)) {
    return [node.getLeft(), node.getRight()].some((part) =>
      requestRetainedConfigExpressionContainsTarget(part, targets, new Set(seen), depth + 1),
    );
  }
  if (Node.isAwaitExpression(node) || Node.isSpreadElement(node)) {
    return requestRetainedConfigExpressionContainsTarget(
      node.getExpression(),
      targets,
      new Set(seen),
      depth + 1,
    );
  }
  return false;
}

function requestRetainedConfigExpressionTargetsIdentity(
  expression: Node,
  targets: ReadonlySet<string>,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 64) return true;
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  if (seen.has(key)) return false;
  seen.add(key);
  if (Node.isIdentifier(node)) {
    const symbol = requestIdentifierValueSymbol(node) ?? node.getSymbol();
    if (!symbol) return false;
    if (targets.has(requestSymbolKey(symbol))) return true;
    for (const declaration of symbol.getDeclarations()) {
      if (Node.isBindingElement(declaration)) {
        const projection = requestBindingElementProjection(declaration);
        if (projection) {
          const projected = requestWireProjectedExpression(
            projection.expression,
            projection.path,
            new Set(),
            0,
          );
          if (
            requestRetainedConfigExpressionTargetsIdentity(
              projected ?? projection.expression,
              targets,
              new Set(seen),
              depth + 1,
            )
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const memberSymbol =
      (Node.isPropertyAccessExpression(node) ? node.getNameNode().getSymbol() : node.getSymbol()) ??
      undefined;
    if (memberSymbol && targets.has(requestSymbolKey(memberSymbol))) return true;
    return requestRetainedConfigExpressionTargetsIdentity(
      node.getExpression(),
      targets,
      new Set(seen),
      depth + 1,
    );
  }
  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().some((property) => {
      const value = Node.isPropertyAssignment(property)
        ? property.getInitializer()
        : Node.isShorthandPropertyAssignment(property)
          ? property.getNameNode()
          : Node.isSpreadAssignment(property)
            ? property.getExpression()
            : undefined;
      return (
        !!value &&
        requestRetainedConfigExpressionTargetsIdentity(value, targets, new Set(seen), depth + 1)
      );
    });
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node
      .getElements()
      .some((element) =>
        requestRetainedConfigExpressionTargetsIdentity(
          Node.isSpreadElement(element) ? element.getExpression() : element,
          targets,
          new Set(seen),
          depth + 1,
        ),
      );
  }
  if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
    if (
      node
        .getArguments()
        .some((argument) =>
          requestRetainedConfigExpressionTargetsIdentity(
            argument,
            targets,
            new Set(seen),
            depth + 1,
          ),
        )
    ) {
      return true;
    }
    if (Node.isCallExpression(node)) {
      const receiver = requestCallReceiver(unwrapStaticExpression(node.getExpression()));
      return (
        !!receiver &&
        requestRetainedConfigExpressionTargetsIdentity(receiver, targets, new Set(seen), depth + 1)
      );
    }
    return false;
  }
  if (Node.isConditionalExpression(node)) {
    return [node.getWhenTrue(), node.getWhenFalse()].some((branch) =>
      requestRetainedConfigExpressionTargetsIdentity(branch, targets, new Set(seen), depth + 1),
    );
  }
  if (Node.isBinaryExpression(node)) {
    return [node.getLeft(), node.getRight()].some((part) =>
      requestRetainedConfigExpressionTargetsIdentity(part, targets, new Set(seen), depth + 1),
    );
  }
  if (Node.isAwaitExpression(node)) {
    return requestRetainedConfigExpressionTargetsIdentity(
      node.getExpression(),
      targets,
      new Set(seen),
      depth + 1,
    );
  }
  return false;
}

function requestRetainedConfigCallIsReviewed(
  call: import('ts-morph').CallExpression,
  session: RequestProvenanceSession,
): boolean {
  if (requestBuildConfigConstructorCallIsClosed(call)) return true;
  if (requestHandlerFactoryInvocationsForCall(call, session).length > 0) return true;
  if (requestStaticFrameworkGuardIsClosed(call)) return true;
  if (requestVerifierFactoryName(call.getExpression())) return true;
  if (requestRetainedConfigDrizzleTableCallIsReviewed(call)) return true;
  if (
    requestExpressionIsDirectImportedExport(call.getExpression(), '@kovojs/style', 'defineTheme')
  ) {
    return call.getArguments().every(requestExpressionIsClosedStaticData);
  }
  const callee = unwrapStaticExpression(call.getExpression());
  const receiver = requestCallReceiver(callee);
  if (
    requestExpressionIsFrameworkSchemaBuilderCall(call) &&
    requestFrameworkSchemaBuilderCallIsPristine(call, session)
  ) {
    return true;
  }
  const identity = canonicalFrameworkExportForExpression(call.getExpression());
  // Finite constructors that intentionally snapshot/retain authored option records. Do not grant
  // package-wide trust: a future identity-returning Kovo API must not become a laundering path.
  if (
    identity &&
    [
      '@kovojs/core:customVerifier',
      '@kovojs/core:component',
      '@kovojs/core:domain',
      '@kovojs/core:hmacSignature',
      '@kovojs/core:publicAccess',
      '@kovojs/core:redirect',
      '@kovojs/core:secret',
      '@kovojs/core:standardWebhooks',
      '@kovojs/core:stylesheet',
      '@kovojs/core:verifiedMachineAccess',
      '@kovojs/drizzle:kovo',
      '@kovojs/server:createMemoryVersionedClientModuleRegistry',
      '@kovojs/server:customVerifier',
      '@kovojs/server:component',
      '@kovojs/server:domain',
      '@kovojs/server:hmacSignature',
      '@kovojs/server:publicAccess',
      '@kovojs/server:redirect',
      '@kovojs/server:secret',
      '@kovojs/server:session',
      '@kovojs/server:standardWebhooks',
      '@kovojs/server:stylesheet',
      '@kovojs/server:verifiedMachineAccess',
      '@kovojs/style:defineTheme',
    ].includes(`${identity.module}:${identity.exportName}`)
  ) {
    return true;
  }
  return !!(
    receiver &&
    requestStaticCallMember(callee) === 'freeze' &&
    expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0)
  );
}

function requestRetainedConfigDrizzleTableCallIsReviewed(
  call: import('ts-morph').CallExpression,
): boolean {
  if (
    !requestExpressionIsDirectImportedExport(
      call.getExpression(),
      'drizzle-orm/pg-core',
      'pgTable',
    ) ||
    !requestDrizzleColumnBuilderProtocolsArePristine(call)
  ) {
    return false;
  }
  const [name, columns, extra, ...rest] = call.getArguments();
  const columnRecord = columns ? unwrapStaticExpression(columns) : undefined;
  return !!(
    rest.length === 0 &&
    name &&
    isStringLiteralLike(unwrapStaticExpression(name)) &&
    columnRecord &&
    Node.isObjectLiteralExpression(columnRecord) &&
    requestDrizzleColumnsObjectIsClosed(columnRecord) &&
    (extra === undefined || requestDrizzleExtraConfigIsClosed(extra, columnRecord))
  );
}

function scanRequestRetainedConfigMutationCallables(
  call: import('ts-morph').CallExpression,
  context: RequestProcessScanContext,
): void {
  const visit = (candidate: Node): void => {
    const node = unwrapStaticExpression(candidate);
    if (Node.isObjectLiteralExpression(node)) {
      for (const property of node.getProperties()) {
        const value = Node.isPropertyAssignment(property)
          ? property.getInitializer()
          : Node.isShorthandPropertyAssignment(property)
            ? property.getNameNode()
            : Node.isSpreadAssignment(property)
              ? property.getExpression()
              : undefined;
        if (value) visit(value);
      }
      return;
    }
    if (Node.isArrayLiteralExpression(node)) {
      for (const element of node.getElements()) {
        visit(Node.isSpreadElement(element) ? element.getExpression() : element);
      }
      return;
    }
    const direct = requestCallableForFunctionNode(node);
    const resolution = direct
      ? { callables: [direct] }
      : resolveRequestCallable(node, new Set(), 0, context.provenance);
    for (const callable of resolution.callables) scanRequestCallable(callable, context);
  };
  const invocation = requestNormalizedCall(call);
  for (const callable of resolveRequestCallable(invocation.target, new Set(), 0, context.provenance)
    .callables) {
    scanRequestCallable(callable, context);
  }
  for (const argument of call.getArguments()) visit(argument);
}

function scanRequestRootCallbackProperty(
  property: Node,
  factory: (typeof REQUEST_HANDLER_FACTORIES)[number],
  spec: RequestRootCallbackSpec,
  context: RequestProcessScanContext,
): void {
  if (Node.isGetAccessorDeclaration(property) || Node.isSetAccessorDeclaration(property)) {
    appendOpaqueRequestHandlerFact(context, property, '<accessor-callback>');
    return;
  }
  const expression =
    requestHandlerPropertyExpression(property) ??
    (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)
      ? property
      : undefined);
  if (spec.kind === 'record') {
    if (!expression) {
      appendOpaqueRequestHandlerFact(context, property, '<dynamic-callback-record>');
      return;
    }
    const record = resolveStaticObjectLiteral(expression, new Set(), 0);
    if (!record) {
      const opaque = opaqueBareModuleForExpression(expression, new Set(), 0);
      if (opaque) appendOpaqueRequestHandlerFact(context, property, opaque);
      return;
    }
    for (const entry of record.getProperties()) {
      if (Node.isSpreadAssignment(entry)) {
        appendOpaqueRequestHandlerFact(context, entry, '<spread-callback-record>');
        continue;
      }
      if (Node.isGetAccessorDeclaration(entry) || Node.isSetAccessorDeclaration(entry)) {
        appendOpaqueRequestHandlerFact(context, entry, '<accessor-callback>');
        continue;
      }
      const name = requestObjectLiteralElementNameNode(entry);
      if (name && Node.isComputedPropertyName(name) && staticMemberName(name) === undefined) {
        appendOpaqueRequestHandlerFact(context, entry, '<computed-callback-name>');
        continue;
      }
      scanRequestRootCallbackCandidate(
        requestHandlerPropertyExpression(entry) ?? entry,
        factory.exportName,
        `${spec.property}.${staticMemberName(requestObjectLiteralElementNameNode(entry)) ?? '[computed]'}`,
        spec,
        context,
      );
    }
    return;
  }

  if (spec.kind === 'meta') {
    if (!expression) {
      scanRequestRootCallbackCandidate(property, factory.exportName, spec.property, spec, context);
      return;
    }
    scanRequestMetaCallbacks(expression, factory.exportName, spec, context);
    return;
  }

  scanRequestRootCallbackCandidate(
    expression ?? property,
    factory.exportName,
    spec.property,
    spec,
    context,
  );
}

function requestRootPropertyCandidates(
  ownerSource: Node,
  owner: import('ts-morph').ObjectLiteralExpression,
  path: readonly string[],
  context: RequestProcessScanContext,
  snapshotBoundary = Number.POSITIVE_INFINITY,
): Node[] {
  let owners: readonly {
    readonly object?: import('ts-morph').ObjectLiteralExpression;
    readonly source: Node;
  }[] = [{ object: owner, source: ownerSource }];
  for (const [index, name] of path.entries()) {
    const terminal = index === path.length - 1;
    const candidates: Node[] = [];
    for (const current of owners) {
      const property = current.object
        ? requestStaticObjectProperty(current.object, name)
        : undefined;
      if (property) candidates.push(property);
      candidates.push(
        ...requestAssignedObjectPropertyExpressions(
          current.source,
          name,
          context,
          snapshotBoundary,
        ),
      );
      candidates.push(
        ...requestKnownFactoryMemberCandidates(current.source, name, context.provenance, new Set()),
      );
      candidates.push(
        ...requestAccessorCallablesForExpression(
          current.source,
          name,
          new Set(),
          context.provenance,
        ).map((callable) => callable.declaration),
      );

      if (
        candidates.length === 0 &&
        !current.object &&
        !requestKnownFrameworkMemberIsClosed(current.source, name, new Set())
      ) {
        const opaque = opaqueBareModuleForExpression(current.source, new Set(), 0);
        if (opaque) appendOpaqueRequestHandlerFact(context, current.source, opaque);
      }
    }
    if (terminal) return dedupeRequestNodes(candidates);
    const nested: {
      object?: import('ts-morph').ObjectLiteralExpression;
      source: Node;
    }[] = [];
    for (const candidate of candidates) {
      if (Node.isGetAccessorDeclaration(candidate) || Node.isSetAccessorDeclaration(candidate)) {
        appendOpaqueRequestHandlerFact(context, candidate, '<accessor-callback-container>');
        continue;
      }
      const source = requestHandlerPropertyExpression(candidate) ?? candidate;
      const object = resolveStaticObjectLiteral(source, new Set(), 0);
      nested.push({ ...(object ? { object } : {}), source });
    }
    owners = nested;
    if (owners.length === 0) return [];
  }
  return [];
}

function requestKnownFactoryMemberCandidates(
  expression: Node,
  member: string,
  session: RequestProvenanceSession,
  seen: Set<string>,
): Node[] {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `node:${requestNodeIdentity(node)}:${member}`;
  if (seen.has(nodeKey) || !requestProvenanceStep(session, node)) return [];
  seen.add(nodeKey);

  if (Node.isConditionalExpression(node)) {
    return dedupeRequestNodes(
      [node.getWhenTrue(), node.getWhenFalse()].flatMap((branch) =>
        requestKnownFactoryMemberCandidates(branch, member, session, new Set(seen)),
      ),
    );
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return dedupeRequestNodes(
        [node.getLeft(), node.getRight()].flatMap((branch) =>
          requestKnownFactoryMemberCandidates(branch, member, session, new Set(seen)),
        ),
      );
    }
  }
  if (Node.isCallExpression(node)) {
    const verifierFactory = requestVerifierFactoryName(node.getExpression());
    if (verifierFactory === 'customVerifier' && member === 'verify') {
      const verify = node.getArguments()[1];
      return verify ? [verify] : [];
    }
    if (verifierFactory === 'hmacSignature') {
      const options = node.getArguments()[0];
      if (!options) return [];
      if (member === 'config') return [options];
      if (member === 'payload' || member === 'multiSig' || member === 'tolerance') {
        const object = resolveStaticObjectLiteral(options, new Set(), 0);
        const property = object ? requestStaticObjectProperty(object, member) : undefined;
        return property ? [property] : [];
      }
      // The generated verify method is framework-owned and closes over the callback-bearing
      // options above. It is not an app callback to scan independently.
      if (member === 'verify') return [];
    }

    const candidates = resolveRequestCallable(
      node.getExpression(),
      new Set(),
      0,
      session,
    ).callables.flatMap((callable) =>
      requestWireOutputExpressions(callable).flatMap((output) =>
        requestKnownFactoryMemberCandidates(output, member, session, new Set(seen)),
      ),
    );
    if (candidates.length > 0) return dedupeRequestNodes(candidates);
  }

  const symbol = node.getSymbol();
  if (!symbol) return [];
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return [];
  seen.add(symbolKey);
  const candidates: Node[] = [];
  try {
    const aliased = symbol.getAliasedSymbol();
    if (aliased && aliased !== symbol) {
      for (const declaration of aliased.getDeclarations()) {
        const initializer = valueDeclarationInitializer(declaration);
        if (initializer) {
          candidates.push(
            ...requestKnownFactoryMemberCandidates(initializer, member, session, new Set(seen)),
          );
        }
      }
    }
  } catch {
    // A bare-package alias is surfaced by requestRootPropertyCandidates as an opaque source.
  }
  for (const declaration of symbol.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (initializer) {
      candidates.push(
        ...requestKnownFactoryMemberCandidates(initializer, member, session, new Set(seen)),
      );
    }
  }
  return dedupeRequestNodes(candidates);
}

function requestKnownFrameworkMemberIsClosed(
  expression: Node,
  member: string,
  seen: Set<string>,
): boolean {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `${requestNodeIdentity(node)}:${member}`;
  if (seen.has(nodeKey)) return false;
  seen.add(nodeKey);
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const verifierFactory = requestVerifierFactoryName(callee);
    if (
      verifierFactory === 'standardWebhooks' ||
      (verifierFactory === 'hmacSignature' && member === 'verify')
    ) {
      return true;
    }
    const receiver = requestCallReceiver(callee);
    if (
      (member === 'parse' || member === 'parseAsync') &&
      receiver &&
      requestExpressionIsFrameworkSchemaNamespace(receiver)
    ) {
      return true;
    }
  }
  if (Node.isConditionalExpression(node)) {
    return [node.getWhenTrue(), node.getWhenFalse()].every((branch) =>
      requestKnownFrameworkMemberIsClosed(branch, member, new Set(seen)),
    );
  }
  if (Node.isNewExpression(node)) {
    return requestClassDeclarationsForExpression(node.getExpression(), new Set()).length > 0;
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (!symbol) return false;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return false;
  seen.add(symbolKey);
  return symbol.getDeclarations().some((declaration) => {
    const initializer = valueDeclarationInitializer(declaration);
    return initializer
      ? requestKnownFrameworkMemberIsClosed(initializer, member, new Set(seen))
      : false;
  });
}

function requestExpressionIsFrameworkSchemaNamespace(expression: Node): boolean {
  const imported = requestImportedModuleExportForExpression(
    expression,
    (specifier) => specifier === '@kovojs/core' || specifier === '@kovojs/server',
    new Set(),
    0,
  );
  return (
    imported?.exportName === 's' ||
    expressionResolvesToFrameworkExport(expression, frameworkExport('@kovojs/server', 's')) ||
    expressionResolvesToFrameworkExport(expression, frameworkExport('@kovojs/core', 's'))
  );
}

function requestExpressionIsFrameworkSchemaBuilderCall(expression: Node): boolean {
  const node = unwrapStaticExpression(expression);
  if (!Node.isCallExpression(node)) return false;
  const callee = unwrapStaticExpression(node.getExpression());
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  if (!receiver || !member) return false;
  if (requestExpressionIsFrameworkSchemaNamespace(receiver)) {
    return [
      'array',
      'boolean',
      'date',
      'datetime',
      'decimal',
      'file',
      'json',
      'number',
      'object',
      'record',
      'secret',
      'string',
    ].includes(member);
  }
  return (
    requestExpressionIsFrameworkSchemaBuilderCall(receiver) &&
    [
      'accept',
      'allowControlChars',
      'default',
      'email',
      'format',
      'int',
      'matches',
      'max',
      'maxBytes',
      'min',
      'multiline',
      'optional',
      'pattern',
      'slug',
      'store',
      'url',
      'uuid',
    ].includes(member)
  );
}

function requestFrameworkSchemaBuilderCallIsPristine(
  call: import('ts-morph').CallExpression,
  session: RequestProvenanceSession,
): boolean {
  const base = requestFrameworkSchemaBuilderBaseReceiver(call);
  if (!base || !requestFrameworkSchemaNamespaceIsPristine(base)) return false;
  const projectKey = requestNodeIdentity(call.getSourceFile());
  const memoized = session.schemaBuilderPristineMemo.get(projectKey);
  if (memoized !== undefined) return memoized;
  const pristine = requestFrameworkSchemaBuilderPrototypesArePristine(call);
  session.schemaBuilderPristineMemo.set(projectKey, pristine);
  return pristine;
}

function requestFrameworkSchemaBuilderBaseReceiver(
  call: import('ts-morph').CallExpression,
): Node | undefined {
  let current = call;
  while (true) {
    const receiver = requestCallReceiver(unwrapStaticExpression(current.getExpression()));
    if (!receiver) return undefined;
    if (requestExpressionIsFrameworkSchemaNamespace(receiver)) return receiver;
    const unwrapped = unwrapStaticExpression(receiver);
    if (!Node.isCallExpression(unwrapped)) return undefined;
    current = unwrapped;
  }
}

function requestFrameworkSchemaNamespaceIsPristine(expression: Node): boolean {
  for (const module of ['@kovojs/core', '@kovojs/server']) {
    if (
      requestExpressionResolvesToExactImportedCarrier(expression, module, 's', new Set()) &&
      requestExactImportedCarrierIsPristine(expression, module, 's')
    ) {
      return true;
    }
  }
  return false;
}

function requestFrameworkSchemaBuilderPrototypesArePristine(expression: Node): boolean {
  const project = expression.getSourceFile().getProject();
  const resolvesToPrototype = (candidate: Node | undefined): boolean =>
    !!candidate &&
    requestExpressionResolvesToFrameworkSchemaBuilderPrototype(candidate, new Set(), 0);

  for (const sourceFile of project.getSourceFiles()) {
    for (const access of [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression),
    ]) {
      const member = Node.isPropertyAccessExpression(access)
        ? staticMemberName(access.getNameNode())
        : staticMemberName(access.getArgumentExpression());
      if (
        (member === '__proto__' || member === 'constructor') &&
        requestExpressionResolvesToFrameworkSchemaBuilderValue(access.getExpression(), new Set(), 0)
      ) {
        return false;
      }
    }
    for (const binding of sourceFile.getDescendantsOfKind(SyntaxKind.BindingElement)) {
      const member = staticMemberName(binding.getPropertyNameNode() ?? binding.getNameNode());
      const source = bindingElementSourceExpression(binding);
      if (
        (member === '__proto__' || member === 'constructor') &&
        source &&
        requestExpressionResolvesToFrameworkSchemaBuilderValue(source, new Set(), 0)
      ) {
        return false;
      }
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const method =
        requestGlobalNamespaceMethodForExpression(
          call.getExpression(),
          'Object',
          new Set(['getPrototypeOf']),
          new Set(),
          0,
        ) ??
        requestGlobalNamespaceMethodForExpression(
          call.getExpression(),
          'Reflect',
          new Set(['getPrototypeOf']),
          new Set(),
          0,
        );
      const [target] = call.getArguments();
      if (
        method === 'getPrototypeOf' &&
        target &&
        requestExpressionResolvesToFrameworkSchemaBuilderValue(target, new Set(), 0)
      ) {
        return false;
      }
    }
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const operator = assignment.getOperatorToken().getKind();
      if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
      const target = unwrapStaticExpression(assignment.getLeft());
      if (
        ((Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) &&
          resolvesToPrototype(target.getExpression())) ||
        resolvesToPrototype(assignment.getRight())
      ) {
        return false;
      }
    }
    for (const deletion of sourceFile.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
      const target = unwrapStaticExpression(deletion.getExpression());
      if (
        (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) &&
        resolvesToPrototype(target.getExpression())
      ) {
        return false;
      }
    }
    for (const update of [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
    ]) {
      const target = unwrapStaticExpression(update.getOperand());
      if (
        (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) &&
        resolvesToPrototype(target.getExpression())
      ) {
        return false;
      }
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getArguments().some(resolvesToPrototype)) return false;
      const receiver = requestCallReceiver(unwrapStaticExpression(call.getExpression()));
      if (receiver && resolvesToPrototype(receiver)) return false;
    }
    for (const construct of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      if (construct.getArguments().some(resolvesToPrototype)) return false;
    }
    for (const returned of sourceFile.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      if (resolvesToPrototype(returned.getExpression())) return false;
    }
    for (const property of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyDeclaration)) {
      if (resolvesToPrototype(property.getInitializer())) return false;
    }
    for (const parameter of sourceFile.getDescendantsOfKind(SyntaxKind.Parameter)) {
      if (resolvesToPrototype(parameter.getInitializer())) return false;
    }
  }
  return true;
}

function requestExpressionResolvesToFrameworkSchemaBuilderPrototype(
  expression: Node,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 64) return true;
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  if (seen.has(key)) return false;
  seen.add(key);
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    const [target, ...rest] = node.getArguments();
    return !!(
      receiver &&
      rest.length === 0 &&
      requestStaticCallMember(callee) === 'getPrototypeOf' &&
      (expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) ||
        expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0)) &&
      target &&
      requestExpressionResolvesToFrameworkSchemaBuilderValue(target, new Set(seen), depth + 1)
    );
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    if (
      member === '__proto__' &&
      requestExpressionResolvesToFrameworkSchemaBuilderValue(
        node.getExpression(),
        new Set(seen),
        depth + 1,
      )
    ) {
      return true;
    }
    if (member !== 'prototype') return false;
    const constructor = unwrapStaticExpression(node.getExpression());
    if (
      !Node.isPropertyAccessExpression(constructor) &&
      !Node.isElementAccessExpression(constructor)
    ) {
      return false;
    }
    const constructorMember = Node.isPropertyAccessExpression(constructor)
      ? staticMemberName(constructor.getNameNode())
      : staticMemberName(constructor.getArgumentExpression());
    return (
      constructorMember === 'constructor' &&
      requestExpressionResolvesToFrameworkSchemaBuilderValue(
        constructor.getExpression(),
        new Set(seen),
        depth + 1,
      )
    );
  }
  if (Node.isConditionalExpression(node)) {
    return [node.getWhenTrue(), node.getWhenFalse()].some((branch) =>
      requestExpressionResolvesToFrameworkSchemaBuilderPrototype(branch, new Set(seen), depth + 1),
    );
  }
  if (Node.isBinaryExpression(node)) {
    return [node.getLeft(), node.getRight()].some((part) =>
      requestExpressionResolvesToFrameworkSchemaBuilderPrototype(part, new Set(seen), depth + 1),
    );
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = requestIdentifierValueSymbol(node) ?? node.getSymbol();
  if (!symbol) return false;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return false;
  seen.add(symbolKey);
  return symbol.getDeclarations().some((declaration) => {
    const initializer = valueDeclarationInitializer(declaration);
    return !!(
      initializer &&
      requestExpressionResolvesToFrameworkSchemaBuilderPrototype(
        initializer,
        new Set(seen),
        depth + 1,
      )
    );
  });
}

function requestExpressionResolvesToFrameworkSchemaBuilderValue(
  expression: Node,
  seen: Set<string>,
  depth: number,
): boolean {
  if (depth > 64) return true;
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  if (seen.has(key)) return false;
  seen.add(key);
  if (Node.isCallExpression(node)) return requestExpressionIsFrameworkSchemaBuilderCall(node);
  if (Node.isConditionalExpression(node)) {
    return [node.getWhenTrue(), node.getWhenFalse()].some((branch) =>
      requestExpressionResolvesToFrameworkSchemaBuilderValue(branch, new Set(seen), depth + 1),
    );
  }
  if (Node.isBinaryExpression(node)) {
    return [node.getLeft(), node.getRight()].some((part) =>
      requestExpressionResolvesToFrameworkSchemaBuilderValue(part, new Set(seen), depth + 1),
    );
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = requestIdentifierValueSymbol(node) ?? node.getSymbol();
  if (!symbol) return false;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return false;
  seen.add(symbolKey);
  return symbol.getDeclarations().some((declaration) => {
    const initializer = valueDeclarationInitializer(declaration);
    return !!(
      initializer &&
      requestExpressionResolvesToFrameworkSchemaBuilderValue(initializer, new Set(seen), depth + 1)
    );
  });
}

function requestVerifierFactoryName(
  expression: Node,
): 'customVerifier' | 'hmacSignature' | 'standardWebhooks' | undefined {
  const imported = requestImportedModuleExportForExpression(
    expression,
    (specifier) => specifier === '@kovojs/core' || specifier === '@kovojs/server',
    new Set(),
    0,
  );
  if (
    imported &&
    (imported.exportName === 'customVerifier' ||
      imported.exportName === 'hmacSignature' ||
      imported.exportName === 'standardWebhooks')
  ) {
    return imported.exportName;
  }
  for (const name of ['customVerifier', 'hmacSignature', 'standardWebhooks'] as const) {
    if (
      expressionResolvesToFrameworkExport(expression, frameworkExport('@kovojs/server', name)) ||
      expressionResolvesToFrameworkExport(expression, frameworkExport('@kovojs/core', name))
    ) {
      return name;
    }
  }
  return undefined;
}

function requestAssignedObjectPropertyExpressions(
  owner: Node,
  name: string,
  context: RequestProcessScanContext,
  snapshotBoundary = Number.POSITIVE_INFINITY,
): Node[] {
  const node = unwrapStaticExpression(owner);
  if (!Node.isIdentifier(node) || !node.getSymbol()) return [];
  const target = requestSymbolKey(node.getSymbol()!);
  const expressions: Node[] = [];
  const sourceFile = node.getSourceFile();
  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (!requestMutationMayExecuteBefore(assignment, snapshotBoundary, context.provenance)) {
      continue;
    }
    const operator = assignment.getOperatorToken().getKind();
    if (
      operator !== SyntaxKind.EqualsToken &&
      operator !== SyntaxKind.BarBarEqualsToken &&
      operator !== SyntaxKind.AmpersandAmpersandEqualsToken &&
      operator !== SyntaxKind.QuestionQuestionEqualsToken
    ) {
      continue;
    }
    const left = unwrapStaticExpression(assignment.getLeft());
    if (!Node.isPropertyAccessExpression(left) && !Node.isElementAccessExpression(left)) continue;
    if (!requestWireExpressionResolvesToSymbol(left.getExpression(), target, new Set(), 0))
      continue;
    const member = Node.isPropertyAccessExpression(left)
      ? staticMemberName(left.getNameNode())
      : staticMemberName(left.getArgumentExpression());
    if (member === name) expressions.push(assignment.getRight());
    if (member === undefined) {
      appendOpaqueRequestHandlerFact(context, assignment, '<computed-config-mutation>');
    }
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!requestMutationMayExecuteBefore(call, snapshotBoundary, context.provenance)) continue;
    const callee = unwrapStaticExpression(call.getExpression());
    const receiver = requestCallReceiver(callee);
    if (!receiver) continue;
    const method = requestStaticCallMember(callee);
    const objectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0);
    const reflectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0);
    const [assigned, ...rest] = call.getArguments();
    if (!assigned || !requestWireExpressionResolvesToSymbol(assigned, target, new Set(), 0)) {
      continue;
    }
    if (objectGlobal && method === 'assign') {
      for (const source of rest) {
        const object = resolveStaticObjectLiteral(source, new Set(), 0);
        const property = object ? requestStaticObjectProperty(object, name) : undefined;
        if (property) expressions.push(property);
        if (!object) appendOpaqueRequestHandlerFact(context, source, '<dynamic-config-mutation>');
      }
      continue;
    }
    if (reflectGlobal && method === 'set') {
      const [property, value] = rest;
      const member = staticMemberName(property);
      if (member === name && value) expressions.push(value);
      if (member === undefined) {
        appendOpaqueRequestHandlerFact(context, call, '<computed-config-mutation>');
      }
      continue;
    }
    if ((objectGlobal || reflectGlobal) && method === 'defineProperty') {
      const [property, descriptor] = rest;
      const member = staticMemberName(property);
      if (member === name && descriptor) {
        const value = requestConfigDescriptorValue(descriptor, context);
        if (value) expressions.push(value);
      }
      if (member === undefined) {
        appendOpaqueRequestHandlerFact(context, call, '<computed-config-mutation>');
      }
      continue;
    }
    if (objectGlobal && method === 'defineProperties') {
      const [descriptors] = rest;
      if (!descriptors) continue;
      const map = resolveStaticObjectLiteral(descriptors, new Set(), 0);
      if (!map) {
        appendOpaqueRequestHandlerFact(context, descriptors, '<dynamic-config-mutation>');
        continue;
      }
      if (
        map
          .getProperties()
          .some(
            (property) =>
              Node.isSpreadAssignment(property) ||
              (requestObjectLiteralElementNameNode(property) &&
                Node.isComputedPropertyName(requestObjectLiteralElementNameNode(property)!) &&
                staticMemberName(requestObjectLiteralElementNameNode(property)) === undefined),
          )
      ) {
        appendOpaqueRequestHandlerFact(context, descriptors, '<dynamic-config-mutation>');
      }
      const descriptor = requestStaticObjectProperty(map, name);
      const descriptorExpression = descriptor
        ? (requestHandlerPropertyExpression(descriptor) ?? descriptor)
        : undefined;
      if (descriptorExpression) {
        const value = requestConfigDescriptorValue(descriptorExpression, context);
        if (value) expressions.push(value);
      }
    }
  }
  return dedupeRequestNodes(expressions);
}

function requestMutationMayExecuteBefore(
  mutation: Node,
  snapshotBoundary: number,
  session: RequestProvenanceSession,
): boolean {
  const callable = requestEnclosingCallable(mutation);
  if (!callable) return mutation.getStart() < snapshotBoundary;
  const sites = requestModuleInvocationSitesForCallable(callable, session);
  // An unobserved callable can still execute through constructors, callbacks, accessors, tags,
  // coercion, disposal, or other implicit protocol edges. Only an exhaustive set of explicit
  // top-level invocations after the snapshot proves a mutation cannot have affected it.
  return sites.length === 0 || sites.some((site) => site.getStart() < snapshotBoundary);
}

function requestEnclosingCallable(node: Node): RequestCallable | undefined {
  for (const ancestor of node.getAncestors()) {
    const callable = requestCallableForFunctionNode(ancestor);
    if (callable) return callable;
  }
  return undefined;
}

function requestModuleInvocationSitesForCallable(
  callable: RequestCallable,
  session: RequestProvenanceSession,
): readonly Node[] {
  const key = requestNodeIdentity(callable.declaration);
  const memoized = session.mutationInvocationMemo.get(key);
  if (memoized) return memoized;
  if (session.mutationInvocationActive.has(key)) return [];
  session.mutationInvocationActive.add(key);
  const sites: Node[] = [];
  for (const call of callable.declaration
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!requestProvenanceStep(session, call)) break;
    const resolution = resolveRequestCallable(call.getExpression(), new Set(), 0, session);
    if (
      !resolution.callables.some((candidate) =>
        requestNodesAreSame(candidate.declaration, callable.declaration),
      )
    ) {
      continue;
    }
    const parent = requestEnclosingCallable(call);
    if (!parent) {
      sites.push(call);
      continue;
    }
    sites.push(...requestModuleInvocationSitesForCallable(parent, session));
  }
  for (const construct of callable.declaration
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (!requestProvenanceStep(session, construct)) break;
    const resolution = resolveRequestCallable(construct.getExpression(), new Set(), 0, session);
    if (
      !resolution.callables.some((candidate) =>
        requestNodesAreSame(candidate.declaration, callable.declaration),
      )
    ) {
      continue;
    }
    const parent = requestEnclosingCallable(construct);
    if (!parent) sites.push(construct);
    else sites.push(...requestModuleInvocationSitesForCallable(parent, session));
  }
  session.mutationInvocationActive.delete(key);
  const result = dedupeRequestNodes(sites);
  session.mutationInvocationMemo.set(key, result);
  return result;
}

function requestConfigDescriptorValue(
  descriptor: Node,
  context: RequestProcessScanContext,
): Node | undefined {
  const object = resolveStaticObjectLiteral(descriptor, new Set(), 0);
  if (!object) {
    appendOpaqueRequestHandlerFact(context, descriptor, '<dynamic-config-descriptor>');
    return undefined;
  }
  if (
    object
      .getProperties()
      .some(
        (property) =>
          Node.isSpreadAssignment(property) ||
          (requestObjectLiteralElementNameNode(property) &&
            Node.isComputedPropertyName(requestObjectLiteralElementNameNode(property)!) &&
            staticMemberName(requestObjectLiteralElementNameNode(property)) === undefined),
      )
  ) {
    appendOpaqueRequestHandlerFact(context, descriptor, '<dynamic-config-descriptor>');
  }
  const value = requestStaticObjectProperty(object, 'value');
  if (value) {
    if (Node.isGetAccessorDeclaration(value) || Node.isSetAccessorDeclaration(value)) {
      appendOpaqueRequestHandlerFact(context, value, '<accessor-config-descriptor>');
      return undefined;
    }
    return requestHandlerPropertyExpression(value) ?? value;
  }
  if (requestStaticObjectProperty(object, 'get') || requestStaticObjectProperty(object, 'set')) {
    appendOpaqueRequestHandlerFact(context, descriptor, '<accessor-config-mutation>');
  }
  return undefined;
}

interface RequestAssignedMemberValue {
  readonly expression: Node;
  readonly mutation: Node;
}

const REQUEST_ASSIGNED_MEMBER_INDEX = new WeakMap<
  object,
  ReadonlyMap<string, ReadonlyMap<string, readonly RequestAssignedMemberValue[]>>
>();

function requestAssignedMemberExpressions(
  owner: Node,
  name: string,
  snapshotBoundary = Number.POSITIVE_INFINITY,
  session?: RequestProvenanceSession,
): Node[] {
  const node = unwrapStaticExpression(owner);
  if (!Node.isIdentifier(node)) return [];
  const symbol = node.getSymbol();
  if (!symbol) return [];
  return [
    ...(requestAssignedMemberIndex(node.getSourceFile()).get(requestSymbolKey(symbol))?.get(name) ??
      []),
  ]
    .filter((candidate) =>
      session
        ? requestMutationMayExecuteBefore(candidate.mutation, snapshotBoundary, session)
        : candidate.mutation.getStart() < snapshotBoundary,
    )
    .map((candidate) => candidate.expression);
}

function requestAssignedMemberIndex(
  sourceFile: SourceFile,
): ReadonlyMap<string, ReadonlyMap<string, readonly RequestAssignedMemberValue[]>> {
  const memoized = REQUEST_ASSIGNED_MEMBER_INDEX.get(sourceFile);
  if (memoized) return memoized;
  const mutable = new Map<string, Map<string, RequestAssignedMemberValue[]>>();
  const symbolMemo = new Map<string, readonly string[]>();
  const add = (owner: Node, member: string, expression: Node, mutation: Node): void => {
    for (const target of requestWireExpressionSymbolKeys(owner, symbolMemo, new Set())) {
      const members = mutable.get(target) ?? new Map<string, RequestAssignedMemberValue[]>();
      const expressions = members.get(member) ?? [];
      expressions.push({ expression, mutation });
      members.set(member, expressions);
      mutable.set(target, members);
    }
  };

  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (
      assignment.getOperatorToken().getKind() < SyntaxKind.FirstAssignment ||
      assignment.getOperatorToken().getKind() > SyntaxKind.LastAssignment
    ) {
      continue;
    }
    const left = unwrapStaticExpression(assignment.getLeft());
    if (!Node.isPropertyAccessExpression(left) && !Node.isElementAccessExpression(left)) continue;
    const member = Node.isPropertyAccessExpression(left)
      ? staticMemberName(left.getNameNode())
      : staticMemberName(left.getArgumentExpression());
    if (member !== undefined) {
      add(left.getExpression(), member, assignment.getRight(), assignment);
    }
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrapStaticExpression(call.getExpression());
    const receiver = requestCallReceiver(callee);
    if (
      !receiver ||
      requestStaticCallMember(callee) !== 'assign' ||
      !expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0)
    ) {
      continue;
    }
    const [assigned, ...sources] = call.getArguments();
    if (!assigned) continue;
    for (const source of sources) {
      const object = resolveStaticObjectLiteral(source, new Set(), 0);
      if (!object) continue;
      for (const property of object.getProperties()) {
        const member = staticMemberName(requestObjectLiteralElementNameNode(property));
        const expression = requestHandlerPropertyExpression(property);
        if (member !== undefined && expression) add(assigned, member, expression, call);
      }
    }
  }
  for (const members of mutable.values()) {
    for (const [member, expressions] of members) {
      members.set(member, [
        ...new Map(
          expressions.map((candidate) => [
            `${requestNodeIdentity(candidate.expression)}:${requestNodeIdentity(candidate.mutation)}`,
            candidate,
          ]),
        ).values(),
      ]);
    }
  }
  REQUEST_ASSIGNED_MEMBER_INDEX.set(sourceFile, mutable);
  return mutable;
}

type RequestMutableContainerKind = 'array' | 'map' | 'object' | 'set' | 'weak-map';

interface RequestMutableFactoryWrite {
  readonly key?: string;
  readonly kind:
    | 'array-index'
    | 'array-push'
    | 'array-splice'
    | 'array-unshift'
    | 'map'
    | 'property'
    | 'set';
  readonly opaque?: boolean;
  readonly site: Node;
  readonly values: readonly Node[];
}

interface RequestMutableFactoryRead {
  readonly opaqueAt?: Node;
  readonly recognized: boolean;
  readonly values: readonly Node[];
}

const REQUEST_MUTABLE_FACTORY_WRITE_INDEX = new WeakMap<
  object,
  ReadonlyMap<string, readonly RequestMutableFactoryWrite[]>
>();

function requestMutableFactoryWriteIndex(
  sourceFile: SourceFile,
): ReadonlyMap<string, readonly RequestMutableFactoryWrite[]> {
  const memoized = REQUEST_MUTABLE_FACTORY_WRITE_INDEX.get(sourceFile);
  if (memoized) return memoized;
  const mutable = new Map<string, RequestMutableFactoryWrite[]>();
  const symbolMemo = new Map<string, readonly string[]>();
  const add = (owner: Node, write: RequestMutableFactoryWrite): void => {
    for (const target of requestWireExpressionSymbolKeys(owner, symbolMemo, new Set())) {
      const writes = mutable.get(target) ?? [];
      writes.push(write);
      mutable.set(target, writes);
    }
  };

  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = assignment.getOperatorToken().getKind();
    if (
      operator !== SyntaxKind.EqualsToken &&
      operator !== SyntaxKind.BarBarEqualsToken &&
      operator !== SyntaxKind.AmpersandAmpersandEqualsToken &&
      operator !== SyntaxKind.QuestionQuestionEqualsToken
    ) {
      continue;
    }
    const target = unwrapStaticExpression(assignment.getLeft());
    if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) {
      continue;
    }
    const owner = target.getExpression();
    const key = requestMutableKeyIdentity(
      Node.isPropertyAccessExpression(target)
        ? target.getNameNode()
        : target.getArgumentExpression(),
    );
    const container = requestMutableContainerKind(owner, new Set());
    add(owner, {
      ...(key === undefined ? { opaque: true } : { key }),
      kind: container === 'array' ? 'array-index' : 'property',
      site: assignment,
      values: [assignment.getRight()],
    });
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrapStaticExpression(call.getExpression());
    const receiver = requestCallReceiver(callee);
    const method = requestStaticCallMember(callee);
    if (!receiver || !method) continue;
    const container = requestMutableContainerKind(receiver, new Set());
    if ((container === 'map' || container === 'weak-map') && method === 'set') {
      const [key, value] = call.getArguments();
      if (value) {
        const identity = requestMutableKeyIdentity(key);
        add(receiver, {
          ...(identity === undefined ? { opaque: true } : { key: identity }),
          kind: 'map',
          site: call,
          values: [value],
        });
      }
      continue;
    }
    if (container === 'set' && method === 'add') {
      const [value] = call.getArguments();
      if (value) add(receiver, { kind: 'set', site: call, values: [value] });
      continue;
    }
    if (container === 'array' && (method === 'push' || method === 'unshift')) {
      add(receiver, {
        kind: method === 'push' ? 'array-push' : 'array-unshift',
        site: call,
        values: call.getArguments(),
      });
      continue;
    }
    if (container === 'array' && method === 'splice') {
      const [start, deleteCount, ...values] = call.getArguments();
      add(receiver, {
        ...(requestStaticInteger(start) === undefined ||
        requestStaticInteger(deleteCount) === undefined
          ? { opaque: true }
          : { key: `${requestStaticInteger(start)}:${requestStaticInteger(deleteCount)}` }),
        kind: 'array-splice',
        site: call,
        values,
      });
      continue;
    }

    const objectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0);
    const reflectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0);
    const [owner, property, descriptorOrValue] = call.getArguments();
    if (!owner) continue;
    if (reflectGlobal && method === 'set') {
      if (descriptorOrValue) {
        const key = requestMutableKeyIdentity(property);
        add(owner, {
          ...(key === undefined ? { opaque: true } : { key }),
          kind: 'property',
          site: call,
          values: [descriptorOrValue],
        });
      }
      continue;
    }
    if ((objectGlobal || reflectGlobal) && method === 'defineProperty') {
      if (descriptorOrValue) {
        const key = requestMutableKeyIdentity(property);
        const descriptor = requestMutableDescriptorValues(descriptorOrValue);
        add(owner, {
          ...(key === undefined || descriptor.opaque ? { opaque: true } : { key }),
          kind: 'property',
          site: call,
          values: descriptor.values,
        });
      }
      continue;
    }
    if (objectGlobal && method === 'defineProperties') {
      const descriptors = property ? resolveStaticObjectLiteral(property, new Set(), 0) : undefined;
      if (!descriptors) {
        add(owner, { kind: 'property', opaque: true, site: call, values: [] });
        continue;
      }
      for (const descriptorProperty of descriptors.getProperties()) {
        if (Node.isSpreadAssignment(descriptorProperty)) {
          add(owner, { kind: 'property', opaque: true, site: call, values: [] });
          continue;
        }
        const key = requestMutableKeyIdentity(
          requestObjectLiteralElementNameNode(descriptorProperty),
        );
        const descriptorExpression =
          requestHandlerPropertyExpression(descriptorProperty) ?? descriptorProperty;
        const descriptor = requestMutableDescriptorValues(descriptorExpression);
        add(owner, {
          ...(key === undefined || descriptor.opaque ? { opaque: true } : { key }),
          kind: 'property',
          site: call,
          values: descriptor.values,
        });
      }
      continue;
    }
    if (objectGlobal && method === 'assign') {
      for (const source of call.getArguments().slice(1)) {
        const object = resolveStaticObjectLiteral(source, new Set(), 0);
        if (!object) {
          add(owner, { kind: 'property', opaque: true, site: call, values: [] });
          continue;
        }
        for (const propertyEntry of object.getProperties()) {
          if (Node.isSpreadAssignment(propertyEntry)) {
            add(owner, { kind: 'property', opaque: true, site: call, values: [] });
            continue;
          }
          const key = requestMutableKeyIdentity(requestObjectLiteralElementNameNode(propertyEntry));
          const value = requestHandlerPropertyExpression(propertyEntry);
          if (value) {
            add(owner, {
              ...(key === undefined ? { opaque: true } : { key }),
              kind: 'property',
              site: call,
              values: [value],
            });
          }
        }
      }
    }
  }

  for (const [symbol, writes] of mutable) {
    mutable.set(symbol, [
      ...new Map(
        writes.map((write) => [
          `${requestNodeIdentity(write.site)}:${write.kind}:${write.key ?? '*'}`,
          write,
        ]),
      ).values(),
    ]);
  }
  REQUEST_MUTABLE_FACTORY_WRITE_INDEX.set(sourceFile, mutable);
  return mutable;
}

function requestMutableDescriptorValues(descriptor: Node): {
  readonly opaque: boolean;
  readonly values: readonly Node[];
} {
  const object = resolveStaticObjectLiteral(descriptor, new Set(), 0);
  if (!object) return { opaque: true, values: [] };
  let opaque = object.getProperties().some(Node.isSpreadAssignment);
  const values: Node[] = [];
  const value = requestStaticObjectProperty(object, 'value');
  if (value) {
    const expression = requestHandlerPropertyExpression(value);
    if (expression) values.push(expression);
    else opaque = true;
  }
  const getter = requestStaticObjectProperty(object, 'get');
  if (getter) {
    const expression = requestHandlerPropertyExpression(getter) ?? getter;
    const outputs = resolveRequestCallable(expression, new Set(), 0).callables.flatMap(
      requestWireOutputExpressions,
    );
    if (outputs.length === 0) opaque = true;
    values.push(...outputs);
  }
  if (!value && !getter) opaque = true;
  return { opaque, values: dedupeRequestNodes(values) };
}

function requestMutableContainerKind(
  expression: Node,
  seen: Set<string>,
): RequestMutableContainerKind | undefined {
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  if (seen.has(key)) return undefined;
  seen.add(key);
  if (Node.isArrayLiteralExpression(node)) return 'array';
  if (Node.isObjectLiteralExpression(node)) return 'object';
  if (Node.isNewExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    if (Node.isIdentifier(callee) && unshadowedGlobalIdentifier(callee, callee.getText())) {
      if (callee.getText() === 'Array') return 'array';
      if (callee.getText() === 'Map') return 'map';
      if (callee.getText() === 'Set') return 'set';
      if (callee.getText() === 'WeakMap') return 'weak-map';
    }
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    const method = requestStaticCallMember(callee);
    const kind = receiver ? requestMutableContainerKind(receiver, new Set(seen)) : undefined;
    if (
      ((kind === 'map' || kind === 'weak-map') && method === 'set') ||
      (kind === 'set' && method === 'add')
    ) {
      return kind;
    }
  }
  if (Node.isConditionalExpression(node)) {
    const left = requestMutableContainerKind(node.getWhenTrue(), new Set(seen));
    const right = requestMutableContainerKind(node.getWhenFalse(), new Set(seen));
    return left && left === right ? left : undefined;
  }
  if (!Node.isIdentifier(node)) return undefined;
  const symbol = node.getSymbol();
  if (!symbol) return undefined;
  const kinds = new Set<RequestMutableContainerKind>();
  for (const declaration of symbol.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (!initializer) continue;
    const kind = requestMutableContainerKind(initializer, new Set(seen));
    if (kind) kinds.add(kind);
  }
  return kinds.size === 1 ? [...kinds][0] : undefined;
}

function requestMutableKeyIdentity(expression: Node | undefined): string | undefined {
  if (!expression) return undefined;
  const node = unwrapStaticExpression(expression);
  const string = staticMemberName(node);
  if (string !== undefined) return `literal:${string}`;
  if (Node.isTrueLiteral(node) || Node.isFalseLiteral(node)) return `literal:${node.getText()}`;
  if (node.getKind() === SyntaxKind.NullKeyword) return 'literal:null';
  if (!Node.isIdentifier(node) || !node.getSymbol()) return undefined;
  return `symbol:${requestSymbolKey(node.getSymbol()!)}`;
}

function requestStaticInteger(expression: Node | undefined): number | undefined {
  if (!expression) return undefined;
  const node = unwrapStaticExpression(expression);
  if (Node.isNumericLiteral(node)) {
    const value = Number(node.getText());
    return Number.isSafeInteger(value) ? value : undefined;
  }
  if (
    Node.isPrefixUnaryExpression(node) &&
    node.getOperatorToken() === SyntaxKind.MinusToken &&
    Node.isNumericLiteral(node.getOperand())
  ) {
    const value = -Number(node.getOperand().getText());
    return Number.isSafeInteger(value) ? value : undefined;
  }
  return undefined;
}

function requestExpressionIsSyntacticallyPrimitive(expression: Node, seen: Set<string>): boolean {
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  if (seen.has(key)) return false;
  seen.add(key);
  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isNumericLiteral(node) ||
    Node.isBigIntLiteral(node) ||
    Node.isTrueLiteral(node) ||
    Node.isFalseLiteral(node) ||
    node.getKind() === SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (Node.isTemplateExpression(node)) return true;
  if (Node.isPrefixUnaryExpression(node)) return true;
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      operator === SyntaxKind.CommaToken ||
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken ||
      (operator >= SyntaxKind.FirstAssignment && operator <= SyntaxKind.LastAssignment)
    ) {
      return (
        requestExpressionIsSyntacticallyPrimitive(node.getLeft(), new Set(seen)) &&
        requestExpressionIsSyntacticallyPrimitive(node.getRight(), new Set(seen))
      );
    }
    return true;
  }
  if (Node.isConditionalExpression(node)) {
    return (
      requestExpressionIsSyntacticallyPrimitive(node.getWhenTrue(), new Set(seen)) &&
      requestExpressionIsSyntacticallyPrimitive(node.getWhenFalse(), new Set(seen))
    );
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    return !!(
      Node.isIdentifier(callee) &&
      [
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
      ].includes(callee.getText()) &&
      unshadowedGlobalIdentifier(callee, callee.getText())
    );
  }
  if (!Node.isIdentifier(node)) return false;
  if (unshadowedGlobalIdentifier(node, 'undefined')) return true;
  const symbol = node.getSymbol();
  if (!symbol) return false;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return false;
  seen.add(symbolKey);
  const initializers = symbol
    .getDeclarations()
    .map(valueDeclarationInitializer)
    .filter((initializer): initializer is Node => initializer !== undefined);
  return (
    initializers.length > 0 &&
    initializers.every((initializer) =>
      requestExpressionIsSyntacticallyPrimitive(initializer, new Set(seen)),
    )
  );
}

function requestMutableFactoryReadForCall(
  call: import('ts-morph').CallExpression,
  session: RequestProvenanceSession,
): RequestMutableFactoryRead {
  const callee = unwrapStaticExpression(call.getExpression());
  const receiver = requestCallReceiver(callee);
  const method = requestStaticCallMember(callee);
  if (receiver && method) {
    const kind = requestMutableContainerKind(receiver, new Set());
    if ((kind === 'map' || kind === 'weak-map') && method === 'get') {
      return requestMutableFactoryContainerValues(
        receiver,
        call.getStart(),
        requestMutableKeyIdentity(call.getArguments()[0]),
        false,
        session,
      );
    }
    if (kind === 'array' && method === 'at') {
      const index = requestStaticInteger(call.getArguments()[0]);
      return requestMutableFactoryContainerValues(
        receiver,
        call.getStart(),
        index === undefined ? undefined : `literal:${index}`,
        false,
        session,
      );
    }
    if (
      (kind === 'array' || kind === 'set') &&
      (method === 'entries' || method === 'values' || method === 'keys' || method === 'toArray')
    ) {
      return requestMutableFactoryContainerValues(
        receiver,
        call.getStart(),
        undefined,
        true,
        session,
      );
    }
    if (kind === 'map' && (method === 'entries' || method === 'values')) {
      return requestMutableFactoryContainerValues(
        receiver,
        call.getStart(),
        undefined,
        true,
        session,
      );
    }
  }
  if (
    receiver &&
    method === 'from' &&
    expressionResolvesToGlobalNamespace(receiver, 'Array', new Set(), 0)
  ) {
    const [source] = call.getArguments();
    return source
      ? requestMutableFactoryContainerValues(source, call.getStart(), undefined, true, session)
      : { opaqueAt: call, recognized: true, values: [] };
  }
  return { recognized: false, values: [] };
}

function requestMutableFactoryProjectedValues(
  owner: Node,
  member: string,
  readBoundary: number,
  session: RequestProvenanceSession,
): RequestMutableFactoryRead {
  const kind = requestMutableContainerKind(owner, new Set());
  if (!kind) return { recognized: false, values: [] };
  if (
    (kind === 'map' || kind === 'weak-map') &&
    [
      'clear',
      'delete',
      'entries',
      'forEach',
      'get',
      'has',
      'keys',
      'set',
      'size',
      'values',
    ].includes(member)
  ) {
    return { recognized: false, values: [] };
  }
  if (
    kind === 'set' &&
    ['add', 'clear', 'delete', 'entries', 'forEach', 'has', 'keys', 'size', 'values'].includes(
      member,
    )
  ) {
    return { recognized: false, values: [] };
  }
  if (kind === 'array' && !Number.isSafeInteger(Number(member))) {
    return { recognized: false, values: [] };
  }
  return requestMutableFactoryContainerValues(
    owner,
    readBoundary,
    `literal:${member}`,
    false,
    session,
  );
}

function requestOpaqueMutableFactoryRead(
  expression: Node,
  session: RequestProvenanceSession,
  seen: Set<string>,
): Node | undefined {
  const node = unwrapStaticExpression(expression);
  const key = `opaque-mutable-factory:${requestNodeIdentity(node)}`;
  if (seen.has(key) || !requestProvenanceStep(session, node)) return node;
  seen.add(key);
  if (Node.isNewExpression(node) && requestNewExpressionIsProxy(node)) {
    const handler = node.getArguments()[1];
    return handler ?? node;
  }
  let read: RequestMutableFactoryRead = { recognized: false, values: [] };
  if (Node.isCallExpression(node)) {
    read = requestMutableFactoryReadForCall(node, session);
  } else if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    if (member !== undefined) {
      read = requestMutableFactoryProjectedValues(
        node.getExpression(),
        member,
        node.getStart(),
        session,
      );
    }
  }
  if (read.recognized) {
    if (read.opaqueAt) return read.opaqueAt;
    for (const value of read.values) {
      if (requestFrameworkFactoriesForExpression(value, session).length > 0) continue;
      if (resolveRequestCallable(value, new Set(), 0, session).callables.length > 0) continue;
      if (requestExpressionIsSyntacticallyPrimitive(value, new Set())) continue;
      return value;
    }
    return undefined;
  }
  if (Node.isConditionalExpression(node)) {
    return (
      requestOpaqueMutableFactoryRead(node.getWhenTrue(), session, new Set(seen)) ??
      requestOpaqueMutableFactoryRead(node.getWhenFalse(), session, new Set(seen))
    );
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      operator === SyntaxKind.CommaToken ||
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return (
        requestOpaqueMutableFactoryRead(node.getLeft(), session, new Set(seen)) ??
        requestOpaqueMutableFactoryRead(node.getRight(), session, new Set(seen))
      );
    }
  }
  if (Node.isIdentifier(node) && node.getSymbol()) {
    for (const declaration of node.getSymbol()!.getDeclarations()) {
      const initializer = valueDeclarationInitializer(declaration);
      if (!initializer) continue;
      const opaque = requestOpaqueMutableFactoryRead(initializer, session, new Set(seen));
      if (opaque) return opaque;
    }
  }
  return undefined;
}

function requestNewExpressionIsProxy(node: import('ts-morph').NewExpression): boolean {
  const callee = unwrapStaticExpression(node.getExpression());
  return Node.isIdentifier(callee) && unshadowedGlobalIdentifier(callee, 'Proxy');
}

function requestClassFactoryMemberValues(
  expression: Node,
  member: string,
  session: RequestProvenanceSession,
): Node[] {
  const node = unwrapStaticExpression(expression);
  const instanceConstructor = requestClassInstanceConstructorExpression(node, new Set());
  const classes = requestClassDeclarationsForExpression(instanceConstructor ?? node, new Set());
  if (classes.length === 0) return [];
  const instance = instanceConstructor !== undefined;
  const values: Node[] = [];
  for (const declaration of classes) {
    for (const property of declaration.getProperties()) {
      if (property.isStatic() === instance) continue;
      if (staticMemberName(property.getNameNode()) !== member) continue;
      const initializer = property.getInitializer();
      if (initializer) values.push(initializer);
    }
    if (!instance) continue;
    for (const constructor of declaration.getConstructors()) {
      for (const assignment of constructor.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
        if (
          assignment.getOperatorToken().getKind() < SyntaxKind.FirstAssignment ||
          assignment.getOperatorToken().getKind() > SyntaxKind.LastAssignment
        ) {
          continue;
        }
        const target = unwrapStaticExpression(assignment.getLeft());
        if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) {
          continue;
        }
        const owner = unwrapStaticExpression(target.getExpression());
        const assignedMember = Node.isPropertyAccessExpression(target)
          ? staticMemberName(target.getNameNode())
          : staticMemberName(target.getArgumentExpression());
        if (owner.getKind() === SyntaxKind.ThisKeyword && assignedMember === member) {
          values.push(assignment.getRight());
        }
      }
    }
  }
  if (instance) {
    const sourceFiles = new Set(classes.map((declaration) => declaration.getSourceFile()));
    for (const sourceFile of sourceFiles) {
      for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
        if (!requestMutationMayExecuteBefore(assignment, node.getStart(), session)) continue;
        const target = unwrapStaticExpression(assignment.getLeft());
        if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) {
          continue;
        }
        const assignedMember = Node.isPropertyAccessExpression(target)
          ? staticMemberName(target.getNameNode())
          : staticMemberName(target.getArgumentExpression());
        if (
          assignedMember === member &&
          requestExpressionResolvesToClassPrototype(target.getExpression(), classes)
        ) {
          values.push(assignment.getRight());
        }
      }
    }
  }
  return dedupeRequestNodes(values);
}

function requestClassInstanceConstructorExpression(
  expression: Node,
  seen: Set<string>,
): Node | undefined {
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  if (seen.has(key)) return undefined;
  seen.add(key);
  if (Node.isNewExpression(node)) return node.getExpression();
  if (Node.isConditionalExpression(node)) {
    return (
      requestClassInstanceConstructorExpression(node.getWhenTrue(), new Set(seen)) ??
      requestClassInstanceConstructorExpression(node.getWhenFalse(), new Set(seen))
    );
  }
  if (!Node.isIdentifier(node) || !node.getSymbol()) return undefined;
  for (const declaration of node.getSymbol()!.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (!initializer) continue;
    const constructor = requestClassInstanceConstructorExpression(initializer, new Set(seen));
    if (constructor) return constructor;
  }
  return undefined;
}

function requestClassInstanceSerializedExpressions(
  construct: import('ts-morph').NewExpression,
): Node[] {
  const expressions: Node[] = [];
  for (const declaration of requestClassDeclarationsForExpression(
    construct.getExpression(),
    new Set(),
  )) {
    for (const property of declaration.getProperties()) {
      if (property.isStatic()) continue;
      const initializer = property.getInitializer();
      if (initializer) expressions.push(initializer);
    }
    for (const constructor of declaration.getConstructors()) {
      for (const assignment of constructor.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
        const operator = assignment.getOperatorToken().getKind();
        if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) {
          continue;
        }
        const target = unwrapStaticExpression(assignment.getLeft());
        if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) {
          continue;
        }
        if (unwrapStaticExpression(target.getExpression()).getKind() === SyntaxKind.ThisKeyword) {
          expressions.push(assignment.getRight());
        }
      }
    }
  }
  return dedupeRequestNodes(expressions);
}

function requestMutableFactoryContainerValues(
  owner: Node,
  readBoundary: number,
  key: string | undefined,
  aggregate: boolean,
  session: RequestProvenanceSession,
): RequestMutableFactoryRead {
  const node = unwrapStaticExpression(owner);
  const kind = requestMutableContainerKind(node, new Set());
  if (!kind) return { recognized: false, values: [] };
  const memoKey = [
    requestNodeIdentity(node),
    readBoundary,
    kind,
    aggregate ? '*' : (key ?? '?'),
  ].join(':');
  const memoized = session.mutableFactoryReadMemo.get(memoKey);
  if (memoized) return memoized;
  if (session.mutableFactoryReadActive.has(memoKey) || !requestProvenanceStep(session, node)) {
    return { opaqueAt: node, recognized: true, values: [] };
  }
  session.mutableFactoryReadActive.add(memoKey);
  const initial = requestMutableInitialFactoryValues(
    node,
    kind,
    key,
    aggregate,
    session,
    new Set(),
  );
  const values = [...initial.values];
  let opaqueAt = initial.opaqueAt;
  if (Node.isIdentifier(node) && node.getSymbol()) {
    const writes =
      requestMutableFactoryWriteIndex(node.getSourceFile()).get(
        requestSymbolKey(node.getSymbol()!),
      ) ?? [];
    for (const write of writes) {
      if (!requestMutationMayExecuteBefore(write.site, readBoundary, session)) continue;
      if (!requestMutableFactoryWriteMatches(write, kind, key, aggregate)) continue;
      values.push(...write.values);
      if (write.opaque) opaqueAt ??= write.site;
    }
  }
  const result: RequestMutableFactoryRead = {
    ...(opaqueAt ? { opaqueAt } : {}),
    recognized: true,
    values: dedupeRequestNodes(values),
  };
  session.mutableFactoryReadActive.delete(memoKey);
  session.mutableFactoryReadMemo.set(memoKey, result);
  return result;
}

function requestMutableFactoryWriteMatches(
  write: RequestMutableFactoryWrite,
  container: RequestMutableContainerKind,
  key: string | undefined,
  aggregate: boolean,
): boolean {
  if (aggregate) {
    if (container === 'set') return write.kind === 'set';
    if (container === 'map' || container === 'weak-map') return write.kind === 'map';
    if (container === 'array') return write.kind.startsWith('array-');
    return write.kind === 'property';
  }
  if (container === 'map' || container === 'weak-map') {
    return write.kind === 'map' && (write.opaque || key === undefined || write.key === key);
  }
  if (container === 'array') {
    return (
      write.kind.startsWith('array-') &&
      (write.opaque || key === undefined || write.kind !== 'array-index' || write.key === key)
    );
  }
  return write.kind === 'property' && (write.opaque || key === undefined || write.key === key);
}

function requestMutableInitialFactoryValues(
  expression: Node,
  kind: RequestMutableContainerKind,
  key: string | undefined,
  aggregate: boolean,
  session: RequestProvenanceSession,
  seen: Set<string>,
): RequestMutableFactoryRead {
  const node = unwrapStaticExpression(expression);
  if (!requestProvenanceStep(session, node)) {
    return { opaqueAt: node, recognized: true, values: [] };
  }
  const nodeKey = `${requestNodeIdentity(node)}:${kind}:${aggregate ? '*' : (key ?? '?')}`;
  if (seen.has(nodeKey)) return { opaqueAt: node, recognized: true, values: [] };
  seen.add(nodeKey);
  if (Node.isConditionalExpression(node)) {
    const branches = [node.getWhenTrue(), node.getWhenFalse()].map((branch) =>
      requestMutableInitialFactoryValues(branch, kind, key, aggregate, session, new Set(seen)),
    );
    return {
      ...(branches.find((branch) => branch.opaqueAt)?.opaqueAt
        ? { opaqueAt: branches.find((branch) => branch.opaqueAt)!.opaqueAt }
        : {}),
      recognized: true,
      values: dedupeRequestNodes(branches.flatMap((branch) => branch.values)),
    };
  }
  if (kind === 'array' && Node.isArrayLiteralExpression(node)) {
    const elements = node.getElements();
    if (aggregate || key === undefined) {
      return {
        ...(elements.some(Node.isSpreadElement) ? { opaqueAt: node } : {}),
        recognized: true,
        values: elements.flatMap((element) =>
          Node.isSpreadElement(element) ? [] : Node.isOmittedExpression(element) ? [] : [element],
        ),
      };
    }
    const index = Number(key.replace(/^literal:/, ''));
    const normalized = index < 0 ? elements.length + index : index;
    const element = Number.isSafeInteger(normalized) ? elements[normalized] : undefined;
    return {
      recognized: true,
      values:
        element && !Node.isOmittedExpression(element) && !Node.isSpreadElement(element)
          ? [element]
          : [],
    };
  }
  if (kind === 'object' && Node.isObjectLiteralExpression(node)) {
    const values: Node[] = [];
    let opaqueAt: Node | undefined;
    for (const property of node.getProperties()) {
      if (Node.isSpreadAssignment(property)) {
        opaqueAt ??= property;
        continue;
      }
      const member = staticMemberName(requestObjectLiteralElementNameNode(property));
      if (!aggregate && key !== undefined && `literal:${member}` !== key) continue;
      const value = requestHandlerPropertyExpression(property);
      if (value) values.push(value);
    }
    return { ...(opaqueAt ? { opaqueAt } : {}), recognized: true, values };
  }
  if (Node.isNewExpression(node)) {
    if (kind === 'array') {
      const args = node.getArguments();
      const values =
        args.length === 1 && Node.isNumericLiteral(unwrapStaticExpression(args[0]!)) ? [] : args;
      if (aggregate || key === undefined) return { recognized: true, values };
      const index = Number(key.replace(/^literal:/, ''));
      const normalized = index < 0 ? values.length + index : index;
      return {
        recognized: true,
        values: Number.isSafeInteger(normalized) && values[normalized] ? [values[normalized]!] : [],
      };
    }
    if (kind === 'map' || kind === 'weak-map') {
      const [entries] = node.getArguments();
      if (!entries) return { recognized: true, values: [] };
      const array = unwrapStaticExpression(entries);
      if (!Node.isArrayLiteralExpression(array)) {
        return { opaqueAt: entries, recognized: true, values: [] };
      }
      const values: Node[] = [];
      let opaqueAt: Node | undefined;
      for (const entry of array.getElements()) {
        const pair = Node.isSpreadElement(entry) ? undefined : unwrapStaticExpression(entry);
        if (!pair || !Node.isArrayLiteralExpression(pair)) {
          opaqueAt ??= entry;
          continue;
        }
        const [entryKey, value] = pair.getElements();
        if (!value || Node.isOmittedExpression(value)) continue;
        const identity = requestMutableKeyIdentity(entryKey);
        if (aggregate || key === undefined || identity === undefined || identity === key) {
          values.push(value);
        }
        if (identity === undefined) opaqueAt ??= entryKey;
      }
      return { ...(opaqueAt ? { opaqueAt } : {}), recognized: true, values };
    }
    if (kind === 'set') {
      const [entries] = node.getArguments();
      if (!entries) return { recognized: true, values: [] };
      const array = unwrapStaticExpression(entries);
      return Node.isArrayLiteralExpression(array)
        ? {
            ...(array.getElements().some(Node.isSpreadElement) ? { opaqueAt: array } : {}),
            recognized: true,
            values: array
              .getElements()
              .filter(
                (element) => !Node.isSpreadElement(element) && !Node.isOmittedExpression(element),
              ),
          }
        : { opaqueAt: entries, recognized: true, values: [] };
    }
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    const method = requestStaticCallMember(callee);
    const receiverKind = receiver ? requestMutableContainerKind(receiver, new Set()) : undefined;
    if (receiver && receiverKind === kind) {
      const base = requestMutableInitialFactoryValues(
        receiver,
        kind,
        key,
        aggregate,
        session,
        new Set(seen),
      );
      const values = [...base.values];
      if ((kind === 'map' || kind === 'weak-map') && method === 'set') {
        const [entryKey, value] = node.getArguments();
        const identity = requestMutableKeyIdentity(entryKey);
        if (
          value &&
          (aggregate || key === undefined || identity === undefined || identity === key)
        ) {
          values.push(value);
        }
        return {
          ...(base.opaqueAt || identity === undefined
            ? { opaqueAt: base.opaqueAt ?? entryKey ?? node }
            : {}),
          recognized: true,
          values,
        };
      }
      if (kind === 'set' && method === 'add') {
        const [value] = node.getArguments();
        if (value) values.push(value);
        return { ...(base.opaqueAt ? { opaqueAt: base.opaqueAt } : {}), recognized: true, values };
      }
    }
  }
  if (Node.isIdentifier(node) && node.getSymbol()) {
    const candidates = node
      .getSymbol()!
      .getDeclarations()
      .flatMap((declaration) => {
        const initializer = valueDeclarationInitializer(declaration);
        return initializer
          ? [
              requestMutableInitialFactoryValues(
                initializer,
                kind,
                key,
                aggregate,
                session,
                new Set(seen),
              ),
            ]
          : [];
      });
    if (candidates.length === 0) return { opaqueAt: node, recognized: true, values: [] };
    return {
      ...(candidates.find((candidate) => candidate.opaqueAt)?.opaqueAt
        ? { opaqueAt: candidates.find((candidate) => candidate.opaqueAt)!.opaqueAt }
        : {}),
      recognized: true,
      values: dedupeRequestNodes(candidates.flatMap((candidate) => candidate.values)),
    };
  }
  return { opaqueAt: node, recognized: true, values: [] };
}

function requestWireExpressionSymbolKeys(
  expression: Node,
  memo: Map<string, readonly string[]>,
  seen: Set<string>,
): readonly string[] {
  const node = unwrapStaticExpression(expression);
  if (!Node.isIdentifier(node)) return [];
  const nodeKey = requestNodeIdentity(node);
  const memoized = memo.get(nodeKey);
  if (memoized) return memoized;
  if (seen.has(nodeKey)) return [];
  seen.add(nodeKey);
  const symbol = node.getSymbol();
  if (!symbol) return [];
  const keys = new Set<string>([requestSymbolKey(symbol)]);
  for (const declaration of symbol.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (!initializer) continue;
    for (const key of requestWireExpressionSymbolKeys(initializer, memo, new Set(seen))) {
      keys.add(key);
    }
  }
  const result = [...keys];
  memo.set(nodeKey, result);
  return result;
}

function dedupeRequestNodes(nodes: readonly Node[]): Node[] {
  return [...new Map(nodes.map((node) => [requestNodeIdentity(node), node])).values()];
}

const REQUEST_CREATE_APP_DECLARATION_COLLECTIONS = [
  ['endpoints', 'endpoint'],
  // `webhook()` returns the same public endpoint-family descriptor and is installed through the
  // app's `endpoints` collection. Scan each recognized factory without treating the sibling
  // framework factory as an unresolved declaration (SPEC §6.5 / §6.6).
  ['endpoints', 'webhook'],
  ['mutations', 'mutation'],
  ['queries', 'query'],
  ['routes', 'route'],
  ['tasks', 'task'],
] as const satisfies readonly (readonly [string, RequestHandlerFactoryName])[];

function scanRequestNestedDeclarations(
  definitionSource: Node,
  definition: import('ts-morph').ObjectLiteralExpression,
  factory: RequestHandlerFactoryName,
  context: RequestProcessScanContext,
  snapshotBoundary: number,
): void {
  if (factory === 'createApp') {
    for (const [property, nestedFactory] of REQUEST_CREATE_APP_DECLARATION_COLLECTIONS) {
      for (const candidate of requestRootPropertyCandidates(
        definitionSource,
        definition,
        [property],
        context,
        snapshotBoundary,
      )) {
        const expression = requestHandlerPropertyExpression(candidate) ?? candidate;
        for (const nested of requestDeclarationDefinitions(
          expression,
          nestedFactory,
          context,
          snapshotBoundary,
          new Set(),
        )) {
          const spec = REQUEST_HANDLER_FACTORIES.find(
            (entry) => entry.exportName === nestedFactory,
          );
          if (spec) {
            scanRequestRootCallbacks(
              nested.definition,
              spec,
              context,
              nested.source,
              nested.snapshotBoundary,
            );
          }
        }
      }
    }
  }

  if (factory === 'layout') {
    for (const candidate of requestRootPropertyCandidates(
      definitionSource,
      definition,
      ['queries'],
      context,
      snapshotBoundary,
    )) {
      const expression = requestHandlerPropertyExpression(candidate) ?? candidate;
      const record = resolveStaticObjectLiteral(expression, new Set(), 0);
      if (!record) {
        const opaque = opaqueBareModuleForExpression(expression, new Set(), 0);
        if (opaque) appendOpaqueRequestHandlerFact(context, expression, opaque);
        continue;
      }
      for (const entry of record.getProperties()) {
        if (Node.isSpreadAssignment(entry)) {
          appendOpaqueRequestHandlerFact(context, entry, '<spread-layout-queries>');
          continue;
        }
        const querySource = requestHandlerPropertyExpression(entry);
        if (!querySource) {
          appendOpaqueRequestHandlerFact(context, entry, '<dynamic-layout-query>');
          continue;
        }
        for (const nested of requestDeclarationDefinitions(
          querySource,
          'query',
          context,
          snapshotBoundary,
          new Set(),
        )) {
          const spec = REQUEST_HANDLER_FACTORIES.find((item) => item.exportName === 'query');
          if (spec) {
            scanRequestRootCallbacks(
              nested.definition,
              spec,
              context,
              nested.source,
              nested.snapshotBoundary,
            );
          }
        }
      }
    }
  }

  const nestedLayoutProperty =
    factory === 'route' ? 'layout' : factory === 'layout' ? 'parent' : undefined;
  if (!nestedLayoutProperty) return;
  for (const candidate of requestRootPropertyCandidates(
    definitionSource,
    definition,
    [nestedLayoutProperty],
    context,
    snapshotBoundary,
  )) {
    const expression = requestHandlerPropertyExpression(candidate) ?? candidate;
    for (const nested of requestDeclarationDefinitions(
      expression,
      'layout',
      context,
      snapshotBoundary,
      new Set(),
    )) {
      const spec = REQUEST_HANDLER_FACTORIES.find((entry) => entry.exportName === 'layout');
      if (spec) {
        scanRequestRootCallbacks(
          nested.definition,
          spec,
          context,
          nested.source,
          nested.snapshotBoundary,
        );
      }
    }
  }
}

interface RequestDeclarationDefinition {
  readonly definition: import('ts-morph').ObjectLiteralExpression;
  readonly snapshotBoundary: number;
  readonly source: Node;
}

function requestDeclarationDefinitions(
  expression: Node,
  factory: RequestHandlerFactoryName,
  context: RequestProcessScanContext,
  snapshotBoundary: number,
  seen: Set<string>,
): RequestDeclarationDefinition[] {
  const node = unwrapStaticExpression(expression);
  const key = `node:${requestNodeIdentity(node)}:${factory}`;
  if (seen.has(key) || !requestProvenanceStep(context.provenance, node)) return [];
  seen.add(key);
  const object = resolveStaticObjectLiteral(node, new Set(), 0);
  if (object) return [{ definition: object, snapshotBoundary, source: node }];
  if (Node.isArrayLiteralExpression(node)) {
    return node
      .getElements()
      .flatMap((element) =>
        requestDeclarationDefinitions(
          Node.isSpreadElement(element) ? element.getExpression() : element,
          factory,
          context,
          snapshotBoundary,
          new Set(seen),
        ),
      );
  }
  if (Node.isConditionalExpression(node)) {
    return [node.getWhenTrue(), node.getWhenFalse()].flatMap((branch) =>
      requestDeclarationDefinitions(branch, factory, context, snapshotBoundary, new Set(seen)),
    );
  }
  if (Node.isCallExpression(node)) {
    const recognizedInvocations = requestHandlerFactoryInvocationsForCall(node, context.provenance);
    const invocations = recognizedInvocations.filter(
      (invocation) => invocation.factory.exportName === factory,
    );
    const direct = invocations.flatMap((invocation) => {
      const candidate = invocation.args?.[invocation.args.length - 1];
      const definition = candidate
        ? resolveStaticObjectLiteral(candidate, new Set(), 0)
        : undefined;
      return definition && candidate
        ? [{ definition, snapshotBoundary: node.getStart(), source: candidate }]
        : [];
    });
    if (direct.length > 0) return direct;
    // The same declaration collection can admit multiple reviewed framework descriptor families
    // (notably endpoint + webhook). A call proven to be a different framework factory is not an
    // opaque user factory; the sibling scan owns its definition and callbacks.
    if (recognizedInvocations.length > 0) return [];
    const outputs = resolveRequestCallable(
      node.getExpression(),
      new Set(),
      0,
      context.provenance,
    ).callables.flatMap((callable) =>
      requestWireOutputExpressions(callable).flatMap((output) =>
        requestDeclarationDefinitions(output, factory, context, node.getStart(), new Set(seen)),
      ),
    );
    if (outputs.length === 0) {
      appendOpaqueRequestHandlerFact(context, node, `<unresolved-${factory}-declaration-call>`);
    }
    return outputs;
  }
  if (
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isFunctionDeclaration(node)
  ) {
    const callable = requestCallableForFunctionNode(node);
    const outputs = callable
      ? requestWireOutputExpressions(callable).flatMap((output) =>
          requestDeclarationDefinitions(output, factory, context, snapshotBoundary, new Set(seen)),
        )
      : [];
    if (outputs.length === 0) {
      appendOpaqueRequestHandlerFact(context, node, `<unresolved-${factory}-declaration-factory>`);
    }
    return outputs;
  }
  if (!Node.isIdentifier(node)) {
    appendOpaqueRequestHandlerFact(context, node, `<unresolved-${factory}-declaration>`);
    return [];
  }
  const callableOutputs = resolveRequestCallable(
    node,
    new Set(),
    0,
    context.provenance,
  ).callables.flatMap((callable) =>
    requestWireOutputExpressions(callable).flatMap((output) =>
      requestDeclarationDefinitions(output, factory, context, snapshotBoundary, new Set(seen)),
    ),
  );
  if (callableOutputs.length > 0) return callableOutputs;
  const symbol = requestIdentifierValueSymbol(node);
  if (!symbol) {
    appendOpaqueRequestHandlerFact(context, node, `<unresolved-${factory}-declaration>`);
    return [];
  }
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return [];
  seen.add(symbolKey);
  const declarations = symbol.getDeclarations().flatMap((declaration) => {
    const initializer = valueDeclarationInitializer(declaration);
    return initializer
      ? requestDeclarationDefinitions(
          initializer,
          factory,
          context,
          snapshotBoundary,
          new Set(seen),
        )
      : [];
  });
  const resolvedAsSiblingFactory = symbol
    .getDeclarations()
    .map(valueDeclarationInitializer)
    .filter((initializer): initializer is Node => initializer !== undefined)
    .some((initializer) => {
      const candidate = unwrapStaticExpression(initializer);
      if (!Node.isCallExpression(candidate)) return false;
      const invocations = requestHandlerFactoryInvocationsForCall(candidate, context.provenance);
      return (
        invocations.length > 0 &&
        invocations.every((invocation) => invocation.factory.exportName !== factory)
      );
    });
  if (declarations.length === 0 && !resolvedAsSiblingFactory) {
    appendOpaqueRequestHandlerFact(context, node, `<unresolved-${factory}-declaration>`);
  }
  return declarations;
}

const REQUEST_STATIC_PUBLIC_WIRE_PROPERTIES = new Map<RequestHandlerFactoryName, readonly string[]>(
  [
    ['createApp', ['document', 'stylesheets']],
    // LayoutDefinition currently preserves PageHintOptions in its public snapshot, but the request
    // document assembler merges only app + matched-route hints. Do not claim a confidentiality sink
    // that the runtime does not emit; add layout hints here when that composition path ships.
    [
      'route',
      ['bootstrapScript', 'i18n', 'meta', 'modulepreloads', 'prerenderUrls', 'stylesheets'],
    ],
  ],
);

function scanRequestStaticPublicWire(
  definitionSource: Node,
  definition: import('ts-morph').ObjectLiteralExpression,
  factory: RequestHandlerFactoryName,
  context: RequestProcessScanContext,
  snapshotBoundary: number,
): void {
  for (const property of REQUEST_STATIC_PUBLIC_WIRE_PROPERTIES.get(factory) ?? []) {
    for (const candidate of requestRootPropertyCandidates(
      definitionSource,
      definition,
      [property],
      context,
      snapshotBoundary,
    )) {
      scanRequestPublicWireValue(requestHandlerPropertyExpression(candidate) ?? candidate, context);
    }
  }
}

function scanRequestPublicWireValue(expression: Node, context: RequestProcessScanContext): void {
  const direct = requestCallableForFunctionNode(expression);
  const resolution = direct
    ? { callables: [direct] }
    : resolveRequestCallable(expression, new Set(), 0, context.provenance);
  for (const callable of resolution.callables) {
    scanRequestCallable({ ...callable, publicWire: true }, context);
  }
  const candidates = dedupeRequestNodes([
    expression,
    ...expression.getDescendantsOfKind(SyntaxKind.Identifier),
    ...expression.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
    ...expression.getDescendantsOfKind(SyntaxKind.ElementAccessExpression),
    ...expression.getDescendantsOfKind(SyntaxKind.CallExpression),
  ]);
  for (const candidate of candidates) {
    const raw = requestRawAuthorityForExpression(candidate, new Set(), 0, context.provenance);
    if (raw) appendRequestAuthorityFact(context, candidate, raw, candidate);
    const framework = requestFrameworkAuthorityForExpression(candidate);
    if (framework) appendRequestAuthorityFact(context, candidate, framework, candidate);
  }
}

function requestStaticObjectProperty(
  object: import('ts-morph').ObjectLiteralExpression,
  name: string,
): import('ts-morph').ObjectLiteralElementLike | undefined {
  return (
    object.getProperty(name) ??
    object
      .getProperties()
      .find((property) => staticMemberName(requestObjectLiteralElementNameNode(property)) === name)
  );
}

function scanRequestMetaCallbacks(
  expression: Node,
  factory: RequestHandlerFactoryName,
  spec: RequestRootCallbackSpec,
  context: RequestProcessScanContext,
): void {
  const node = unwrapStaticExpression(expression);
  const elements = requestStaticArgumentList(node);
  const mutations = requestMutatedStaticArrayElements(node, context);
  if (elements || mutations.length > 0) {
    for (const element of [...(elements ?? []), ...mutations]) {
      if (Node.isSpreadElement(element)) {
        appendOpaqueRequestHandlerFact(context, element, '<spread-meta-callbacks>');
        continue;
      }
      scanRequestMetaCallbacks(element, factory, spec, context);
    }
    return;
  }
  const object = resolveStaticObjectLiteral(node, new Set(), 0);
  const resolver = object ? requestStaticObjectProperty(object, 'resolve') : undefined;
  if (resolver) {
    if (Node.isGetAccessorDeclaration(resolver) || Node.isSetAccessorDeclaration(resolver)) {
      appendOpaqueRequestHandlerFact(context, resolver, '<accessor-callback>');
      return;
    }
    scanRequestRootCallbackCandidate(
      requestHandlerPropertyExpression(resolver) ?? resolver,
      factory,
      'meta.resolve',
      spec,
      context,
    );
    return;
  }
  if (object) return;
  scanRequestRootCallbackCandidate(node, factory, 'meta', spec, context);
}

function requestMutatedStaticArrayElements(
  expression: Node,
  context: RequestProcessScanContext,
): Node[] {
  const node = unwrapStaticExpression(expression);
  if (!Node.isIdentifier(node) || !node.getSymbol()) return [];
  const target = requestSymbolKey(node.getSymbol()!);
  const elements: Node[] = [];
  const sourceFile = node.getSourceFile();
  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (
      assignment.getOperatorToken().getKind() < SyntaxKind.FirstAssignment ||
      assignment.getOperatorToken().getKind() > SyntaxKind.LastAssignment
    ) {
      continue;
    }
    const left = unwrapStaticExpression(assignment.getLeft());
    if (!Node.isElementAccessExpression(left)) continue;
    if (!requestWireExpressionResolvesToSymbol(left.getExpression(), target, new Set(), 0)) {
      continue;
    }
    const index = staticMemberName(left.getArgumentExpression());
    if (index !== undefined && /^\d+$/u.test(index)) elements.push(assignment.getRight());
    else appendOpaqueRequestHandlerFact(context, assignment, '<computed-array-mutation>');
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrapStaticExpression(call.getExpression());
    const receiver = requestCallReceiver(callee);
    if (!receiver || !requestWireExpressionResolvesToSymbol(receiver, target, new Set(), 0)) {
      continue;
    }
    const member = requestStaticCallMember(callee);
    if (member === 'push' || member === 'unshift') {
      elements.push(...call.getArguments());
    } else if (member === 'splice') {
      elements.push(...call.getArguments().slice(2));
    } else if (member === undefined) {
      appendOpaqueRequestHandlerFact(context, call, '<computed-array-mutation>');
    }
  }
  return dedupeRequestNodes(elements);
}

function scanRequestRootCallbackCandidate(
  expression: Node,
  factory: RequestHandlerFactoryName,
  callback: string,
  spec: RequestRootCallbackSpec,
  context: RequestProcessScanContext,
): void {
  const direct = requestCallableForFunctionNode(expression);
  const resolution = direct
    ? { callables: [direct] }
    : resolveRequestCallable(expression, new Set(), 0, context.provenance);
  if (resolution.callables.length === 0) {
    if (resolution.opaqueModule) {
      appendOpaqueRequestHandlerFact(context, expression, resolution.opaqueModule);
    } else if (
      !spec.staticValue ||
      !requestStaticCallbackValueIsClosed(expression, spec.staticValue, new Set())
    ) {
      appendOpaqueRequestHandlerFact(context, expression, '<dynamic-callback>');
    }
    return;
  }
  for (const callable of resolution.callables) {
    scanRequestCallable(
      {
        ...callable,
        ...(spec.publicWire ? { publicWire: true } : {}),
        ...(spec.publicWireMethods ? { publicWireMethods: spec.publicWireMethods } : {}),
        ...(spec.publicWirePaths ? { publicWirePaths: spec.publicWirePaths } : {}),
        rootCallback: callback,
        ...(spec.carriers ? { rootCarriers: spec.carriers } : {}),
        rootFactory: factory,
        ...(spec.roles ? { rootParameterRoles: spec.roles } : {}),
      },
      context,
    );
  }
}

function requestStaticCallbackValueIsClosed(
  expression: Node,
  kind: NonNullable<RequestRootCallbackSpec['staticValue']>,
  seen: Set<string>,
): boolean {
  const node = unwrapStaticExpression(expression);
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return true;
  if (
    kind === 'scalar' &&
    (Node.isNumericLiteral(node) ||
      Node.isTrueLiteral(node) ||
      Node.isFalseLiteral(node) ||
      node.getKind() === SyntaxKind.NullKeyword)
  ) {
    return true;
  }
  if ((kind === 'access' || kind === 'guard') && requestStaticFrameworkGuardIsClosed(node)) {
    return true;
  }
  if (kind === 'access' && Node.isCallExpression(node)) {
    const [reason, ...extra] = node.getArguments();
    return !!(
      reason &&
      extra.length === 0 &&
      requestStaticCallbackValueIsClosed(reason, 'scalar', new Set(seen)) &&
      ['publicAccess', 'verifiedMachineAccess'].some(
        (name) =>
          expressionResolvesToFrameworkExport(
            node.getExpression(),
            frameworkExport('@kovojs/server', name),
          ) ||
          expressionResolvesToFrameworkExport(
            node.getExpression(),
            frameworkExport('@kovojs/core', name),
          ),
      )
    );
  }
  if (Node.isConditionalExpression(node)) {
    return (
      requestStaticCallbackValueIsClosed(node.getCondition(), 'scalar', new Set(seen)) &&
      requestStaticCallbackValueIsClosed(node.getWhenTrue(), kind, new Set(seen)) &&
      requestStaticCallbackValueIsClosed(node.getWhenFalse(), kind, new Set(seen))
    );
  }
  if (kind === 'redirect' && Node.isCallExpression(node)) {
    const callee = node.getExpression();
    return (
      expressionResolvesToFrameworkExport(callee, frameworkExport('@kovojs/core', 'redirect')) ||
      expressionResolvesToFrameworkExport(callee, frameworkExport('@kovojs/server', 'redirect'))
    );
  }
  if (kind === 'redirect' && Node.isObjectLiteralExpression(node)) {
    return node.getProperties().every((property) => {
      if (!Node.isPropertyAssignment(property)) return false;
      const name = property.getNameNode();
      if (Node.isComputedPropertyName(name)) return false;
      const value = property.getInitializer();
      return value ? requestStaticCallbackValueIsClosed(value, 'scalar', new Set(seen)) : false;
    });
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (!symbol) return false;
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return false;
  seen.add(key);
  for (const declaration of symbol.getDeclarations()) {
    if (
      Node.isVariableDeclaration(declaration) &&
      declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
    ) {
      return false;
    }
    const initializer = valueDeclarationInitializer(declaration);
    if (initializer && requestStaticCallbackValueIsClosed(initializer, kind, new Set(seen))) {
      return true;
    }
  }
  return false;
}

function requestStaticFrameworkGuardIsClosed(expression: Node): boolean {
  const node = unwrapStaticExpression(expression);
  if (!Node.isCallExpression(node)) return false;
  const directGuard = unwrapStaticExpression(node.getExpression());
  if (
    Node.isIdentifier(directGuard) &&
    requestExpressionIsDirectImportedExport(directGuard, '@kovojs/better-auth', 'authed')
  ) {
    return (
      node.getArguments().length === 0 &&
      requestExactImportedCarrierIsPristine(node.getExpression(), '@kovojs/better-auth', 'authed')
    );
  }
  if (
    Node.isIdentifier(directGuard) &&
    requestExpressionIsDirectImportedExport(directGuard, '@kovojs/better-auth', 'role')
  ) {
    const [role, ...extra] = node.getArguments();
    return !!(
      role &&
      extra.length === 0 &&
      requestExpressionIsClosedStaticData(role) &&
      requestExactImportedCarrierIsPristine(node.getExpression(), '@kovojs/better-auth', 'role')
    );
  }
  const callee = unwrapStaticExpression(node.getExpression());
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  if (
    !receiver ||
    !requestExpressionIsDirectImportedExport(receiver, '@kovojs/server', 'guards') ||
    !requestExactImportedCarrierIsPristine(receiver, '@kovojs/server', 'guards')
  ) {
    return false;
  }

  if (member === 'authed') return node.getArguments().length === 0;
  if (member !== 'rateLimit') return false;

  const [options, ...extra] = node.getArguments();
  const record = options ? unwrapStaticExpression(options) : undefined;
  if (extra.length > 0 || !record || !Node.isObjectLiteralExpression(record)) return false;
  for (const property of record.getProperties()) {
    if (!Node.isPropertyAssignment(property)) return false;
    const name = staticMemberName(property.getNameNode());
    const value = property.getInitializer();
    if (!name || !value || !['max', 'maxKeys', 'per', 'windowMs'].includes(name)) return false;
    // `key` is intentionally absent from the finite list: it executes for every request and must
    // go through the ordinary callable scanner instead of inheriting rateLimit() authority.
    if (!requestExpressionIsClosedStaticData(value)) return false;
  }
  return true;
}

function requestExpressionIsDirectImportedExport(
  expression: Node,
  module: string,
  exportName: string,
): boolean {
  const node = unwrapStaticExpression(expression);
  if (Node.isIdentifier(node)) {
    const useSymbol = node.getSymbol();
    if (!useSymbol) return false;
    const useKey = requestSymbolKey(useSymbol);
    return node
      .getSourceFile()
      .getImportDeclarations()
      .some(
        (declaration) =>
          declaration.getModuleSpecifierValue() === module &&
          declaration.getNamedImports().some((named) => {
            if (named.getName() !== exportName) return false;
            const local = named.getAliasNode() ?? named.getNameNode();
            const importSymbol = local.getSymbol();
            return !!importSymbol && requestSymbolKey(importSymbol) === useKey;
          }),
      );
  }
  if (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) {
    return false;
  }
  const member = Node.isPropertyAccessExpression(node)
    ? staticMemberName(node.getNameNode())
    : staticMemberName(node.getArgumentExpression());
  const namespace = unwrapStaticExpression(node.getExpression());
  if (member !== exportName || !Node.isIdentifier(namespace)) return false;
  const useSymbol = namespace.getSymbol();
  if (!useSymbol) return false;
  const useKey = requestSymbolKey(useSymbol);
  return namespace
    .getSourceFile()
    .getImportDeclarations()
    .some((declaration) => {
      if (declaration.getModuleSpecifierValue() !== module) return false;
      const importedNamespace = declaration.getNamespaceImport();
      const importSymbol = importedNamespace?.getSymbol();
      return !!importSymbol && requestSymbolKey(importSymbol) === useKey;
    });
}

function requestExactImportedCarrierIsPristine(
  expression: Node,
  module: string,
  exportName: string,
): boolean {
  const project = expression.getSourceFile().getProject();
  const resolvesToCarrier = (candidate: Node | undefined): boolean =>
    !!candidate &&
    requestExpressionResolvesToExactImportedCarrier(candidate, module, exportName, new Set());

  for (const sourceFile of project.getSourceFiles()) {
    for (const property of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyDeclaration)) {
      if (resolvesToCarrier(property.getInitializer())) return false;
    }
    for (const parameter of sourceFile.getDescendantsOfKind(SyntaxKind.Parameter)) {
      if (resolvesToCarrier(parameter.getInitializer())) return false;
    }
    for (const declaration of sourceFile.getExportDeclarations()) {
      if (declaration.getModuleSpecifierValue() !== module || declaration.isTypeOnly()) continue;
      const exported = declaration.getNamedExports();
      if (
        exported.length === 0 ||
        exported.some((specifier) => !specifier.isTypeOnly() && specifier.getName() === exportName)
      ) {
        return false;
      }
    }
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const operator = assignment.getOperatorToken().getKind();
      if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
      const target = unwrapStaticExpression(assignment.getLeft());
      if (
        (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) &&
        resolvesToCarrier(target.getExpression())
      ) {
        return false;
      }
      if (resolvesToCarrier(assignment.getRight())) return false;
    }
    for (const deletion of sourceFile.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
      const target = unwrapStaticExpression(deletion.getExpression());
      if (
        (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) &&
        resolvesToCarrier(target.getExpression())
      ) {
        return false;
      }
    }
    for (const update of [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
    ]) {
      const target = unwrapStaticExpression(update.getOperand());
      if (
        (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) &&
        resolvesToCarrier(target.getExpression())
      ) {
        return false;
      }
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callTarget = unwrapStaticExpression(call.getExpression());
      if (
        callTarget.getKind() === SyntaxKind.ImportKeyword ||
        (Node.isIdentifier(callTarget) && callTarget.getText() === 'require')
      ) {
        const [specifier] = call.getArguments();
        if (specifier && isStringLiteralLike(specifier) && specifier.getLiteralText() === module) {
          return false;
        }
      }
      if (call.getArguments().some(resolvesToCarrier)) return false;
      const callee = unwrapStaticExpression(call.getExpression());
      const receiver = requestCallReceiver(callee);
      const member = requestStaticCallMember(callee);
      if (!receiver || !member) continue;
      const objectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0);
      const reflectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0);
      const [target] = call.getArguments();
      if (
        resolvesToCarrier(target) &&
        ((objectGlobal &&
          ['assign', 'defineProperties', 'defineProperty', 'setPrototypeOf'].includes(member)) ||
          (reflectGlobal &&
            ['defineProperty', 'deleteProperty', 'set', 'setPrototypeOf'].includes(member)))
      ) {
        return false;
      }
    }
    for (const object of sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      for (const property of object.getProperties()) {
        const value = Node.isPropertyAssignment(property)
          ? property.getInitializer()
          : Node.isShorthandPropertyAssignment(property)
            ? property.getNameNode()
            : Node.isSpreadAssignment(property)
              ? property.getExpression()
              : undefined;
        if (resolvesToCarrier(value)) return false;
      }
    }
    for (const array of sourceFile.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression)) {
      if (
        array
          .getElements()
          .some((element) =>
            resolvesToCarrier(Node.isSpreadElement(element) ? element.getExpression() : element),
          )
      ) {
        return false;
      }
    }
    for (const returned of sourceFile.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      if (resolvesToCarrier(returned.getExpression())) return false;
    }
    for (const construct of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      if (construct.getArguments().some(resolvesToCarrier)) return false;
    }
  }
  return true;
}

function requestExpressionResolvesToExactImportedCarrier(
  expression: Node,
  module: string,
  exportName: string,
  seen: Set<string>,
): boolean {
  const node = unwrapStaticExpression(expression);
  if (requestExpressionIsDirectImportedExport(node, module, exportName)) return true;
  if (Node.isAwaitExpression(node)) {
    return requestExpressionResolvesToExactImportedCarrier(
      node.getExpression(),
      module,
      exportName,
      new Set(seen),
    );
  }
  if (Node.isConditionalExpression(node)) {
    return [node.getWhenTrue(), node.getWhenFalse()].some((branch) =>
      requestExpressionResolvesToExactImportedCarrier(branch, module, exportName, new Set(seen)),
    );
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      ![
        SyntaxKind.AmpersandAmpersandToken,
        SyntaxKind.BarBarToken,
        SyntaxKind.QuestionQuestionToken,
        SyntaxKind.CommaToken,
        SyntaxKind.EqualsToken,
      ].includes(operator)
    ) {
      return false;
    }
    return [node.getLeft(), node.getRight()].some((part) =>
      requestExpressionResolvesToExactImportedCarrier(part, module, exportName, new Set(seen)),
    );
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    const projected = member
      ? requestWireProjectedExpression(node.getExpression(), [member], new Set(), 0)
      : undefined;
    return !!(
      projected &&
      requestExpressionResolvesToExactImportedCarrier(projected, module, exportName, new Set(seen))
    );
  }
  if (Node.isCallExpression(node)) {
    return resolveRequestCallable(node.getExpression(), new Set(), 0).callables.some((callable) =>
      requestWireOutputExpressions(callable).some((output) =>
        requestExpressionResolvesToExactImportedCarrier(output, module, exportName, new Set(seen)),
      ),
    );
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (!symbol) return false;
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return false;
  seen.add(key);
  return symbol.getDeclarations().some((declaration) => {
    if (
      Node.isVariableDeclaration(declaration) &&
      declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
    ) {
      return false;
    }
    const initializer = valueDeclarationInitializer(declaration);
    return initializer
      ? requestExpressionResolvesToExactImportedCarrier(
          initializer,
          module,
          exportName,
          new Set(seen),
        )
      : false;
  });
}

function requestCallIsExactRespondMethod(call: import('ts-morph').CallExpression): boolean {
  const callee = unwrapStaticExpression(call.getExpression());
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  return !!(
    receiver &&
    member &&
    REQUEST_REVIEWED_RESPOND_METHODS.has(member) &&
    requestExpressionIsDirectImportedExport(receiver, '@kovojs/server', 'respond') &&
    requestExactImportedCarrierIsPristine(receiver, '@kovojs/server', 'respond')
  );
}

function requestCallIsExactFrameworkNativePromise(
  call: import('ts-morph').CallExpression,
): boolean {
  return ['rootedFiles', 'runCommand'].some((exportName) =>
    requestExpressionIsDirectImportedExport(call.getExpression(), '@kovojs/server', exportName),
  );
}

function requestExpressionContainsExactFrameworkNativePromise(
  expression: Node,
  seen: Set<string>,
): boolean {
  const node = unwrapStaticExpression(expression);
  if (Node.isAwaitExpression(node)) {
    return requestExpressionContainsExactFrameworkNativePromise(node.getExpression(), seen);
  }
  if (Node.isCallExpression(node)) return requestCallIsExactFrameworkNativePromise(node);
  if (Node.isConditionalExpression(node)) {
    return [node.getWhenTrue(), node.getWhenFalse()].some((branch) =>
      requestExpressionContainsExactFrameworkNativePromise(branch, new Set(seen)),
    );
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      ![
        SyntaxKind.AmpersandAmpersandToken,
        SyntaxKind.BarBarToken,
        SyntaxKind.QuestionQuestionToken,
        SyntaxKind.CommaToken,
        SyntaxKind.EqualsToken,
      ].includes(operator)
    ) {
      return false;
    }
    return [node.getLeft(), node.getRight()].some((part) =>
      requestExpressionContainsExactFrameworkNativePromise(part, new Set(seen)),
    );
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (!symbol) return false;
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return false;
  seen.add(key);
  const candidates = [
    ...symbol
      .getDeclarations()
      .map(valueDeclarationInitializer)
      .filter((initializer): initializer is Node => initializer !== undefined),
    ...requestAssignedBindingProjections(symbol)
      .filter((projection) => projection.path.length === 0)
      .map((projection) => projection.expression),
  ];
  return candidates.some((candidate) =>
    requestExpressionContainsExactFrameworkNativePromise(candidate, new Set(seen)),
  );
}

function requestCallIsExactRunCommand(call: import('ts-morph').CallExpression): boolean {
  return requestExpressionIsDirectImportedExport(
    call.getExpression(),
    '@kovojs/server',
    'runCommand',
  );
}

function requestCallIsExactClosedRedirect(call: import('ts-morph').CallExpression): boolean {
  const callee = unwrapStaticExpression(call.getExpression());
  if (
    !Node.isIdentifier(callee) ||
    !['@kovojs/core', '@kovojs/server'].some((module) =>
      requestExpressionIsDirectImportedExport(callee, module, 'redirect'),
    )
  ) {
    return false;
  }
  const [path, options, ...extra] = call.getArguments();
  return !!(
    path &&
    options &&
    extra.length === 0 &&
    requestExpressionIsClosedStaticData(path) &&
    requestExpressionIsClosedStaticData(options)
  );
}

function requestCallIsExactPostgresRuntimeConstructor(
  call: import('ts-morph').CallExpression,
): boolean {
  const callee = unwrapStaticExpression(call.getExpression());
  return !!(
    Node.isIdentifier(callee) &&
    call.getArguments().length === 1 &&
    requestExpressionIsDirectImportedExport(callee, '@kovojs/server', 'createPostgresAppRuntimeDb')
  );
}

function requestExpressionResolvesToExactPostgresRuntime(
  expression: Node,
  seen: Set<string>,
): boolean {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `postgres-runtime:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey)) return false;
  seen.add(nodeKey);
  if (Node.isCallExpression(node)) {
    if (requestCallIsExactPostgresRuntimeConstructor(node)) return true;
    const invocation = requestNormalizedCall(node);
    const callables = resolveRequestCallable(invocation.target, new Set(), 0).callables;
    if (callables.length === 0) return false;
    const outputs = callables.flatMap(requestWireOutputExpressions);
    return (
      outputs.length > 0 &&
      outputs.every((output) =>
        requestExpressionResolvesToExactPostgresRuntime(output, new Set(seen)),
      )
    );
  }
  if (Node.isConditionalExpression(node)) {
    return [node.getWhenTrue(), node.getWhenFalse()].every((branch) =>
      requestExpressionResolvesToExactPostgresRuntime(branch, new Set(seen)),
    );
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = requestIdentifierValueSymbol(node) ?? node.getSymbol();
  if (!symbol) return false;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return false;
  seen.add(symbolKey);
  const initializers = symbol
    .getDeclarations()
    .map(valueDeclarationInitializer)
    .filter((initializer): initializer is Node => initializer !== undefined);
  const assignments = requestAssignedBindingProjections(symbol);
  if (assignments.some((projection) => projection.path.length > 0)) return false;
  const values = [
    ...initializers,
    ...assignments
      .filter((projection) => projection.path.length === 0)
      .map((projection) => projection.expression),
  ];
  return (
    values.length > 0 &&
    values.every((value) => requestExpressionResolvesToExactPostgresRuntime(value, new Set(seen)))
  );
}

function requestExactPostgresRuntimeIsPristine(expression: Node): boolean {
  const targets = new Set<string>();
  const collect = (candidate: Node, seen: Set<string>): void => {
    const node = unwrapStaticExpression(candidate);
    const key = requestNodeIdentity(node);
    if (seen.has(key)) return;
    seen.add(key);
    if (Node.isIdentifier(node)) {
      const symbol = requestIdentifierValueSymbol(node) ?? node.getSymbol();
      if (!symbol) return;
      const symbolKey = requestSymbolKey(symbol);
      targets.add(symbolKey);
      for (const declaration of symbol.getDeclarations()) {
        const initializer = valueDeclarationInitializer(declaration);
        if (initializer) collect(initializer, new Set(seen));
      }
      for (const projection of requestAssignedBindingProjections(symbol)) {
        if (projection.path.length === 0) collect(projection.expression, new Set(seen));
      }
      return;
    }
    if (Node.isCallExpression(node)) {
      const invocation = requestNormalizedCall(node);
      for (const callable of resolveRequestCallable(invocation.target, new Set(), 0).callables) {
        for (const output of requestWireOutputExpressions(callable)) collect(output, new Set(seen));
      }
    }
  };
  collect(expression, new Set());
  if (targets.size === 0) return true;

  const project = expression.getSourceFile().getProject();
  let changed = true;
  while (changed) {
    changed = false;
    for (const sourceFile of project.getSourceFiles()) {
      for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        const initializer = declaration.getInitializer();
        const name = declaration.getNameNode();
        if (
          !initializer ||
          !requestExpressionReferencesAny(initializer, targets) ||
          !Node.isIdentifier(name) ||
          !name.getSymbol()
        ) {
          continue;
        }
        const alias = requestSymbolKey(name.getSymbol()!);
        if (!targets.has(alias)) {
          targets.add(alias);
          changed = true;
        }
      }
    }
  }

  for (const sourceFile of project.getSourceFiles()) {
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const operator = assignment.getOperatorToken().getKind();
      if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
      if (!requestExpressionReferencesAny(assignment.getLeft(), targets)) continue;
      const left = unwrapStaticExpression(assignment.getLeft());
      if (
        Node.isIdentifier(left) &&
        left.getSymbol() &&
        targets.has(requestSymbolKey(left.getSymbol()!)) &&
        requestExpressionResolvesToExactPostgresRuntime(assignment.getRight(), new Set())
      ) {
        continue;
      }
      return false;
    }
    for (const deletion of sourceFile.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
      if (requestExpressionReferencesAny(deletion.getExpression(), targets)) return false;
    }
    for (const update of [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
    ]) {
      if (requestExpressionReferencesAny(update.getOperand(), targets)) return false;
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = unwrapStaticExpression(call.getExpression());
      const receiver = requestCallReceiver(callee);
      const member = requestStaticCallMember(callee);
      const [target] = call.getArguments();
      if (
        target &&
        requestExpressionReferencesAny(target, targets) &&
        receiver &&
        member &&
        ((expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
          ['assign', 'defineProperties', 'defineProperty', 'setPrototypeOf'].includes(member)) ||
          (expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0) &&
            ['defineProperty', 'deleteProperty', 'set', 'setPrototypeOf'].includes(member)))
      ) {
        return false;
      }
    }
  }
  return true;
}

function requestCallIsReviewedRouteOutcome(
  call: import('ts-morph').CallExpression,
  callable: RequestCallable,
): boolean {
  if (!requestCallIsExactRespondMethod(call) && !requestCallIsExactClosedRedirect(call)) {
    return false;
  }
  return (
    (callable.rootFactory === 'endpoint' && callable.rootCallback === 'handler') ||
    (callable.rootFactory === 'route' && callable.rootCallback === 'page')
  );
}

function requestRespondOutcomeCallIsWholeFunctionReturn(
  call: import('ts-morph').CallExpression,
  callable: RequestCallable,
): boolean {
  if (
    !(
      (callable.rootFactory === 'endpoint' && callable.rootCallback === 'handler') ||
      (callable.rootFactory === 'route' && callable.rootCallback === 'page')
    )
  ) {
    return false;
  }
  let current: Node = call;
  while (true) {
    const parent = current.getParent();
    if (!parent) return false;
    if (
      Node.isParenthesizedExpression(parent) ||
      Node.isAsExpression(parent) ||
      Node.isSatisfiesExpression(parent) ||
      Node.isTypeAssertion(parent) ||
      Node.isNonNullExpression(parent) ||
      Node.isAwaitExpression(parent)
    ) {
      current = parent;
      continue;
    }
    if (
      Node.isConditionalExpression(parent) &&
      (requestNodesAreSame(parent.getWhenTrue(), current) ||
        requestNodesAreSame(parent.getWhenFalse(), current))
    ) {
      current = parent;
      continue;
    }
    if (
      Node.isReturnStatement(parent) &&
      !!parent.getExpression() &&
      requestNodesAreSame(parent.getExpression()!, current)
    ) {
      return nodeBelongsToRequestCallable(parent, callable);
    }
    if (Node.isArrowFunction(parent) && requestNodesAreSame(parent.getBody(), current)) {
      return requestNodesAreSame(parent, callable.declaration);
    }
    return false;
  }
}

function requestHandlerPropertyExpression(property: Node): Node | undefined {
  if (Node.isPropertyAssignment(property)) return property.getInitializer();
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  return undefined;
}

function requestObjectLiteralElementNameNode(
  property: import('ts-morph').ObjectLiteralElementLike,
): Node | undefined {
  if (
    Node.isPropertyAssignment(property) ||
    Node.isShorthandPropertyAssignment(property) ||
    Node.isMethodDeclaration(property) ||
    Node.isGetAccessorDeclaration(property) ||
    Node.isSetAccessorDeclaration(property)
  ) {
    return property.getNameNode();
  }
  return undefined;
}

function scanRequestCallable(callable: RequestCallable, context: RequestProcessScanContext): void {
  const key = `${callable.declaration.getSourceFile().getFilePath()}:${callable.declaration.getStart()}:${callable.rootFactory ?? 'nested'}:${callable.rootCallback ?? (callable.moduleInitializer ? 'module-initializer' : 'helper')}:${callable.rootParameterRoles?.join(',') ?? 'untyped'}`;
  if (context.scanned.has(key)) return;
  context.scanned.add(key);

  if (!callable.moduleInitializer) {
    registerRequestPromiseSettlementCallables(callable, context.provenance);
    scanRequestDbProviderCapturedInitializers(callable, context);
    scanRequestWireConfidentiality(callable, context);
  }
  scanRequestDestructuringGetters(callable, context);
  scanRequestImplicitExecutionProtocols(callable, context);
  scanRequestClassDefinitions(callable, context);
  if (!callable.moduleInitializer) scanRequestJsxComponents(callable, context);
  const executionRoots: readonly Node[] = [
    callable.body,
    ...requestCallableParameters(callable.declaration),
  ];

  if (!callable.moduleInitializer) {
    for (const output of requestWireOutputExpressions(callable)) {
      for (const accessor of requestAccessorCallablesForExpression(output, undefined, new Set())) {
        scanRequestCallable(accessor, context);
      }
    }
  }

  const propertyReads = executionRoots
    .flatMap((root) => [
      ...(Node.isPropertyAccessExpression(root) || Node.isElementAccessExpression(root)
        ? [root]
        : []),
      ...root.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
      ...root.getDescendantsOfKind(SyntaxKind.ElementAccessExpression),
    ])
    .filter((candidate) => nodeBelongsToRequestCallable(candidate, callable));
  for (const read of propertyReads) {
    const member = Node.isPropertyAccessExpression(read)
      ? read.getName()
      : staticMemberName(read.getArgumentExpression());
    for (const accessor of requestAccessorCallablesForExpression(
      read.getExpression(),
      member,
      new Set(),
    )) {
      scanRequestCallable(
        callable.moduleInitializer ? { ...accessor, moduleInitializer: true } : accessor,
        context,
      );
    }
  }

  // Accessor bodies are executable authority, but ordinary descendant filtering treats them as a
  // nested callable and would otherwise skip every reference inside. Close object/class getters as
  // soon as their containing request root is reachable (SPEC §6.6).
  for (const getter of executionRoots
    .flatMap((root) => root.getDescendants())
    .filter((candidate): candidate is import('ts-morph').GetAccessorDeclaration =>
      Node.isGetAccessorDeclaration(candidate),
    )
    .filter((candidate) => nodeBelongsToRequestCallable(candidate, callable))) {
    const body = getter.getBody();
    if (body) {
      scanRequestCallable(
        {
          body,
          declaration: getter,
          ...(callable.moduleInitializer ? { moduleInitializer: true } : {}),
        },
        context,
      );
    }
  }

  const calls = executionRoots
    .flatMap((root) => [
      ...(Node.isCallExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.CallExpression),
    ])
    .filter((candidate) => nodeBelongsToRequestCallable(candidate, callable));
  for (const call of calls) {
    // Reviewed framework descriptors retain callbacks for later request execution; constructing
    // them does not invoke those callback arguments. Their normal request-root pass owns the
    // callback graph, so do not pre-scan it without the factory roles.
    if (
      callable.moduleInitializer &&
      (requestRetainedConfigCallIsReviewed(call, context.provenance) ||
        requestModuleInitializerFrameworkAuthorityCallIsClosed(call) ||
        requestModuleInitializerStaticRequireIsReviewed(call) ||
        requestModuleInitializerPublicStyleCallIsClosed(call) ||
        (requestDrizzleColumnInitializerIsClosed(call) &&
          requestDrizzleColumnBuilderProtocolsArePristine(call)))
    ) {
      continue;
    }
    if (!callable.moduleInitializer) {
      for (const argument of call.getArguments()) {
        for (const accessor of requestAccessorCallablesForExpression(
          argument,
          undefined,
          new Set(),
        )) {
          scanRequestCallable(accessor, context);
        }
      }
    }
    const rawAuthority = requestRawAuthorityForExpression(
      call.getExpression(),
      new Set(),
      0,
      context.provenance,
    );
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

    const fetchInvocation = requestGovernedFetchInvocation(call);
    if (fetchInvocation) {
      scanOutboundFetchConfidentiality(call, fetchInvocation.args, callable, context);
      scanRequestGovernedFetchProtocols(call, fetchInvocation.args, callable, context);
      continue;
    }
    if (requestCallIsReviewedPureDrizzleExpression(call)) continue;
    if (
      callable.moduleInitializer &&
      requestRetainedConfigCallIsReviewed(call, context.provenance)
    ) {
      continue;
    }
    if (
      requestCallIsPublicStyleCreate(call) ||
      requestCallIsReviewedPublicJsxAttributeHelper(call) ||
      requestCallIsReviewedPublicUiRender(call)
    ) {
      scanRequestFunctionArguments(call, context);
      continue;
    }

    // Exact framework authority minters were classified above. Other package calls terminate at
    // their imported implementation, while local same-named wrappers remain traversable. There is
    // deliberately no blanket "framework-owned means safe" exemption.
    const resolution = resolveRequestCallable(
      call.getExpression(),
      new Set(),
      0,
      context.provenance,
    );
    const invocation = requestNormalizedCall(call);
    for (const nested of resolution.callables) {
      if (callable.moduleInitializer && nested.rootFactory) {
        // Framework descriptor callbacks are deferred even when provenance discovers the factory
        // through an indirect container. The ordinary retained-config/root pass scans those
        // callbacks with exact roles and temporal mutation semantics; treating them as eager here
        // invents execution for an earlier `map.get()` that still returned undefined.
        continue;
      }
      for (const [index, parameter] of requestCallableParameters(nested.declaration).entries()) {
        const argument = (invocation.args ?? call.getArguments())[index];
        if (argument) {
          scanRequestDestructuringPattern(
            parameter.getNameNode(),
            argument,
            callable,
            context,
            new Set(),
          );
        }
      }
      const invoked = requestCallableWithInvocationRoles(
        nested,
        invocation.args ?? call.getArguments(),
        callable,
      );
      scanRequestCallable(
        callable.moduleInitializer ? { ...invoked, moduleInitializer: true } : invoked,
        context,
      );
    }
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

  const constructs = executionRoots
    .flatMap((root) => [
      ...(Node.isNewExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.NewExpression),
    ])
    .filter((candidate) => nodeBelongsToRequestCallable(candidate, callable));
  for (const construct of constructs) {
    for (const argument of construct.getArguments()) {
      for (const accessor of requestAccessorCallablesForExpression(
        argument,
        undefined,
        new Set(),
      )) {
        scanRequestCallable(accessor, context);
      }
    }
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
    const rawAuthority = requestRawAuthorityForExpression(callee, new Set(), 0, context.provenance);
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

  // Merely retaining an authority in module scope does not execute it during import. Request-root
  // scans still classify callback/bind/container escapes when that retained value becomes
  // reachable; the pre-import root only owns calls, construction, and other eager protocols.
  // Skipping bare references here also keeps long inert alias chains linear.
  if (callable.moduleInitializer) return;

  // Security authority can escape without appearing as the direct callee: callbacks, .bind(),
  // Reflect.apply(), object/array storage, and computed namespace selection all preserve the same
  // capability. Classify the reference itself so a cosmetic invocation rewrite cannot bypass
  // KV424. Direct calls above win the same-line de-duplication and retain their argument source.
  const authorityReferences: Node[] = executionRoots
    .flatMap((root) => [
      ...(Node.isIdentifier(root) ||
      Node.isPropertyAccessExpression(root) ||
      Node.isElementAccessExpression(root) ||
      Node.isCallExpression(root)
        ? [root]
        : []),
      ...root.getDescendantsOfKind(SyntaxKind.Identifier),
      ...root.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
      ...root.getDescendantsOfKind(SyntaxKind.ElementAccessExpression),
      ...root.getDescendantsOfKind(SyntaxKind.CallExpression),
    ])
    .filter((candidate) => nodeBelongsToRequestCallable(candidate, callable))
    // JSX attribute names are grammar, not value references. In particular, `<div style={...}>`
    // must not be confused with an in-scope `import * as style from '@kovojs/style'` namespace.
    // The initializer remains in the scan and therefore retains ordinary provenance checks.
    .filter((candidate) => {
      const parent = candidate.getParent();
      if (!Node.isIdentifier(candidate)) return true;
      if (Node.isJsxAttribute(parent) && requestNodesAreSame(parent.getNameNode(), candidate)) {
        return false;
      }
      // Static object keys are likewise grammar. `{ style: styles.root }` must scan the value,
      // while `{ [style]: value }` and shorthand `{ style }` remain real namespace references.
      return !(
        Node.isPropertyAssignment(parent) &&
        !Node.isComputedPropertyName(parent.getNameNode()) &&
        requestNodesAreSame(parent.getNameNode(), candidate)
      );
    })
    .sort((left, right) => left.getStart() - right.getStart() || left.getKind() - right.getKind());
  for (const reference of authorityReferences) {
    const rawAuthority = requestRawAuthorityForExpression(
      reference,
      new Set(),
      0,
      context.provenance,
    );
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

function scanRequestDbProviderCapturedInitializers(
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  if (callable.rootFactory !== 'createApp' || callable.rootCallback !== 'db') return;
  const identifiers = [
    ...(Node.isIdentifier(callable.body) ? [callable.body] : []),
    ...callable.body.getDescendantsOfKind(SyntaxKind.Identifier),
  ].filter((identifier) => nodeBelongsToRequestCallable(identifier, callable));
  const scanned = new Set<string>();
  for (const identifier of identifiers) {
    const symbol = requestIdentifierValueSymbol(identifier) ?? identifier.getSymbol();
    if (!symbol) continue;
    for (const declaration of symbol.getDeclarations()) {
      if (
        !Node.isVariableDeclaration(declaration) ||
        nodeBelongsToRequestCallable(declaration, callable)
      ) {
        continue;
      }
      const initializer = declaration.getInitializer();
      if (!initializer) continue;
      const key = requestNodeIdentity(initializer);
      if (scanned.has(key)) continue;
      scanned.add(key);
      // A provider can close over a preconstructed runtime object. Its module initializer executes
      // before createApp can snapshot the provider, so include that initializer in the pre-import
      // request graph instead of trusting only `provider(request) { return runtime.db(request) }`.
      scanRequestCallable({ body: initializer, declaration }, context);
    }
  }
}

function scanRequestClassDefinitions(
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  const roots: readonly Node[] = [
    callable.body,
    ...requestCallableParameters(callable.declaration),
  ];
  const classes = roots
    .flatMap((root) => [
      ...(Node.isClassDeclaration(root) || Node.isClassExpression(root) ? [root] : []),
      ...root
        .getDescendants()
        .filter(
          (
            candidate,
          ): candidate is
            | import('ts-morph').ClassDeclaration
            | import('ts-morph').ClassExpression =>
            Node.isClassDeclaration(candidate) || Node.isClassExpression(candidate),
        ),
    ])
    .filter((candidate) => nodeBelongsToRequestCallable(candidate, callable));

  for (const declaration of classes) {
    if (callable.moduleInitializer) {
      for (const root of requestModuleClassInitializerRoots(declaration)) {
        scanRequestCallable(root, context);
      }
      continue;
    }
    const heritage = declaration.getExtends()?.getExpression();
    if (heritage) {
      const node = unwrapStaticExpression(heritage);
      const safeGlobalBase =
        Node.isIdentifier(node) &&
        REQUEST_SAFE_GLOBAL_CONSTRUCTORS.has(node.getText()) &&
        unshadowedGlobalIdentifier(node, node.getText()) &&
        !requestGlobalIntrinsicBindingIsMutated(node.getText(), node.getSourceFile());
      if (
        !safeGlobalBase &&
        requestClassDeclarationsForExpression(heritage, new Set()).length === 0
      ) {
        scanRequestOpaqueInternalMethodTarget(
          heritage,
          declaration,
          callable,
          context,
          'class-heritage',
        );
      } else {
        scanRequestProxyUse(heritage, declaration, context);
      }
    }

    for (const decorator of declaration
      .getDescendantsOfKind(SyntaxKind.Decorator)
      .filter(
        (candidate) =>
          candidate.getFirstAncestor(
            (owner) => Node.isClassDeclaration(owner) || Node.isClassExpression(owner),
          ) === declaration,
      )) {
      const expression = decorator.getExpression();
      const resolution = resolveRequestCallable(
        Node.isCallExpression(expression) ? expression.getExpression() : expression,
        new Set(),
        0,
        context.provenance,
      );
      for (const nested of resolution.callables) scanRequestCallable(nested, context);
      if (resolution.callables.length === 0) {
        appendRequestProtocolFact(context, decorator, 'decorated-class', expression);
      }
      scanRequestCallable({ body: expression, declaration: decorator }, context);
    }

    for (const name of declaration
      .getDescendantsOfKind(SyntaxKind.ComputedPropertyName)
      .filter(
        (candidate) =>
          candidate.getFirstAncestor(
            (owner) => Node.isClassDeclaration(owner) || Node.isClassExpression(owner),
          ) === declaration,
      )) {
      scanRequestCallable({ body: name.getExpression(), declaration: name }, context);
    }

    for (const property of declaration
      .getProperties()
      .filter((candidate) => candidate.isStatic())) {
      const initializer = property.getInitializer();
      if (initializer) scanRequestCallable({ body: initializer, declaration: property }, context);
    }
    for (const block of declaration.getStaticBlocks()) {
      scanRequestCallable({ body: block, declaration: block }, context);
    }
  }
}

function registerRequestPromiseSettlementCallables(
  callable: RequestCallable,
  session: RequestProvenanceSession,
): void {
  const roots: readonly Node[] = [
    callable.body,
    ...requestCallableParameters(callable.declaration),
  ];
  const candidates: Node[] = [];
  for (const awaited of roots.flatMap((root) => [
    ...(Node.isAwaitExpression(root) ? [root] : []),
    ...root.getDescendantsOfKind(SyntaxKind.AwaitExpression),
  ])) {
    if (nodeBelongsToRequestCallable(awaited, callable)) {
      candidates.push(awaited.getExpression());
    }
  }
  for (const call of roots.flatMap((root) => [
    ...(Node.isCallExpression(root) ? [root] : []),
    ...root.getDescendantsOfKind(SyntaxKind.CallExpression),
  ])) {
    if (!nodeBelongsToRequestCallable(call, callable)) continue;
    const callee = unwrapStaticExpression(call.getExpression());
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    if (
      !receiver ||
      !member ||
      !expressionResolvesToGlobalNamespace(receiver, 'Promise', new Set(), 0)
    ) {
      continue;
    }
    const value = call.getArguments()[0];
    if (!value) continue;
    if (member === 'resolve') {
      candidates.push(value);
      continue;
    }
    if (['all', 'allSettled', 'any', 'race'].includes(member)) {
      candidates.push(...(requestStaticPromiseAssimilationValues(value, new Set()) ?? []));
    }
  }
  for (const candidate of candidates) {
    for (const nested of requestAccessorCallablesForExpression(
      candidate,
      'then',
      new Set(),
      session,
    )) {
      session.promiseSettlementCallables.add(requestNodeIdentity(nested.declaration));
    }
  }
}

/**
 * Object binding and spread operations execute authored getters even though no explicit property
 * access appears in the AST. Close that implicit call edge before ordinary descendant filtering
 * skips module-scope accessors (SPEC §6.6).
 */
function scanRequestDestructuringGetters(
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  const roots: readonly Node[] = [
    callable.body,
    ...requestCallableParameters(callable.declaration),
  ];
  if (callable.moduleInitializer) {
    for (const clause of roots
      .flatMap((root) => [
        ...(Node.isCatchClause(root) ? [root] : []),
        ...root.getDescendantsOfKind(SyntaxKind.CatchClause),
      ])
      .filter((candidate) => nodeBelongsToRequestCallable(candidate, callable))) {
      const binding = clause.getVariableDeclaration()?.getNameNode();
      if (
        !binding ||
        (!Node.isObjectBindingPattern(binding) && !Node.isArrayBindingPattern(binding))
      ) {
        continue;
      }
      // Any operation in the try block may throw an authored object with getters or an iterator.
      // A finite static thrown-value join is not available here, so destructured catch bindings
      // fail closed before module evaluation; identifier/omitted bindings remain ordinary data.
      appendRequestProtocolFact(context, binding, 'catch-binding-destructuring', binding);
    }
  }
  for (const declaration of roots
    .flatMap((root) => [
      ...(Node.isVariableDeclaration(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.VariableDeclaration),
    ])
    .filter((candidate) => nodeBelongsToRequestCallable(candidate, callable))) {
    const initializer = declaration.getInitializer();
    if (initializer) {
      scanRequestDestructuringPattern(
        declaration.getNameNode(),
        initializer,
        callable,
        context,
        new Set(),
      );
    }
  }

  for (const assignment of roots
    .flatMap((root) => [
      ...(Node.isBinaryExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.BinaryExpression),
    ])
    .filter((candidate) => nodeBelongsToRequestCallable(candidate, callable))) {
    if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    scanRequestDestructuringPattern(
      assignment.getLeft(),
      assignment.getRight(),
      callable,
      context,
      new Set(),
    );
  }

  for (const object of roots
    .flatMap((root) => [
      ...(Node.isObjectLiteralExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression),
    ])
    .filter((candidate) => nodeBelongsToRequestCallable(candidate, callable))) {
    for (const spread of object.getProperties().filter(Node.isSpreadAssignment)) {
      scanRequestGetterConsumer(
        spread.getExpression(),
        spread,
        callable,
        context,
        'object-spread-getters',
      );
    }
  }
}

function scanRequestDestructuringPattern(
  pattern: Node,
  source: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
  seen: Set<string>,
): void {
  const node = unwrapStaticExpression(pattern);
  const key = `destructure:${requestNodeIdentity(node)}:${requestNodeIdentity(source)}`;
  if (seen.has(key) || !requestProvenanceStep(context.provenance, node)) return;
  seen.add(key);

  if (Node.isArrayBindingPattern(node) || Node.isArrayLiteralExpression(node)) {
    scanRequestProtocolUse(source, ['@@iterator'], node, callable, context);
    return;
  }

  if (Node.isObjectBindingPattern(node)) {
    scanRequestGetterConsumer(source, node, callable, context, 'destructuring-getters');
    for (const element of node.getElements()) {
      if (Node.isOmittedExpression(element)) continue;
      const rest = element.getDotDotDotToken() !== undefined;
      const member = rest
        ? undefined
        : requestCallableMemberName(element.getPropertyNameNode() ?? element.getNameNode());
      scanRequestGetterCallables(source, member, context);
      const nested = element.getNameNode();
      if (!Node.isObjectBindingPattern(nested) && !Node.isArrayBindingPattern(nested)) continue;
      for (const candidate of requestDestructuredValueCandidates(source, member, rest)) {
        scanRequestDestructuringPattern(nested, candidate, callable, context, new Set(seen));
      }
    }
    return;
  }

  if (Node.isObjectLiteralExpression(node)) {
    scanRequestGetterConsumer(source, node, callable, context, 'destructuring-getters');
    for (const property of node.getProperties()) {
      if (Node.isSpreadAssignment(property)) {
        scanRequestGetterCallables(source, undefined, context);
        continue;
      }
      const member = requestCallableMemberName(requestObjectLiteralElementNameNode(property));
      scanRequestGetterCallables(source, member, context);
      const nested = requestHandlerPropertyExpression(property);
      if (!nested) continue;
      if (!Node.isObjectLiteralExpression(nested) && !Node.isArrayLiteralExpression(nested)) {
        continue;
      }
      for (const candidate of requestDestructuredValueCandidates(source, member, false)) {
        scanRequestDestructuringPattern(nested, candidate, callable, context, new Set(seen));
      }
    }
  }
}

function requestDestructuredValueCandidates(
  source: Node,
  member: string | undefined,
  rest: boolean,
): Node[] {
  if (rest || member === undefined) return [source];
  const candidates = requestGetterOutputExpressions(source, member, new Set());
  const projected = requestWireProjectedExpression(source, [member], new Set(), 0);
  if (projected) candidates.push(projected);
  return dedupeRequestNodes(candidates);
}

function scanRequestGetterCallables(
  source: Node,
  member: string | undefined,
  context: RequestProcessScanContext,
): void {
  for (const getter of requestGetterCallablesForExpression(
    source,
    member,
    new Set(),
    context.provenance,
  )) {
    scanRequestCallable(getter, context);
  }
}

const REQUEST_COERCION_BINARY_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.AsteriskAsteriskToken,
  SyntaxKind.AsteriskToken,
  SyntaxKind.SlashToken,
  SyntaxKind.PercentToken,
  SyntaxKind.PlusToken,
  SyntaxKind.MinusToken,
  SyntaxKind.LessThanLessThanToken,
  SyntaxKind.GreaterThanGreaterThanToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  SyntaxKind.LessThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.GreaterThanEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.AmpersandToken,
  SyntaxKind.BarToken,
  SyntaxKind.CaretToken,
]);

const REQUEST_COERCION_ASSIGNMENT_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  SyntaxKind.AmpersandEqualsToken,
  SyntaxKind.BarEqualsToken,
  SyntaxKind.CaretEqualsToken,
]);

const REQUEST_TO_PRIMITIVE_HOOKS = ['@@toPrimitive', 'valueOf', 'toString'] as const;

/**
 * Finite request-reachable implicit-execution gate (SPEC §6.6). JavaScript syntax can invoke
 * user code without a CallExpression; only the reviewed plain-data/native subset remains open.
 * Exact authored hooks are traversed, while every unsupported object-capable operand fails closed.
 */
function scanRequestImplicitExecutionProtocols(
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  const roots: readonly Node[] = [
    callable.body,
    ...requestCallableParameters(callable.declaration),
  ];
  const belongs = <T extends Node>(nodes: readonly T[]): T[] =>
    nodes.filter((candidate) => nodeBelongsToRequestCallable(candidate, callable));

  for (const expression of belongs(
    roots.flatMap((root) => [
      ...(Node.isAwaitExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.AwaitExpression),
    ]),
  )) {
    scanRequestProtocolUse(expression.getExpression(), ['then'], expression, callable, context);
  }

  for (const loop of belongs(
    roots.flatMap((root) => [
      ...(Node.isForOfStatement(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.ForOfStatement),
    ]),
  )) {
    scanRequestProtocolUse(
      loop.getExpression(),
      loop.getAwaitKeyword() ? ['@@asyncIterator', '@@iterator'] : ['@@iterator'],
      loop,
      callable,
      context,
    );
    scanRequestProxyUse(loop.getExpression(), loop, context);
    if (loop.getAwaitKeyword()) {
      scanRequestIterableValueProtocols(loop.getExpression(), 'thenable', loop, callable, context);
    }
  }

  for (const yielded of belongs(
    roots.flatMap((root) => [
      ...(Node.isYieldExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.YieldExpression),
    ]),
  )) {
    const target = yielded.getExpression();
    if (target && yielded.getAsteriskToken()) {
      scanRequestProtocolUse(
        target,
        requestCallableIsAsync(callable) ? ['@@asyncIterator', '@@iterator'] : ['@@iterator'],
        yielded,
        callable,
        context,
      );
      if (requestCallableIsAsync(callable)) {
        scanRequestIterableValueProtocols(target, 'thenable', yielded, callable, context);
      }
    } else if (target && requestCallableIsAsync(callable)) {
      scanRequestProtocolUse(target, ['then'], yielded, callable, context);
    }
  }

  if (requestCallableIsAsync(callable)) {
    for (const output of requestWireOutputExpressions(callable)) {
      if (
        Node.isYieldExpression(output.getParent()) ||
        Node.isAwaitExpression(output.getParent())
      ) {
        continue;
      }
      scanRequestProtocolUse(output, ['then'], output, callable, context);
    }
  }

  for (const spread of belongs(
    roots.flatMap((root) => [
      ...(Node.isSpreadElement(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.SpreadElement),
    ]),
  )) {
    scanRequestProtocolUse(spread.getExpression(), ['@@iterator'], spread, callable, context);
  }

  for (const spread of belongs(
    roots.flatMap((root) => [
      ...(Node.isSpreadAssignment(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.SpreadAssignment),
    ]),
  )) {
    scanRequestGetterConsumer(
      spread.getExpression(),
      spread,
      callable,
      context,
      'object-spread-getters',
    );
  }

  for (const template of belongs(
    roots.flatMap((root) => [
      ...(Node.isTemplateExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.TemplateExpression),
    ]),
  )) {
    for (const span of template.getTemplateSpans()) {
      scanRequestProtocolUse(
        span.getExpression(),
        REQUEST_TO_PRIMITIVE_HOOKS,
        span.getExpression(),
        callable,
        context,
      );
    }
  }

  for (const tagged of belongs(
    roots.flatMap((root) => [
      ...(Node.isTaggedTemplateExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression),
    ]),
  )) {
    scanRequestTaggedTemplate(tagged, callable, context);
  }

  for (const binary of belongs(
    roots.flatMap((root) => [
      ...(Node.isBinaryExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.BinaryExpression),
    ]),
  )) {
    const operator = binary.getOperatorToken().getKind();
    if (
      REQUEST_COERCION_BINARY_OPERATORS.has(operator) ||
      REQUEST_COERCION_ASSIGNMENT_OPERATORS.has(operator)
    ) {
      for (const operand of [binary.getLeft(), binary.getRight()]) {
        scanRequestProtocolUse(operand, REQUEST_TO_PRIMITIVE_HOOKS, binary, callable, context);
      }
    } else if (operator === SyntaxKind.InKeyword) {
      scanRequestProtocolUse(
        binary.getLeft(),
        REQUEST_TO_PRIMITIVE_HOOKS,
        binary,
        callable,
        context,
      );
      scanRequestOpaqueInternalMethodTarget(
        binary.getRight(),
        binary,
        callable,
        context,
        'in-operator',
      );
    } else if (operator === SyntaxKind.InstanceOfKeyword) {
      scanRequestProtocolUse(binary.getRight(), ['@@hasInstance'], binary, callable, context);
      scanRequestProxyUse(binary.getRight(), binary, context);
    }
    if (operator >= SyntaxKind.FirstAssignment && operator <= SyntaxKind.LastAssignment) {
      scanRequestProxyMutationTarget(binary.getLeft(), binary, context);
      scanRequestAssignmentTargetProtocols(
        binary.getLeft(),
        binary,
        callable,
        context,
        operator !== SyntaxKind.EqualsToken,
      );
      if (operator === SyntaxKind.EqualsToken) {
        scanRequestArrayDestructuringProtocol(
          binary.getLeft(),
          binary.getRight(),
          callable,
          context,
        );
      }
    }
  }

  for (const unary of belongs(
    roots.flatMap((root) => [
      ...(Node.isPrefixUnaryExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
    ]),
  )) {
    if (
      unary.getOperatorToken() === SyntaxKind.PlusToken ||
      unary.getOperatorToken() === SyntaxKind.MinusToken ||
      unary.getOperatorToken() === SyntaxKind.TildeToken ||
      unary.getOperatorToken() === SyntaxKind.PlusPlusToken ||
      unary.getOperatorToken() === SyntaxKind.MinusMinusToken
    ) {
      scanRequestProtocolUse(
        unary.getOperand(),
        REQUEST_TO_PRIMITIVE_HOOKS,
        unary,
        callable,
        context,
      );
    }
    if (
      unary.getOperatorToken() === SyntaxKind.PlusPlusToken ||
      unary.getOperatorToken() === SyntaxKind.MinusMinusToken
    ) {
      scanRequestAssignmentTargetProtocols(unary.getOperand(), unary, callable, context, true);
    }
  }

  for (const deletion of belongs(
    roots.flatMap((root) => [
      ...(Node.isDeleteExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.DeleteExpression),
    ]),
  )) {
    scanRequestProxyMutationTarget(deletion.getExpression(), deletion, context);
    const target = unwrapStaticExpression(deletion.getExpression());
    if (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) {
      scanRequestOpaqueInternalMethodTarget(
        target.getExpression(),
        deletion,
        callable,
        context,
        'delete-property',
      );
    }
  }

  for (const unary of belongs(
    roots.flatMap((root) => [
      ...(Node.isPostfixUnaryExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
    ]),
  )) {
    scanRequestProtocolUse(
      unary.getOperand(),
      REQUEST_TO_PRIMITIVE_HOOKS,
      unary,
      callable,
      context,
    );
    scanRequestAssignmentTargetProtocols(unary.getOperand(), unary, callable, context, true);
  }

  for (const access of belongs(
    roots.flatMap((root) => [
      ...(Node.isElementAccessExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.ElementAccessExpression),
    ]),
  )) {
    if (requestPropertyAccessIsDirectInvocationTarget(access)) continue;
    const key = access.getArgumentExpression();
    if (key) {
      scanRequestProtocolUse(key, REQUEST_TO_PRIMITIVE_HOOKS, key, callable, context);
    }
    scanRequestPropertyAccessProtocols(access, access, callable, context, false);
  }

  for (const access of belongs(
    roots.flatMap((root) => [
      ...(Node.isPropertyAccessExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
    ]),
  )) {
    if (requestPropertyAccessIsDirectInvocationTarget(access)) continue;
    scanRequestPropertyAccessProtocols(access, access, callable, context, false);
  }

  for (const loop of belongs(
    roots.flatMap((root) => [
      ...(Node.isForInStatement(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.ForInStatement),
    ]),
  )) {
    scanRequestOpaqueInternalMethodTarget(
      loop.getExpression(),
      loop,
      callable,
      context,
      'for-in-enumeration',
    );
  }

  for (const name of belongs(
    roots.flatMap((root) => [
      ...(Node.isComputedPropertyName(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.ComputedPropertyName),
    ]),
  )) {
    scanRequestProtocolUse(
      name.getExpression(),
      REQUEST_TO_PRIMITIVE_HOOKS,
      name,
      callable,
      context,
    );
  }

  for (const call of belongs(
    roots.flatMap((root) => [
      ...(Node.isCallExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.CallExpression),
    ]),
  )) {
    scanRequestCallProtocols(call, callable, context);
  }

  for (const construct of belongs(
    roots.flatMap((root) => [
      ...(Node.isNewExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.NewExpression),
    ]),
  )) {
    scanRequestNewExpressionProtocols(construct, callable, context);
  }

  for (const statement of belongs(
    roots.flatMap((root) => [
      ...(Node.isVariableStatement(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.VariableStatement),
    ]),
  )) {
    const kind = statement.getDeclarationKind();
    if (kind !== VariableDeclarationKind.Using && kind !== VariableDeclarationKind.AwaitUsing) {
      continue;
    }
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer) continue;
      scanRequestProtocolUse(
        initializer,
        kind === VariableDeclarationKind.AwaitUsing
          ? ['@@asyncDispose', '@@dispose']
          : ['@@dispose'],
        declaration,
        callable,
        context,
      );
    }
  }

  for (const declaration of belongs(
    roots.flatMap((root) => [
      ...(Node.isVariableDeclaration(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.VariableDeclaration),
    ]),
  )) {
    const initializer = declaration.getInitializer();
    if (initializer) {
      scanRequestArrayDestructuringProtocol(
        declaration.getNameNode(),
        initializer,
        callable,
        context,
      );
    }
  }
}

function requestCallableIsAsync(callable: RequestCallable): boolean {
  const declaration = callable.declaration;
  if (
    Node.isArrowFunction(declaration) ||
    Node.isFunctionDeclaration(declaration) ||
    Node.isFunctionExpression(declaration) ||
    Node.isMethodDeclaration(declaration)
  ) {
    return declaration.isAsync();
  }
  return false;
}

function scanRequestNewExpressionProtocols(
  construct: import('ts-morph').NewExpression,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  const callee = unwrapStaticExpression(construct.getExpression());
  const name = Node.isIdentifier(callee) ? callee.getText() : undefined;
  const args = construct.getArguments();
  if (name && unshadowedGlobalIdentifier(callee, name)) {
    const dictionaryIndexes =
      name === 'Headers' || name === 'URLSearchParams'
        ? [0]
        : name === 'ArrayBuffer' ||
            name === 'Request' ||
            name === 'Response' ||
            name === 'TextDecoder' ||
            name === 'Blob'
          ? [1]
          : name === 'File' || name === 'AggregateError'
            ? [2]
            : [
                  'Error',
                  'EvalError',
                  'RangeError',
                  'ReferenceError',
                  'SyntaxError',
                  'TypeError',
                  'URIError',
                ].includes(name)
              ? [1]
              : [];
    for (const index of dictionaryIndexes) {
      const dictionary = args[index];
      if (!dictionary) continue;
      if (
        index === 0 &&
        (name === 'Headers' || name === 'URLSearchParams') &&
        requestIterationIsStaticallyHandled(dictionary, callable, context, false)
      ) {
        scanRequestIterableValueProtocols(dictionary, 'string-entry', construct, callable, context);
        continue;
      }
      if (
        [
          'ArrayBuffer',
          'Blob',
          'File',
          'Headers',
          'Request',
          'Response',
          'URLSearchParams',
        ].includes(name)
      ) {
        scanRequestRecordPrimitiveValues(
          dictionary,
          construct,
          callable,
          context,
          `${name}-init-values`,
          new Set(),
        );
      } else {
        scanRequestGetterConsumer(dictionary, construct, callable, context, `${name}-init-getters`);
      }
    }
    if (
      [
        'BigInt64Array',
        'BigUint64Array',
        'Float32Array',
        'Float64Array',
        'Int16Array',
        'Int32Array',
        'Int8Array',
        'Uint16Array',
        'Uint32Array',
        'Uint8Array',
        'Uint8ClampedArray',
      ].includes(name) &&
      args[0]
    ) {
      scanRequestArrayLikePrimitiveValues(
        args[0],
        construct,
        callable,
        context,
        `${name}-array-like`,
        new Set(),
      );
    }
    if ((name === 'Blob' || name === 'File') && args[0]) {
      scanRequestIterableValueProtocols(args[0], 'primitive', construct, callable, context);
    }
    if (name === 'RegExp') {
      if (args[0]) {
        scanRequestProtocolUse(args[0], ['@@match'], construct, callable, context);
        scanRequestProtocolUse(args[0], REQUEST_TO_PRIMITIVE_HOOKS, construct, callable, context);
      }
      if (args[1]) {
        scanRequestProtocolUse(args[1], REQUEST_TO_PRIMITIVE_HOOKS, construct, callable, context);
      }
    }
  }
  if (
    name &&
    ['Map', 'Set', 'WeakMap', 'WeakSet'].includes(name) &&
    unshadowedGlobalIdentifier(callee, name)
  ) {
    const iterable = args[0];
    if (iterable) {
      scanRequestProtocolUse(iterable, ['@@iterator'], construct, callable, context);
      if (name === 'Map' || name === 'WeakMap') {
        scanRequestIterableValueProtocols(iterable, 'entry', construct, callable, context);
      }
    }
    return;
  }
  if (name === 'Promise' || name === 'Proxy') return;
  for (const argument of args) {
    scanRequestProtocolUse(
      argument,
      [...REQUEST_TO_PRIMITIVE_HOOKS, '@@iterator'],
      construct,
      callable,
      context,
    );
  }
}

function scanRequestCallProtocols(
  call: import('ts-morph').CallExpression,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  const rawCallee = unwrapStaticExpression(call.getExpression());
  const rawReceiver = requestCallReceiver(rawCallee);
  const rawMember = requestStaticCallMember(rawCallee);
  const rawArgs = call.getArguments();
  const invocation = requestNormalizedCall(call);
  const callee = unwrapStaticExpression(invocation.target);
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  const args = invocation.args ?? call.getArguments();
  const globalNamespace = receiver ? requestGlobalNamespaceName(receiver) : undefined;

  if (
    (expressionResolvesToGlobalCallable(rawCallee, 'setTimeout', new Set(), 0, false) ||
      expressionResolvesToGlobalCallable(rawCallee, 'setInterval', new Set(), 0, false)) &&
    rawArgs[1]
  ) {
    scanRequestProtocolUse(rawArgs[1], REQUEST_TO_PRIMITIVE_HOOKS, call, callable, context);
  }

  if (rawReceiver && (rawMember === 'apply' || rawMember === 'construct')) {
    const reflect = expressionResolvesToGlobalNamespace(rawReceiver, 'Reflect', new Set(), 0);
    const argumentList = reflect
      ? rawArgs[rawMember === 'apply' ? 2 : 1]
      : rawMember === 'apply'
        ? rawArgs[1]
        : undefined;
    if (argumentList) {
      scanRequestGetterConsumer(
        argumentList,
        call,
        callable,
        context,
        `${reflect ? 'Reflect' : 'Function'}.${rawMember}-arguments`,
      );
    }
  }
  if (rawReceiver && expressionResolvesToGlobalNamespace(rawReceiver, 'Reflect', new Set(), 0)) {
    if (rawMember === 'set' && rawArgs[3]) {
      scanRequestGetterConsumer(rawArgs[3], call, callable, context, 'Reflect.set-receiver');
    }
    if (rawMember === 'construct' && rawArgs[2]) {
      scanRequestGetterConsumer(rawArgs[2], call, callable, context, 'Reflect.construct-newTarget');
    }
  }

  if (globalNamespace && member) {
    for (const argument of args) scanRequestProxyUse(argument, call, context);
    if (
      ['BigInt', 'Buffer', 'Date', 'Math', 'Number', 'String', 'Symbol', 'URL'].includes(
        globalNamespace,
      )
    ) {
      for (const argument of args) {
        scanRequestProtocolUse(argument, REQUEST_TO_PRIMITIVE_HOOKS, call, callable, context);
      }
    }
    if (globalNamespace === 'Buffer' && ['concat', 'from'].includes(member) && args[0]) {
      scanRequestProtocolUse(args[0], ['@@iterator'], call, callable, context);
      if (member === 'from') {
        scanRequestArrayLikePrimitiveValues(
          args[0],
          call,
          callable,
          context,
          'Buffer.from-array-like',
          new Set(),
        );
      } else if (!requestIterationIsStaticallyHandled(args[0], callable, context, false)) {
        scanRequestGetterConsumer(args[0], call, callable, context, 'Buffer.concat-getters');
      }
    }
    if (globalNamespace === 'String' && member === 'raw' && args[0]) {
      scanRequestSerializationProtocols(args[0], call, callable, context, new Set());
      const rawCandidates = requestGetterOutputExpressions(args[0], 'raw', new Set());
      const projected = requestWireProjectedExpression(args[0], ['raw'], new Set(), 0);
      if (projected) rawCandidates.push(projected);
      if (rawCandidates.length === 0) {
        appendRequestProtocolFact(context, call, 'String.raw-segments', args[0]);
      }
      for (const raw of rawCandidates) {
        scanRequestArrayLikePrimitiveValues(
          raw,
          call,
          callable,
          context,
          'String.raw-segments',
          new Set(),
        );
      }
    }
    if (globalNamespace === 'crypto' && member === 'randomUUID' && args[0]) {
      scanRequestGetterConsumer(args[0], call, callable, context, 'crypto.randomUUID-options');
    }
    if (globalNamespace === 'JSON') {
      if (member === 'parse' && args[0]) {
        scanRequestProtocolUse(args[0], REQUEST_TO_PRIMITIVE_HOOKS, call, callable, context);
      }
      if (member === 'stringify' && args[1]) {
        scanRequestGetterConsumer(args[1], call, callable, context, 'JSON.stringify-replacer');
        if (requestIterationIsStaticallyHandled(args[1], callable, context, false)) {
          scanRequestArrayLikePrimitiveValues(
            args[1],
            call,
            callable,
            context,
            'JSON.stringify-replacer-elements',
            new Set(),
          );
        }
      }
      if (member === 'stringify' && args[2]) {
        scanRequestProtocolUse(args[2], REQUEST_TO_PRIMITIVE_HOOKS, call, callable, context);
      }
    }
    if (globalNamespace === 'Response' && member === 'redirect') {
      for (const argument of args) {
        scanRequestProtocolUse(argument, REQUEST_TO_PRIMITIVE_HOOKS, call, callable, context);
      }
    }
  }

  if (
    Node.isIdentifier(callee) &&
    [
      'BigInt',
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
    ].includes(callee.getText()) &&
    unshadowedGlobalIdentifier(callee, callee.getText())
  ) {
    for (const argument of args) {
      scanRequestProtocolUse(argument, REQUEST_TO_PRIMITIVE_HOOKS, call, callable, context);
    }
  }

  const stringHook =
    member === 'replace' || member === 'replaceAll'
      ? '@@replace'
      : member === 'match'
        ? '@@match'
        : member === 'matchAll'
          ? '@@matchAll'
          : member === 'search'
            ? '@@search'
            : member === 'split'
              ? '@@split'
              : undefined;
  if (stringHook && args[0]) {
    scanRequestProtocolUse(args[0], [stringHook], call, callable, context);
  }

  if (member === 'concat' && receiver) {
    for (const candidate of [receiver, ...args]) {
      scanRequestProtocolUse(candidate, ['@@isConcatSpreadable'], call, callable, context);
      scanRequestGetterConsumer(candidate, call, callable, context, 'Array.concat-index-getters');
    }
    scanRequestProtocolUse(receiver, ['@@species'], call, callable, context);
  }

  if (
    receiver &&
    ['concat', 'filter', 'flat', 'flatMap', 'map', 'slice', 'splice'].includes(member ?? '')
  ) {
    scanRequestProtocolUse(receiver, ['@@species'], call, callable, context);
  }

  if (
    receiver &&
    (expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) ||
      expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0))
  ) {
    const namespace = expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0)
      ? 'Object'
      : 'Reflect';
    const target = args[0];
    if (target) scanRequestProxyUse(target, call, context);
    const consumesTargetInternalMethods =
      !!member &&
      (namespace === 'Reflect'
        ? [
            'apply',
            'construct',
            'defineProperty',
            'deleteProperty',
            'get',
            'getOwnPropertyDescriptor',
            'getPrototypeOf',
            'has',
            'isExtensible',
            'ownKeys',
            'preventExtensions',
            'set',
            'setPrototypeOf',
          ].includes(member)
        : [
            'assign',
            'defineProperties',
            'defineProperty',
            'entries',
            'freeze',
            'getOwnPropertyDescriptor',
            'getOwnPropertyDescriptors',
            'getOwnPropertyNames',
            'getOwnPropertySymbols',
            'getPrototypeOf',
            'hasOwn',
            'isExtensible',
            'isFrozen',
            'isSealed',
            'keys',
            'preventExtensions',
            'seal',
            'setPrototypeOf',
            'values',
          ].includes(member));
    if (target && consumesTargetInternalMethods) {
      scanRequestOpaqueInternalMethodTarget(
        target,
        call,
        callable,
        context,
        `${namespace}.${member}-target`,
      );
    }
    if (member && ['assign', 'create', 'defineProperties', 'setPrototypeOf'].includes(member)) {
      for (const candidate of args.slice(1)) scanRequestProxyUse(candidate, call, context);
    }
    if (
      expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
      member === 'assign'
    ) {
      if (args[0]) {
        scanRequestGetterConsumer(args[0], call, callable, context, 'Object.assign-target-setters');
      }
      for (const source of args.slice(1)) {
        scanRequestGetterConsumer(source, call, callable, context, 'Object.assign-source-getters');
      }
    }
    if (
      expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
      member &&
      ['entries', 'values'].includes(member) &&
      args[0]
    ) {
      scanRequestGetterConsumer(args[0], call, callable, context, `Object.${member}-getters`);
    }
    if (member && ['create', 'defineProperties', 'defineProperty'].includes(member)) {
      for (const descriptor of args.slice(member === 'defineProperty' ? 2 : 1)) {
        scanRequestGetterConsumer(
          descriptor,
          call,
          callable,
          context,
          `${member}-descriptor-getters`,
        );
      }
    }
    if (
      namespace === 'Object' &&
      (member === 'create' || member === 'defineProperties') &&
      args[1]
    ) {
      scanRequestDescriptorMap(args[1], call, callable, context, new Set());
    }
    if (
      member &&
      [
        'defineProperty',
        'deleteProperty',
        'get',
        'getOwnPropertyDescriptor',
        'has',
        'hasOwn',
        'set',
      ].includes(member) &&
      args[1]
    ) {
      scanRequestProtocolUse(args[1], REQUEST_TO_PRIMITIVE_HOOKS, call, callable, context);
    }
  }

  if (
    receiver &&
    ((expressionResolvesToGlobalNamespace(receiver, 'JSON', new Set(), 0) &&
      member === 'stringify') ||
      (expressionResolvesToGlobalNamespace(receiver, 'Response', new Set(), 0) &&
        member === 'json')) &&
    args[0]
  ) {
    scanRequestSerializationProtocols(args[0], call, callable, context, new Set());
    const init = args[1];
    if (init && expressionResolvesToGlobalNamespace(receiver, 'Response', new Set(), 0)) {
      scanRequestRecordPrimitiveValues(
        init,
        call,
        callable,
        context,
        'Response.json-init-values',
        new Set(),
      );
    }
  }

  if (receiver && requestExpressionIsSafeBuiltinCapability(receiver, new Set(), 0)) {
    for (const argument of args) scanRequestProxyUse(argument, call, context);
  }

  const consumesIterable = !!(
    receiver &&
    member &&
    ((expressionResolvesToGlobalNamespace(receiver, 'Array', new Set(), 0) &&
      (member === 'from' || member === 'fromAsync')) ||
      (expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
        (member === 'fromEntries' || member === 'groupBy')) ||
      (expressionResolvesToGlobalNamespace(receiver, 'Promise', new Set(), 0) &&
        ['all', 'allSettled', 'any', 'race'].includes(member)))
  );
  if (consumesIterable && args[0]) {
    scanRequestProtocolUse(
      args[0],
      member === 'fromAsync' ? ['@@asyncIterator', '@@iterator'] : ['@@iterator'],
      call,
      callable,
      context,
    );
    if (member === 'fromEntries') {
      scanRequestIterableValueProtocols(args[0], 'entry', call, callable, context);
    } else if (member === 'fromAsync') {
      scanRequestIterableValueProtocols(args[0], 'thenable', call, callable, context);
    }
    if (member === 'from' || member === 'fromAsync') {
      if (
        !requestIterationIsStaticallyHandled(args[0], callable, context, member === 'fromAsync')
      ) {
        scanRequestGetterConsumer(args[0], call, callable, context, `Array.${member}-getters`);
      }
    }
  }

  if (
    receiver &&
    expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
    member === 'groupBy' &&
    args[1]
  ) {
    for (const callback of resolveRequestCallable(args[1], new Set(), 0, context.provenance)
      .callables) {
      for (const output of requestWireOutputExpressions(callback)) {
        scanRequestProtocolUse(output, REQUEST_TO_PRIMITIVE_HOOKS, call, callback, context);
      }
    }
  }

  if (rawMember === 'sort' || rawMember === 'toSorted') {
    scanRequestCallbackOutputProtocols(call, [0], 'primitive', callable, context);
  }
  if (rawMember === 'flatMap') {
    scanRequestCallbackOutputProtocols(call, [0], 'getter', callable, context);
  }
  if (rawMember === 'replace' || rawMember === 'replaceAll') {
    scanRequestCallbackOutputProtocols(call, [1], 'primitive', callable, context);
  }
  if (globalNamespace === 'JSON' && member === 'stringify') {
    scanRequestCallbackOutputProtocols(call, [1], 'serialization', callable, context);
  }
  if (
    (globalNamespace === 'Promise' && member === 'try') ||
    (globalNamespace === 'Array' && member === 'fromAsync')
  ) {
    scanRequestCallbackOutputProtocols(
      call,
      [globalNamespace === 'Promise' ? 0 : 1],
      'thenable',
      callable,
      context,
    );
  }
  if (
    rawReceiver &&
    rawMember &&
    ['then', 'catch', 'finally'].includes(rawMember) &&
    requestExpressionIsExactNativePromise(rawReceiver, new Set(), context.provenance)
  ) {
    scanRequestCallbackOutputProtocols(
      call,
      REQUEST_CALLBACK_ARGUMENTS.get(rawMember) ?? [],
      'thenable',
      callable,
      context,
    );
  }

  if (
    receiver &&
    member &&
    expressionResolvesToGlobalNamespace(receiver, 'Promise', new Set(), 0)
  ) {
    if (member === 'resolve' && args[0]) {
      scanRequestProtocolUse(args[0], ['then'], call, callable, context);
    }
    if (['all', 'allSettled', 'any', 'race'].includes(member) && args[0]) {
      const values = requestStaticPromiseAssimilationValues(args[0], new Set());
      if (!values) {
        appendRequestProtocolFact(context, call, 'promise-iterable-elements', args[0]);
      } else {
        for (const value of values) {
          scanRequestProtocolUse(value, ['then'], call, callable, context);
        }
      }
    }
  }
}

function scanRequestCallbackOutputProtocols(
  call: import('ts-morph').CallExpression,
  indexes: readonly number[],
  kind: 'getter' | 'primitive' | 'serialization' | 'thenable',
  caller: RequestCallable,
  context: RequestProcessScanContext,
): void {
  for (const index of indexes) {
    const callback = call.getArguments()[index];
    if (!callback) continue;
    for (const nested of resolveRequestCallable(callback, new Set(), 0, context.provenance)
      .callables) {
      scanRequestCallable(nested, context);
      for (const output of requestWireOutputExpressions(nested)) {
        if (kind === 'getter') {
          scanRequestGetterConsumer(output, call, nested, context, 'callback-result-getters');
        } else if (kind === 'primitive') {
          scanRequestProtocolUse(output, REQUEST_TO_PRIMITIVE_HOOKS, call, nested, context);
        } else if (kind === 'serialization') {
          scanRequestSerializationProtocols(output, call, nested, context, new Set());
        } else {
          scanRequestThenableCallbackOutput(output, call, nested, caller, context);
        }
      }
    }
  }
}

function scanRequestThenableCallbackOutput(
  output: Node,
  site: Node,
  callback: RequestCallable,
  caller: RequestCallable,
  context: RequestProcessScanContext,
): void {
  if (scanRequestProxyUse(output, site, context)) return;
  const thenCallables = requestAccessorCallablesForExpression(
    output,
    'then',
    new Set(),
    context.provenance,
  );
  for (const then of thenCallables) {
    context.provenance.promiseSettlementCallables.add(requestNodeIdentity(then.declaration));
    scanRequestCallable(then, context);
  }
  if (thenCallables.length > 0) return;
  if (
    requestExpressionIsProtocolSafe(output, callback, new Set(), context.provenance) ||
    requestExpressionIsPlainWireValue(
      output,
      {
        bindingKey: 'callback-thenable',
        bindings: new Map(),
        rootCallable: caller,
        scopeCallable: callback,
        session: context.provenance,
      },
      new Set(),
    )
  ) {
    return;
  }
  const node = unwrapStaticExpression(output);
  if (
    Node.isIdentifier(node) &&
    node
      .getSymbol()
      ?.getDeclarations()
      .some((declaration) => Node.isParameterDeclaration(declaration))
  ) {
    return;
  }
  appendRequestProtocolFact(context, site, 'callback-thenable-result', output);
}

function scanRequestAllAuthoredAccessors(
  expression: Node,
  context: RequestProcessScanContext,
): number {
  const accessors = dedupeRequestCallables(
    requestAccessorCallablesForExpression(expression, undefined, new Set(), context.provenance),
  );
  for (const accessor of accessors) {
    scanRequestCallable(accessor, context);
  }
  return accessors.length;
}

function scanRequestGetterConsumer(
  expression: Node,
  site: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
  protocol: string,
): void {
  const proxy = scanRequestProxyUse(expression, site, context);
  scanRequestAllAuthoredAccessors(expression, context);
  if (
    proxy ||
    (protocol === 'jsx-spread-getters' &&
      requestCallIsReviewedPublicJsxAttributeHelper(expression)) ||
    requestExpressionIsProtocolSafe(expression, callable, new Set(), context.provenance)
  ) {
    return;
  }
  appendRequestProtocolFact(context, site, protocol, expression);
}

function scanRequestIterableValueProtocols(
  iterable: Node,
  kind: 'entry' | 'locale-string' | 'primitive' | 'string-entry' | 'thenable',
  site: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  const state: RequestWireAnalysisState = {
    bindingKey: 'process-iteration',
    bindings: new Map(),
    rootCallable: callable,
    scopeCallable: callable,
    session: context.provenance,
  };
  const iteration = requestWireIterationValues(iterable, state, new Set(), kind === 'thenable');
  if (!iteration.handled) {
    appendRequestProtocolFact(
      context,
      site,
      kind === 'thenable' ? 'iterator-thenable' : `iterator-${kind}`,
      iterable,
    );
    return;
  }
  for (const candidate of iteration.candidates) {
    if (kind === 'thenable') {
      scanRequestProtocolUse(candidate.expression, ['then'], site, callable, context);
      continue;
    }
    if (kind === 'locale-string') {
      scanRequestProtocolUse(candidate.expression, ['toLocaleString'], site, callable, context);
      continue;
    }
    if (kind === 'primitive') {
      scanRequestProtocolUse(
        candidate.expression,
        REQUEST_TO_PRIMITIVE_HOOKS,
        site,
        callable,
        context,
      );
      continue;
    }
    scanRequestProxyUse(candidate.expression, site, context);
    scanRequestGetterCallables(candidate.expression, '0', context);
    scanRequestGetterCallables(candidate.expression, '1', context);
    for (const member of kind === 'string-entry' ? ['0', '1'] : ['0']) {
      const projected = requestWireProjectedExpression(
        candidate.expression,
        [member],
        new Set(),
        0,
      );
      for (const entryValue of [
        ...requestGetterOutputExpressions(candidate.expression, member, new Set()),
        ...(projected ? [projected] : []),
      ]) {
        scanRequestProtocolUse(entryValue, REQUEST_TO_PRIMITIVE_HOOKS, site, callable, context);
      }
    }
  }
}

function requestIterationIsStaticallyHandled(
  iterable: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
  asyncIteration: boolean,
): boolean {
  const state: RequestWireAnalysisState = {
    bindingKey: 'process-iteration-check',
    bindings: new Map(),
    rootCallable: callable,
    scopeCallable: callable,
    session: context.provenance,
  };
  return requestWireIterationValues(iterable, state, new Set(), asyncIteration).handled;
}

function scanRequestArrayLikePrimitiveValues(
  expression: Node,
  site: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
  protocol: string,
  seen: Set<string>,
): void {
  const node = unwrapStaticExpression(expression);
  const key = `array-like-primitive:${requestNodeIdentity(node)}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (requestIterationIsStaticallyHandled(node, callable, context, false)) {
    scanRequestIterableValueProtocols(node, 'primitive', site, callable, context);
    return;
  }
  scanRequestGetterConsumer(node, site, callable, context, protocol);
  if (Node.isObjectLiteralExpression(node)) {
    for (const property of node.getProperties()) {
      if (staticMemberName(requestObjectLiteralElementNameNode(property)) === 'length') continue;
      const value = requestHandlerPropertyExpression(property);
      if (value) {
        scanRequestProtocolUse(value, REQUEST_TO_PRIMITIVE_HOOKS, site, callable, context);
      }
    }
    return;
  }
  if (!Node.isIdentifier(node)) return;
  const symbol = node.getSymbol();
  if (!symbol) return;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return;
  seen.add(symbolKey);
  for (const declaration of symbol.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (initializer) {
      scanRequestArrayLikePrimitiveValues(
        initializer,
        site,
        callable,
        context,
        protocol,
        new Set(seen),
      );
    }
  }
  for (const assigned of requestAssignedBindingProjections(symbol, context.provenance)) {
    scanRequestProtocolUse(
      assigned.expression,
      REQUEST_TO_PRIMITIVE_HOOKS,
      site,
      callable,
      context,
    );
  }
}

function scanRequestRecordPrimitiveValues(
  expression: Node,
  site: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
  protocol: string,
  seen: Set<string>,
): void {
  const node = unwrapStaticExpression(expression);
  const key = `record-primitive:${requestNodeIdentity(node)}`;
  if (seen.has(key)) return;
  seen.add(key);
  scanRequestGetterConsumer(node, site, callable, context, protocol);
  if (Node.isConditionalExpression(node)) {
    scanRequestRecordPrimitiveValues(
      node.getWhenTrue(),
      site,
      callable,
      context,
      protocol,
      new Set(seen),
    );
    scanRequestRecordPrimitiveValues(
      node.getWhenFalse(),
      site,
      callable,
      context,
      protocol,
      new Set(seen),
    );
    return;
  }
  if (Node.isObjectLiteralExpression(node)) {
    for (const property of node.getProperties()) {
      const member = staticMemberName(requestObjectLiteralElementNameNode(property));
      const value = requestHandlerPropertyExpression(property);
      if (!value) continue;
      if (member === 'headers') {
        if (requestIterationIsStaticallyHandled(value, callable, context, false)) {
          scanRequestIterableValueProtocols(value, 'string-entry', site, callable, context);
        } else {
          scanRequestRecordPrimitiveValues(
            value,
            site,
            callable,
            context,
            `${protocol}-headers`,
            new Set(seen),
          );
        }
      } else {
        scanRequestProtocolUse(value, REQUEST_TO_PRIMITIVE_HOOKS, site, callable, context);
      }
    }
    return;
  }
  if (!Node.isIdentifier(node)) return;
  const symbol = node.getSymbol();
  if (!symbol) return;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return;
  seen.add(symbolKey);
  for (const declaration of symbol.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (initializer) {
      scanRequestRecordPrimitiveValues(
        initializer,
        site,
        callable,
        context,
        protocol,
        new Set(seen),
      );
    }
  }
}

function scanRequestDescriptorMap(
  expression: Node,
  site: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
  seen: Set<string>,
): void {
  const node = unwrapStaticExpression(expression);
  const key = `descriptor-map:${requestNodeIdentity(node)}`;
  if (seen.has(key)) return;
  seen.add(key);
  scanRequestGetterConsumer(node, site, callable, context, 'descriptor-map-getters');
  if (Node.isConditionalExpression(node)) {
    scanRequestDescriptorMap(node.getWhenTrue(), site, callable, context, new Set(seen));
    scanRequestDescriptorMap(node.getWhenFalse(), site, callable, context, new Set(seen));
    return;
  }
  if (Node.isObjectLiteralExpression(node)) {
    for (const property of node.getProperties()) {
      const descriptor = requestHandlerPropertyExpression(property);
      if (descriptor) {
        scanRequestGetterConsumer(
          descriptor,
          site,
          callable,
          context,
          'property-descriptor-getters',
        );
      }
    }
    return;
  }
  if (!Node.isIdentifier(node)) return;
  const symbol = node.getSymbol();
  if (!symbol) return;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return;
  seen.add(symbolKey);
  for (const declaration of symbol.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (initializer) {
      scanRequestDescriptorMap(initializer, site, callable, context, new Set(seen));
    }
  }
}

function scanRequestSerializationProtocols(
  expression: Node,
  site: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
  seen: Set<string>,
): void {
  const node = unwrapStaticExpression(expression);
  const key = `serialization:${requestNodeIdentity(node)}`;
  if (seen.has(key) || !requestProvenanceStep(context.provenance, node)) return;
  seen.add(key);
  if (scanRequestProxyUse(node, site, context)) return;
  let reviewedTransform = false;

  if (Node.isObjectLiteralExpression(node)) {
    for (const property of node.getProperties()) {
      if (Node.isGetAccessorDeclaration(property)) {
        const nested = requestCallableForFunctionNode(property);
        if (nested) scanRequestCallable(nested, context);
        continue;
      }
      if (
        Node.isMethodDeclaration(property) &&
        requestCallableMemberName(property.getNameNode()) === 'toJSON'
      ) {
        const nested = requestCallableForFunctionNode(property);
        if (nested) scanRequestCallable(nested, context);
        continue;
      }
      const value = requestHandlerPropertyExpression(property);
      if (value) {
        scanRequestSerializationProtocols(value, site, callable, context, new Set(seen));
      }
    }
    return;
  }
  if (Node.isArrayLiteralExpression(node)) {
    for (const element of node.getElements()) {
      if (Node.isOmittedExpression(element)) continue;
      scanRequestSerializationProtocols(
        Node.isSpreadElement(element) ? element.getExpression() : element,
        site,
        callable,
        context,
        new Set(seen),
      );
    }
    return;
  }
  if (Node.isConditionalExpression(node)) {
    scanRequestSerializationProtocols(node.getWhenTrue(), site, callable, context, new Set(seen));
    scanRequestSerializationProtocols(node.getWhenFalse(), site, callable, context, new Set(seen));
    return;
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    if (
      receiver &&
      member &&
      ['filter', 'map'].includes(member) &&
      requestLocalIntrinsicContainerKind(receiver, callable, context, new Set()) === 'array' &&
      requestLocalIntrinsicContainerIsPristine(
        receiver,
        node,
        REQUEST_REVIEWED_LOCAL_ARRAY_METHODS,
        callable,
        context,
      )
    ) {
      reviewedTransform = true;
      scanRequestSerializationProtocols(receiver, site, callable, context, new Set(seen));
      if (member === 'map') {
        const callback = node.getArguments()[0];
        if (callback) {
          for (const nested of resolveRequestCallable(callback, new Set(), 0, context.provenance)
            .callables) {
            scanRequestCallable(nested, context);
            for (const output of requestWireOutputExpressions(nested)) {
              scanRequestSerializationProtocols(output, site, nested, context, new Set(seen));
            }
          }
        }
      }
    }
    for (const nested of resolveRequestCallable(
      node.getExpression(),
      new Set(),
      0,
      context.provenance,
    ).callables) {
      for (const output of requestWireOutputExpressions(nested)) {
        scanRequestSerializationProtocols(output, site, callable, context, new Set(seen));
      }
    }
  }
  const toJSONCallables = requestAccessorCallablesForExpression(
    node,
    'toJSON',
    new Set(),
    context.provenance,
  );
  for (const toJSON of toJSONCallables) {
    scanRequestCallable(toJSON, context);
    for (const output of requestWireOutputExpressions(toJSON)) {
      scanRequestSerializationProtocols(output, site, callable, context, new Set(seen));
    }
  }
  if (Node.isIdentifier(node)) {
    const symbol = requestIdentifierValueSymbol(node);
    if (symbol) {
      const symbolKey = requestSymbolKey(symbol);
      if (seen.has(symbolKey)) return;
      seen.add(symbolKey);
      for (const declaration of symbol.getDeclarations()) {
        const initializer = valueDeclarationInitializer(declaration);
        if (initializer) {
          scanRequestSerializationProtocols(initializer, site, callable, context, new Set(seen));
        }
      }
      for (const assigned of requestAssignedBindingProjections(symbol, context.provenance)) {
        scanRequestSerializationProtocols(
          assigned.expression,
          site,
          callable,
          context,
          new Set(seen),
        );
      }
      scanRequestSerializationMutationsForSymbol(symbol, symbolKey, site, callable, context, seen);
    }
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      scanRequestSerializationProtocols(initializer, site, callable, context, new Set(seen));
    }
  }

  if (
    toJSONCallables.length === 0 &&
    !reviewedTransform &&
    !requestExpressionIsReviewedSerializationCarrier(node, callable, context, new Set()) &&
    !requestExpressionIsProtocolSafe(node, callable, new Set(), context.provenance) &&
    !requestExpressionIsPlainWireValue(
      node,
      {
        bindingKey: 'serialization-plain',
        bindings: new Map(),
        rootCallable: callable,
        scopeCallable: callable,
        session: context.provenance,
      },
      new Set(),
    )
  ) {
    appendRequestProtocolFact(context, site, 'serialization-getters', node);
  }
}

function requestExpressionIsReviewedSerializationCarrier(
  expression: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
  seen: Set<string>,
): boolean {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `serialization-carrier:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey)) return false;
  seen.add(nodeKey);
  if (Node.isConditionalExpression(node)) {
    return (
      requestExpressionIsReviewedSerializationCarrier(
        node.getWhenTrue(),
        callable,
        context,
        new Set(seen),
      ) &&
      requestExpressionIsReviewedSerializationCarrier(
        node.getWhenFalse(),
        callable,
        context,
        new Set(seen),
      )
    );
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    return !!(
      receiver &&
      member &&
      ['filter', 'map'].includes(member) &&
      requestLocalIntrinsicContainerKind(receiver, callable, context, new Set()) === 'array' &&
      requestLocalIntrinsicContainerIsPristine(
        receiver,
        node,
        REQUEST_REVIEWED_LOCAL_ARRAY_METHODS,
        callable,
        context,
      )
    );
  }
  if (!Node.isIdentifier(node)) return false;
  const declaration = localValueDeclaration(node);
  const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
  if (initializer) {
    return requestExpressionIsReviewedSerializationCarrier(
      initializer,
      callable,
      context,
      new Set(seen),
    );
  }
  const symbol = requestIdentifierValueSymbol(node);
  if (!symbol) return false;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return false;
  seen.add(symbolKey);
  const initializers = symbol
    .getDeclarations()
    .map(valueDeclarationInitializer)
    .filter((initializer): initializer is Node => initializer !== undefined);
  return (
    initializers.length > 0 &&
    initializers.every((initializer) =>
      requestExpressionIsReviewedSerializationCarrier(
        initializer,
        callable,
        context,
        new Set(seen),
      ),
    )
  );
}

function scanRequestSerializationMutationsForSymbol(
  symbol: NonNullable<ReturnType<Node['getSymbol']>>,
  symbolKey: string,
  site: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
  seen: Set<string>,
): void {
  const sourceFiles = new Set(
    symbol.getDeclarations().map((declaration) => declaration.getSourceFile()),
  );
  for (const sourceFile of sourceFiles) {
    for (const invocation of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = unwrapStaticExpression(invocation.getExpression());
      const receiver = requestCallReceiver(callee);
      const member = requestStaticCallMember(callee);
      const args = invocation.getArguments();
      if (!receiver || !member) continue;
      if (requestWireExpressionResolvesToSymbol(receiver, symbolKey, new Set(), 0)) {
        const values =
          member === 'splice'
            ? args.slice(2)
            : member === 'fill'
              ? args.slice(0, 1)
              : ['push', 'unshift'].includes(member)
                ? args
                : [];
        for (const value of values) {
          scanRequestSerializationProtocols(value, site, callable, context, new Set(seen));
        }
      }
      const objectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0);
      const reflectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0);
      const target = args[0];
      if (!target || !requestWireExpressionResolvesToSymbol(target, symbolKey, new Set(), 0)) {
        continue;
      }
      if (objectGlobal && member === 'assign') {
        for (const source of args.slice(1)) {
          scanRequestSerializationProtocols(source, site, callable, context, new Set(seen));
        }
      } else if ((objectGlobal || reflectGlobal) && member === 'defineProperty') {
        const descriptor = args[2];
        if (descriptor) {
          scanRequestAllAuthoredAccessors(descriptor, context);
          const value = requestStaticDescriptorValue(descriptor);
          if (value) {
            scanRequestSerializationProtocols(value, site, callable, context, new Set(seen));
          }
        }
      } else if (objectGlobal && member === 'defineProperties') {
        const descriptors = args[1];
        if (descriptors) scanRequestAllAuthoredAccessors(descriptors, context);
      } else if (reflectGlobal && member === 'set' && args[2]) {
        scanRequestSerializationProtocols(args[2], site, callable, context, new Set(seen));
      }
    }
  }
}

function requestStaticPromiseAssimilationValues(
  expression: Node,
  seen: Set<string>,
): Node[] | undefined {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `promise-values:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey)) return undefined;
  seen.add(nodeKey);
  if (Node.isArrayLiteralExpression(node)) {
    const values: Node[] = [];
    for (const element of node.getElements()) {
      if (Node.isOmittedExpression(element)) continue;
      if (!Node.isSpreadElement(element)) {
        values.push(element);
        continue;
      }
      const spread = requestStaticPromiseAssimilationValues(element.getExpression(), new Set(seen));
      if (!spread) return undefined;
      values.push(...spread);
    }
    return values;
  }
  if (Node.isConditionalExpression(node)) {
    const whenTrue = requestStaticPromiseAssimilationValues(node.getWhenTrue(), new Set(seen));
    const whenFalse = requestStaticPromiseAssimilationValues(node.getWhenFalse(), new Set(seen));
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
  }
  if (!Node.isIdentifier(node)) return undefined;
  const symbol = node.getSymbol();
  if (!symbol) return undefined;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return undefined;
  seen.add(symbolKey);
  const initializers = symbol
    .getDeclarations()
    .map(valueDeclarationInitializer)
    .filter((initializer): initializer is Node => initializer !== undefined);
  if (initializers.length === 0) return undefined;
  const values = initializers.map((initializer) =>
    requestStaticPromiseAssimilationValues(initializer, new Set(seen)),
  );
  return values.every((value): value is Node[] => value !== undefined) ? values.flat() : undefined;
}

function scanRequestTaggedTemplate(
  tagged: import('ts-morph').TaggedTemplateExpression,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  const tag = tagged.getTag();
  const resolution = resolveRequestCallable(tag, new Set(), 0, context.provenance);
  for (const nested of resolution.callables) scanRequestCallable(nested, context);
  const safeStringRaw =
    Node.isPropertyAccessExpression(tag) &&
    tag.getName() === 'raw' &&
    expressionResolvesToGlobalNamespace(tag.getExpression(), 'String', new Set(), 0);
  if (resolution.callables.length === 0 && !safeStringRaw) {
    appendRequestProtocolFact(context, tagged, 'tagged-template', tag);
  }
  const template = tagged.getTemplate();
  if (Node.isTemplateExpression(template)) {
    for (const span of template.getTemplateSpans()) {
      scanRequestProtocolUse(
        span.getExpression(),
        REQUEST_TO_PRIMITIVE_HOOKS,
        tagged,
        callable,
        context,
      );
    }
  }
}

function scanRequestArrayDestructuringProtocol(
  pattern: Node,
  source: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  const node = unwrapStaticExpression(pattern);
  if (Node.isArrayBindingPattern(node) || Node.isArrayLiteralExpression(node)) {
    scanRequestProtocolUse(source, ['@@iterator'], node, callable, context);
  }
}

function scanRequestAssignmentTargetProtocols(
  target: Node,
  site: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
  readBeforeWrite: boolean,
): void {
  const node = unwrapStaticExpression(target);
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    scanRequestPropertyAccessProtocols(node, site, callable, context, true);
    if (readBeforeWrite) {
      scanRequestProtocolUse(node, REQUEST_TO_PRIMITIVE_HOOKS, site, callable, context);
    }
    return;
  }
  if (
    Node.isBinaryExpression(node) &&
    node.getOperatorToken().getKind() === SyntaxKind.EqualsToken
  ) {
    scanRequestAssignmentTargetProtocols(node.getLeft(), site, callable, context, readBeforeWrite);
    return;
  }
  if (Node.isArrayLiteralExpression(node)) {
    for (const element of node.getElements()) {
      if (Node.isOmittedExpression(element)) continue;
      scanRequestAssignmentTargetProtocols(
        Node.isSpreadElement(element) ? element.getExpression() : element,
        site,
        callable,
        context,
        false,
      );
    }
    return;
  }
  if (Node.isObjectLiteralExpression(node)) {
    for (const property of node.getProperties()) {
      const nested = requestHandlerPropertyExpression(property);
      if (nested) {
        scanRequestAssignmentTargetProtocols(nested, site, callable, context, false);
      }
    }
  }
}

function requestPropertyAccessIsDirectInvocationTarget(access: Node): boolean {
  let node = access;
  while (
    Node.isParenthesizedExpression(node.getParent()) ||
    Node.isAsExpression(node.getParent()) ||
    Node.isSatisfiesExpression(node.getParent())
  ) {
    node = node.getParent()!;
  }
  const parent = node.getParent();
  return !!(
    (Node.isCallExpression(parent) || Node.isNewExpression(parent)) &&
    requestNodesAreSame(parent.getExpression(), node)
  );
}

function scanRequestPropertyAccessProtocols(
  access: import('ts-morph').PropertyAccessExpression | import('ts-morph').ElementAccessExpression,
  site: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
  write: boolean,
): void {
  const receiver = unwrapStaticExpression(access.getExpression());
  const member = Node.isPropertyAccessExpression(access)
    ? access.getName()
    : staticMemberName(access.getArgumentExpression());
  if (
    !write &&
    member !== undefined &&
    requestPropertyAccessIsReviewedDrizzleColumn(access, member, callable, context)
  ) {
    return;
  }
  if (receiver.getKind() === SyntaxKind.SuperKeyword) {
    scanRequestSuperPropertyAccess(access, member, site, callable, context, write);
    return;
  }
  // The starter renders the three reviewed UI descriptors through their frozen public
  // `definition.render` entrypoint. Suppress only the exact, pristine call chain; local/bare
  // lookalikes and any same- or cross-module member replacement stay opaque.
  if (requestPropertyAccessBelongsToReviewedPublicUiRenderCall(access)) return;
  if (scanRequestProxyUse(receiver, site, context)) return;
  const accessors = write
    ? requestAccessorCallablesForExpression(receiver, member, new Set(), context.provenance)
    : requestGetterCallablesForExpression(receiver, member, new Set(), context.provenance);
  for (const accessor of dedupeRequestCallables(accessors)) {
    scanRequestCallable(accessor, context);
  }
  for (const prototype of requestPrototypeSourcesForExpression(
    receiver,
    new Set(),
    context.provenance,
  )) {
    const inherited = write
      ? requestAccessorCallablesForExpression(prototype, member, new Set(), context.provenance)
      : requestGetterCallablesForExpression(prototype, member, new Set(), context.provenance);
    for (const accessor of dedupeRequestCallables(inherited)) {
      scanRequestCallable(accessor, context);
    }
    scanRequestOpaqueInternalMethodTarget(
      prototype,
      site,
      callable,
      context,
      write ? 'prototype-setter' : 'prototype-getter',
    );
  }
  scanRequestOpaqueInternalMethodTarget(
    receiver,
    site,
    callable,
    context,
    write ? 'property-setter' : 'property-getter',
  );
}

function requestPrototypeSourcesForExpression(
  expression: Node,
  seen: Set<string>,
  session: RequestProvenanceSession,
): Node[] {
  const node = unwrapStaticExpression(expression);
  const nodeKey = requestNodeIdentity(node);
  const memoized = session.prototypeSourceMemo.get(nodeKey);
  if (memoized) return [...memoized];
  const seenKey = `prototype-source:${nodeKey}`;
  if (
    seen.has(seenKey) ||
    session.prototypeSourceActive.has(nodeKey) ||
    !requestProvenanceStep(session, node)
  ) {
    return [];
  }
  seen.add(seenKey);
  session.prototypeSourceActive.add(nodeKey);
  const result = requestPrototypeSourcesForExpressionUncached(node, seen, session);
  session.prototypeSourceActive.delete(nodeKey);
  session.prototypeSourceMemo.set(nodeKey, result);
  return [...result];
}

function requestPrototypeSourcesForExpressionUncached(
  node: Node,
  seen: Set<string>,
  session: RequestProvenanceSession,
): Node[] {
  const sources: Node[] = [];
  if (Node.isConditionalExpression(node)) {
    return dedupeRequestNodes(
      [node.getWhenTrue(), node.getWhenFalse()].flatMap((branch) =>
        requestPrototypeSourcesForExpression(branch, new Set(seen), session),
      ),
    );
  }
  if (Node.isObjectLiteralExpression(node)) {
    for (const property of node.getProperties()) {
      if (
        requestCallableMemberName(requestObjectLiteralElementNameNode(property)) !== '__proto__'
      ) {
        continue;
      }
      const source = requestHandlerPropertyExpression(property);
      if (source) sources.push(source);
    }
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    const [target, prototype] = node.getArguments();
    if (
      receiver &&
      member === 'create' &&
      expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
      target
    ) {
      sources.push(target);
    }
    if (
      receiver &&
      member === 'setPrototypeOf' &&
      (expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) ||
        expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0)) &&
      prototype
    ) {
      sources.push(prototype);
    }
  }
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol();
    if (symbol) {
      const symbolKey = requestSymbolKey(symbol);
      if (!seen.has(symbolKey)) {
        seen.add(symbolKey);
        for (const declaration of symbol.getDeclarations()) {
          const initializer = valueDeclarationInitializer(declaration);
          if (initializer) {
            sources.push(
              ...requestPrototypeSourcesForExpression(initializer, new Set(seen), session),
            );
          }
        }
        const sourceFiles = new Set(
          symbol.getDeclarations().map((declaration) => declaration.getSourceFile()),
        );
        for (const sourceFile of sourceFiles) {
          sources.push(...requestPrototypeMutationsForSymbol(sourceFile, symbolKey));
        }
      }
    }
  }
  return dedupeRequestNodes([
    ...sources,
    ...sources.flatMap((source) =>
      requestPrototypeSourcesForExpression(source, new Set(seen), session),
    ),
  ]);
}

const requestPrototypeMutationMemo = new WeakMap<SourceFile, Map<string, readonly Node[]>>();

function requestPrototypeMutationsForSymbol(
  sourceFile: SourceFile,
  symbolKey: string,
): readonly Node[] {
  let memo = requestPrototypeMutationMemo.get(sourceFile);
  if (!memo) {
    const mutable = new Map<string, Node[]>();
    const aliases = new Map<string, string>();
    const add = (target: Node | undefined, prototype: Node | undefined): void => {
      const node = target ? unwrapStaticExpression(target) : undefined;
      const symbol = Node.isIdentifier(node) ? node.getSymbol() : undefined;
      if (!symbol || !prototype) return;
      const key = requestSymbolKey(symbol);
      const current = mutable.get(key) ?? [];
      current.push(prototype);
      mutable.set(key, current);
    };
    for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      const initialNode = initializer ? unwrapStaticExpression(initializer) : undefined;
      if (!Node.isIdentifier(name) || !Node.isIdentifier(initialNode)) continue;
      const alias = name.getSymbol();
      const target = initialNode.getSymbol();
      if (alias && target) aliases.set(requestSymbolKey(alias), requestSymbolKey(target));
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = unwrapStaticExpression(call.getExpression());
      const receiver = requestCallReceiver(callee);
      if (!receiver || requestStaticCallMember(callee) !== 'setPrototypeOf') continue;
      if (
        !expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
        !expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0)
      ) {
        continue;
      }
      const [target, prototype] = call.getArguments();
      add(target, prototype);
    }
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
      const target = unwrapStaticExpression(assignment.getLeft());
      if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) {
        continue;
      }
      if (
        requestCallableMemberName(
          Node.isPropertyAccessExpression(target)
            ? target.getNameNode()
            : target.getArgumentExpression(),
        ) !== '__proto__'
      ) {
        continue;
      }
      add(target.getExpression(), assignment.getRight());
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [alias, target] of aliases) {
        const values = mutable.get(alias);
        if (!values) continue;
        const current = mutable.get(target) ?? [];
        const merged = dedupeRequestNodes([...current, ...values]);
        if (merged.length !== current.length) {
          mutable.set(target, merged);
          changed = true;
        }
      }
    }
    memo = new Map([...mutable].map(([key, values]) => [key, dedupeRequestNodes(values)] as const));
    requestPrototypeMutationMemo.set(sourceFile, memo);
  }
  return memo.get(symbolKey) ?? [];
}

function scanRequestOpaqueInternalMethodTarget(
  expression: Node,
  site: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
  protocol: string,
): void {
  const receiver = unwrapStaticExpression(expression);
  if (scanRequestProxyUse(receiver, site, context)) return;
  const role = requestExpressionRootParameterRole(receiver, callable, new Set(), 0);
  const localContainer = requestLocalIntrinsicContainerKind(receiver, callable, context, new Set());
  const safeGlobal =
    Node.isIdentifier(receiver) &&
    (REQUEST_SAFE_GLOBAL_CALLABLES.has(receiver.getText()) ||
      REQUEST_SAFE_GLOBAL_CONSTRUCTORS.has(receiver.getText()) ||
      REQUEST_SAFE_GLOBAL_NAMESPACES.has(receiver.getText())) &&
    unshadowedGlobalIdentifier(receiver, receiver.getText()) &&
    !requestGlobalIntrinsicBindingIsMutated(receiver.getText(), receiver.getSourceFile());
  if (
    requestRootRoleIncludesCapability(role) ||
    requestRootRoleIncludesInput(role) ||
    role === 'request' ||
    requestExpressionContainsClosedAuthority(receiver, new Set(), 0) ||
    requestExpressionIsSafeGlobalNamespace(receiver) ||
    requestExpressionIsReviewedFrozenStyleValue(receiver) ||
    requestExpressionIsProtocolSafe(receiver, callable, new Set(), context.provenance) ||
    localContainer !== undefined ||
    safeGlobal ||
    requestClassDeclarationsForExpression(receiver, new Set()).length > 0
  ) {
    return;
  }
  appendRequestProtocolFact(context, site, protocol, receiver);
}

function scanRequestSuperPropertyAccess(
  access: Node,
  member: string | undefined,
  site: Node,
  _callable: RequestCallable,
  context: RequestProcessScanContext,
  write: boolean,
): void {
  const owner = access.getFirstAncestor(
    (ancestor) => Node.isClassDeclaration(ancestor) || Node.isClassExpression(ancestor),
  );
  if ((!Node.isClassDeclaration(owner) && !Node.isClassExpression(owner)) || !member) {
    appendRequestProtocolFact(context, site, 'super-property', access);
    return;
  }
  const heritage = owner.getExtends()?.getExpression();
  if (!heritage || scanRequestProxyUse(heritage, site, context)) return;
  const bases = requestClassDeclarationsForExpression(heritage, new Set());
  if (bases.length === 0) {
    appendRequestProtocolFact(context, site, 'super-property', heritage);
    return;
  }
  for (const base of bases) {
    const accessors = write ? base.getSetAccessors() : base.getGetAccessors();
    for (const accessor of accessors) {
      if (requestCallableMemberName(accessor.getNameNode()) !== member) continue;
      const nested = requestCallableForFunctionNode(accessor);
      if (nested) scanRequestCallable(nested, context);
    }
  }
}

function scanRequestProtocolUse(
  expression: Node,
  hooks: readonly string[],
  site: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  const node = unwrapStaticExpression(expression);
  if (scanRequestProxyUse(node, site, context)) return;

  let resolved = false;
  if (
    Node.isCallExpression(node) &&
    hooks.some((hook) => hook === '@@iterator' || hook === '@@asyncIterator')
  ) {
    for (const nested of resolveRequestCallable(
      node.getExpression(),
      new Set(),
      0,
      context.provenance,
    ).callables) {
      const yields = [
        ...(Node.isYieldExpression(nested.body) ? [nested.body] : []),
        ...nested.body.getDescendantsOfKind(SyntaxKind.YieldExpression),
      ].filter((yielded) => nodeBelongsToRequestCallable(yielded, nested));
      if (yields.length === 0) continue;
      resolved = true;
      scanRequestCallable(nested, context);
    }
  }
  const protocolSources = [node, ...requestProtocolPrototypeSources(node, new Set())];
  for (const hook of hooks) {
    const callables = protocolSources.flatMap((source) =>
      requestAccessorCallablesForExpression(source, hook, new Set(), context.provenance),
    );
    if (Node.isIdentifier(node)) {
      for (const assigned of requestAssignedMemberExpressions(
        node,
        hook,
        site.getStart(),
        context.provenance,
      )) {
        callables.push(
          ...resolveRequestCallable(assigned, new Set(), 0, context.provenance).callables,
        );
      }
    }
    for (const nested of dedupeRequestCallables(callables)) {
      resolved = true;
      if (hook === 'then') {
        context.provenance.promiseSettlementCallables.add(requestNodeIdentity(nested.declaration));
      }
      scanRequestCallable(nested, context);
    }
    if (scanRequestProtocolPrototypeMutations(hook, site, context)) resolved = true;
  }

  if (
    !resolved &&
    !requestExpressionIsProtocolSafe(node, callable, new Set(), context.provenance)
  ) {
    appendRequestProtocolFact(context, site, hooks.join('|'), node);
  }
}

function requestProtocolPrototypeSources(expression: Node, seen: Set<string>): Node[] {
  const node = unwrapStaticExpression(expression);
  const key = `protocol-prototype:${requestNodeIdentity(node)}`;
  if (seen.has(key)) return [];
  seen.add(key);
  if (Node.isConditionalExpression(node)) {
    return dedupeRequestNodes(
      [node.getWhenTrue(), node.getWhenFalse()].flatMap((branch) =>
        requestProtocolPrototypeSources(branch, new Set(seen)),
      ),
    );
  }
  if (Node.isIdentifier(node) && node.getSymbol()) {
    return dedupeRequestNodes(
      node
        .getSymbol()!
        .getDeclarations()
        .flatMap((declaration) => {
          const initializer = valueDeclarationInitializer(declaration);
          return initializer ? requestProtocolPrototypeSources(initializer, new Set(seen)) : [];
        }),
    );
  }
  if (!Node.isCallExpression(node)) return [];
  const callee = unwrapStaticExpression(node.getExpression());
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  if (!receiver || !expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0)) {
    return [];
  }
  if (member === 'create') {
    const prototype = node.getArguments()[0];
    return prototype ? [prototype] : [];
  }
  if (member === 'setPrototypeOf') {
    const prototype = node.getArguments()[1];
    return prototype ? [prototype] : [];
  }
  return [];
}

function appendRequestProtocolFact(
  context: RequestProcessScanContext,
  siteNode: Node,
  protocol: string,
  source: Node,
): void {
  const site = projectSiteFor(context.filesByPath, siteNode);
  const rendered = `<${protocol}:${shortSource(source)}>`;
  if (
    context.facts.some(
      (fact) =>
        fact.sink === 'request-handler.opaque-protocol' &&
        fact.site === site &&
        fact.source === rendered,
    )
  ) {
    return;
  }
  context.facts.push({
    safePath:
      'use compiler-provable plain data or keep every authored protocol hook inside the authoritative app snapshot',
    sink: 'request-handler.opaque-protocol',
    site,
    source: rendered,
  });
}

interface RequestProxyDefinition {
  readonly handler: Node;
  readonly proxy: Node;
  readonly target: Node;
}

function scanRequestProxyUse(
  expression: Node,
  site: Node,
  context: RequestProcessScanContext,
): boolean {
  const definitions = requestProxyDefinitionsForExpression(
    expression,
    new Set(),
    context.provenance,
  );
  if (definitions.length === 0) return false;
  for (const definition of definitions) {
    for (const trap of requestAccessorCallablesForExpression(
      definition.handler,
      undefined,
      new Set(),
      context.provenance,
    )) {
      scanRequestCallable(trap, context);
    }
    // App-authored handlers inherit from a mutable shared realm. Even `{}` cannot prove the
    // absence of inherited traps, so Proxy-bearing request operations are outside the reviewed
    // sound subset and always fail closed.
    appendRequestProtocolFact(context, site, 'proxy', definition.proxy);
  }
  return true;
}

function scanRequestProxyMutationTarget(
  expression: Node,
  site: Node,
  context: RequestProcessScanContext,
): void {
  let target = unwrapStaticExpression(expression);
  while (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) {
    const owner = target.getExpression();
    scanRequestProxyUse(owner, site, context);
    target = unwrapStaticExpression(owner);
  }
}

function requestProxyDefinitionsForExpression(
  expression: Node,
  seen: Set<string>,
  session: RequestProvenanceSession,
): RequestProxyDefinition[] {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `proxy:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey) || !requestProvenanceStep(session, node)) return [];
  seen.add(nodeKey);
  if (Node.isNewExpression(node) && requestNewExpressionIsProxy(node)) {
    const [target, handler] = node.getArguments();
    return target && handler ? [{ handler, proxy: node, target }] : [];
  }
  if (Node.isConditionalExpression(node)) {
    return dedupeRequestProxyDefinitions(
      [node.getWhenTrue(), node.getWhenFalse()].flatMap((branch) =>
        requestProxyDefinitionsForExpression(branch, new Set(seen), session),
      ),
    );
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return dedupeRequestProxyDefinitions(
        [node.getLeft(), node.getRight()].flatMap((branch) =>
          requestProxyDefinitionsForExpression(branch, new Set(seen), session),
        ),
      );
    }
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? node.getName()
      : staticMemberName(node.getArgumentExpression());
    const owner = unwrapStaticExpression(node.getExpression());
    if (member === 'proxy' && Node.isCallExpression(owner)) {
      const callee = unwrapStaticExpression(owner.getExpression());
      const receiver = requestCallReceiver(callee);
      if (
        receiver &&
        requestStaticCallMember(callee) === 'revocable' &&
        expressionResolvesToGlobalNamespace(receiver, 'Proxy', new Set(), 0)
      ) {
        const [target, handler] = owner.getArguments();
        return target && handler ? [{ handler, proxy: owner, target }] : [];
      }
    }
    const projected = member
      ? requestWireProjectedExpression(owner, [member], new Set(), 0)
      : undefined;
    return projected ? requestProxyDefinitionsForExpression(projected, new Set(seen), session) : [];
  }
  if (Node.isCallExpression(node)) {
    const definitions: RequestProxyDefinition[] = [];
    for (const callable of resolveRequestCallable(node.getExpression(), new Set(), 0, session)
      .callables) {
      for (const output of requestWireOutputExpressions(callable)) {
        definitions.push(...requestProxyDefinitionsForExpression(output, new Set(seen), session));
      }
    }
    return dedupeRequestProxyDefinitions(definitions);
  }
  if (!Node.isIdentifier(node)) return [];
  const symbol = node.getSymbol();
  if (!symbol) return [];
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return [];
  seen.add(symbolKey);
  const definitions: RequestProxyDefinition[] = [];
  for (const declaration of symbol.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (initializer) {
      definitions.push(
        ...requestProxyDefinitionsForExpression(initializer, new Set(seen), session),
      );
    }
  }
  for (const assigned of requestCallableAssignmentExpressions(symbol, session)) {
    definitions.push(...requestProxyDefinitionsForExpression(assigned, new Set(seen), session));
  }
  return dedupeRequestProxyDefinitions(definitions);
}

function dedupeRequestProxyDefinitions(
  definitions: readonly RequestProxyDefinition[],
): RequestProxyDefinition[] {
  return [
    ...new Map(
      definitions.map((definition) => [requestNodeIdentity(definition.proxy), definition]),
    ).values(),
  ];
}

interface RequestProtocolPrototypeMutations {
  readonly candidates: readonly Node[];
  readonly opaqueSites: readonly Node[];
}

function scanRequestProtocolPrototypeMutations(
  hook: string,
  site: Node,
  context: RequestProcessScanContext,
): boolean {
  const mutations = requestProtocolPrototypeMutations(
    site.getSourceFile(),
    hook,
    context.provenance,
  );
  for (const opaque of mutations.opaqueSites) {
    appendRequestProtocolFact(context, opaque, `prototype-${hook}`, opaque);
  }
  for (const candidate of mutations.candidates) {
    const resolution = resolveRequestCallable(candidate, new Set(), 0, context.provenance);
    if (resolution.callables.length === 0) {
      appendRequestProtocolFact(context, candidate, `prototype-${hook}`, candidate);
      continue;
    }
    for (const callable of resolution.callables) scanRequestCallable(callable, context);
  }
  return mutations.candidates.length > 0 || mutations.opaqueSites.length > 0;
}

function requestProtocolPrototypeMutations(
  sourceFile: SourceFile,
  hook: string,
  session: RequestProvenanceSession,
): RequestProtocolPrototypeMutations {
  const key = `${sourceFile.getFilePath()}:${hook}`;
  const memoized = session.protocolPrototypeMemo.get(key);
  if (memoized) return memoized;
  const candidates: Node[] = [];
  const opaqueSites: Node[] = [];
  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = assignment.getOperatorToken().getKind();
    if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
    const target = unwrapStaticExpression(assignment.getLeft());
    if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) {
      continue;
    }
    const member = Node.isPropertyAccessExpression(target)
      ? requestCallableMemberName(target.getNameNode())
      : requestCallableMemberName(target.getArgumentExpression());
    if (
      member === hook &&
      requestExpressionIsKnownGlobalPrototype(target.getExpression(), new Set())
    ) {
      candidates.push(assignment.getRight());
    }
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrapStaticExpression(call.getExpression());
    const receiver = requestCallReceiver(callee);
    if (!receiver) continue;
    const method = requestStaticCallMember(callee);
    const objectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0);
    const reflectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0);
    const [target, property, descriptorOrValue] = call.getArguments();
    if (!target || !requestExpressionIsKnownGlobalPrototype(target, new Set())) continue;
    if (reflectGlobal && method === 'set') {
      const member = requestCallableMemberName(property);
      if (member === hook && descriptorOrValue) candidates.push(descriptorOrValue);
      else if (member === undefined) opaqueSites.push(call);
      continue;
    }
    if ((objectGlobal || reflectGlobal) && method === 'defineProperty') {
      const member = requestCallableMemberName(property);
      if (member === hook && descriptorOrValue) {
        const descriptor = resolveStaticObjectLiteral(descriptorOrValue, new Set(), 0);
        const value = descriptor ? requestStaticObjectProperty(descriptor, 'value') : undefined;
        const getter = descriptor ? requestStaticObjectProperty(descriptor, 'get') : undefined;
        const candidate = value ?? getter;
        if (candidate) candidates.push(requestHandlerPropertyExpression(candidate) ?? candidate);
        else opaqueSites.push(call);
      } else if (member === undefined) {
        opaqueSites.push(call);
      }
    }
  }
  const result: RequestProtocolPrototypeMutations = {
    candidates: dedupeRequestNodes(candidates),
    opaqueSites: dedupeRequestNodes(opaqueSites),
  };
  session.protocolPrototypeMemo.set(key, result);
  return result;
}

function requestExpressionIsProtocolSafe(
  expression: Node,
  callable: RequestCallable,
  seen: Set<string>,
  session: RequestProvenanceSession,
): boolean {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `protocol-safe:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey) || !requestProvenanceStep(session, node)) return false;
  seen.add(nodeKey);

  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isNumericLiteral(node) ||
    Node.isBigIntLiteral(node) ||
    Node.isTrueLiteral(node) ||
    Node.isFalseLiteral(node) ||
    Node.isRegularExpressionLiteral(node) ||
    node.getKind() === SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (
    Node.isTemplateExpression(node) ||
    Node.isPrefixUnaryExpression(node) ||
    Node.isPostfixUnaryExpression(node) ||
    Node.isTypeOfExpression(node)
  ) {
    return true;
  }
  if (Node.isConditionalExpression(node)) {
    return (
      requestExpressionIsProtocolSafe(node.getWhenTrue(), callable, new Set(seen), session) &&
      requestExpressionIsProtocolSafe(node.getWhenFalse(), callable, new Set(seen), session)
    );
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken ||
      operator === SyntaxKind.CommaToken
    ) {
      return (
        requestExpressionIsProtocolSafe(node.getLeft(), callable, new Set(seen), session) &&
        requestExpressionIsProtocolSafe(node.getRight(), callable, new Set(seen), session)
      );
    }
    return true;
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().every((element) => {
      if (Node.isOmittedExpression(element)) return true;
      return Node.isSpreadElement(element)
        ? requestExpressionIsProtocolSafe(element.getExpression(), callable, new Set(seen), session)
        : true;
    });
  }
  if (Node.isObjectLiteralExpression(node)) {
    return !node.getProperties().some(Node.isSpreadAssignment);
  }
  if (Node.isAwaitExpression(node)) {
    return requestExpressionIsProtocolSafe(node.getExpression(), callable, seen, session);
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    if (requestExpressionIsReviewedFrozenStyleValue(node)) return true;
    if (expressionResolvesToGlobalNamespace(node.getExpression(), 'Symbol', new Set(), 0)) {
      return true;
    }
    const role = requestExpressionRootParameterRole(node, callable, new Set(), 0);
    if (requestRootRoleIncludesInput(role)) return true;
    return requestExpressionIsProtocolSafe(node.getExpression(), callable, new Set(seen), session);
  }
  if (Node.isNewExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    return !!(
      Node.isIdentifier(callee) &&
      ['Array', 'Promise'].includes(callee.getText()) &&
      unshadowedGlobalIdentifier(callee, callee.getText())
    );
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    if (callee.getKind() === SyntaxKind.ImportKeyword) return true;
    if (requestCallIsExactTrustedOutput(node)) return true;
    if (requestCallIsExactFrameworkNativePromise(node) || requestCallIsExactRespondMethod(node)) {
      return true;
    }
    if (requestCallIsPublicStyleCreate(node)) return true;
    if (requestCallIsReviewedPublicUiRender(node)) return true;
    if (
      Node.isIdentifier(callee) &&
      [...REQUEST_SAFE_GLOBAL_CALLABLES, 'Symbol'].includes(callee.getText()) &&
      unshadowedGlobalIdentifier(callee, callee.getText())
    ) {
      return true;
    }
    if (requestCallIsGovernedFetch(node)) return true;
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    if (
      receiver &&
      member &&
      REQUEST_SAFE_FETCH_RESPONSE_METHODS.has(member) &&
      requestExpressionIsFetchResponse(receiver, new Set())
    ) {
      return true;
    }
    if (
      receiver &&
      member &&
      REQUEST_SAFE_REQUEST_METHODS.has(member) &&
      requestExpressionRootParameterRole(receiver, callable, new Set(), 0) === 'request'
    ) {
      return true;
    }
    if (receiver && member) {
      if (member === 'join' && Node.isArrayLiteralExpression(unwrapStaticExpression(receiver))) {
        return true;
      }
      if (
        (expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) ||
          expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0)) &&
        ['create', 'setPrototypeOf'].includes(member) &&
        node
          .getArguments()
          .every((argument) =>
            requestExpressionIsProtocolSafe(argument, callable, new Set(seen), session),
          )
      ) {
        return true;
      }
      if (
        expressionResolvesToGlobalNamespace(receiver, 'JSON', new Set(), 0) &&
        (member === 'parse' || member === 'stringify')
      ) {
        return true;
      }
      if (
        expressionResolvesToGlobalNamespace(receiver, 'Array', new Set(), 0) &&
        (member === 'isArray' || member === 'of')
      ) {
        return true;
      }
      if (
        expressionResolvesToGlobalNamespace(receiver, 'Response', new Set(), 0) &&
        ['error', 'json', 'redirect'].includes(member)
      ) {
        return true;
      }
      if (
        expressionResolvesToGlobalNamespace(receiver, 'Promise', new Set(), 0) &&
        ['all', 'allSettled', 'any', 'race', 'reject', 'resolve'].includes(member) &&
        node
          .getArguments()
          .every((argument) =>
            requestExpressionIsProtocolSafe(argument, callable, new Set(seen), session),
          )
      ) {
        return true;
      }
    }
    if (receiver) {
      const role = requestExpressionRootParameterRole(receiver, callable, new Set(), 0);
      if (
        requestRootRoleIncludesCapability(role) ||
        requestRootRoleIncludesInput(role) ||
        requestExpressionContainsClosedAuthority(receiver, new Set(), 0)
      ) {
        return true;
      }
      if (
        member &&
        REQUEST_SAFE_JSON_VALUE_METHODS.has(member) &&
        requestExpressionIsProtocolSafe(receiver, callable, new Set(seen), session)
      ) {
        return true;
      }
      if (
        member &&
        ['then', 'catch', 'finally'].includes(member) &&
        requestExpressionIsExactNativePromise(receiver, new Set(), session)
      ) {
        return true;
      }
    }
    const resolution = resolveRequestCallable(callee, new Set(), 0, session);
    if (resolution.callables.length > 0) {
      return resolution.callables.every((nested) => {
        const outputs = requestWireOutputExpressions(nested);
        return (
          outputs.length > 0 &&
          outputs.every((output) =>
            requestExpressionIsProtocolSafe(output, nested, new Set(seen), session),
          )
        );
      });
    }
    return false;
  }
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isClassDeclaration(node) ||
    Node.isClassExpression(node)
  ) {
    return true;
  }
  if (!Node.isIdentifier(node)) return false;
  if (unshadowedGlobalIdentifier(node, 'undefined')) return true;
  if (requestIdentifierIsImportedMutableContainer(node)) return false;
  const role = requestExpressionRootParameterRole(node, callable, new Set(), 0);
  if (requestRootRoleIncludesInput(role)) return true;
  const symbol = requestIdentifierValueSymbol(node);
  if (!symbol) return false;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return false;
  seen.add(symbolKey);
  const declarations = symbol.getDeclarations();
  if (
    declarations.some((declaration) =>
      requestParameterIsReviewedPlainCallbackValue(declaration, session),
    )
  ) {
    return true;
  }
  if (requestMutableNumericBindingStaysPrimitive(symbol)) return true;
  if (
    declarations.some((declaration) => {
      if (!Node.isVariableDeclaration(declaration)) return false;
      const statement = declaration.getVariableStatement();
      return !!statement && statement.getDeclarationKind() !== VariableDeclarationKind.Const;
    })
  ) {
    return false;
  }
  if (requestAssignedBindingProjections(symbol, session).length > 0) return false;
  const initializers = declarations
    .map(valueDeclarationInitializer)
    .filter((initializer): initializer is Node => initializer !== undefined);
  if (initializers.length === 0) {
    for (const declaration of declarations) {
      if (Node.isBindingElement(declaration)) {
        const projection = requestBindingElementProjection(declaration);
        if (
          projection &&
          requestExpressionIsProtocolSafe(projection.expression, callable, new Set(seen), session)
        ) {
          return true;
        }
      }
      const loop = declaration.getFirstAncestorByKind(SyntaxKind.ForOfStatement);
      if (
        loop &&
        requestExpressionIsProtocolSafe(loop.getExpression(), callable, new Set(seen), session)
      ) {
        return true;
      }
    }
    return declarations.some(
      (declaration) =>
        Node.isFunctionDeclaration(declaration) || Node.isClassDeclaration(declaration),
    );
  }
  return initializers.every((initializer) =>
    requestExpressionIsProtocolSafe(initializer, callable, new Set(seen), session),
  );
}

function requestParameterIsReviewedPlainCallbackValue(
  declaration: Node,
  session: RequestProvenanceSession,
): boolean {
  if (!Node.isParameterDeclaration(declaration)) return false;
  const owner = declaration.getParent();
  const callable = requestCallableForFunctionNode(owner);
  if (!callable) return false;
  let callbackExpression: Node = owner;
  while (
    Node.isParenthesizedExpression(callbackExpression.getParent()) ||
    Node.isAsExpression(callbackExpression.getParent()) ||
    Node.isSatisfiesExpression(callbackExpression.getParent())
  ) {
    callbackExpression = callbackExpression.getParent()!;
  }
  const call = callbackExpression.getParent();
  if (!Node.isCallExpression(call)) return false;
  const index = call.getArguments().findIndex((argument) => argument === callbackExpression);
  if (index < 0) return false;
  const callee = unwrapStaticExpression(call.getExpression());
  const member = requestStaticCallMember(callee);
  const callbackIndexes = member ? requestCallbackArgumentIndexes(call, member) : undefined;
  if (!callbackIndexes?.includes(index)) return false;
  const receiver = requestCallReceiver(callee);
  if (receiver && Node.isArrayLiteralExpression(unwrapStaticExpression(receiver))) return true;
  if (!receiver || !member) return false;
  const source = call.getArguments()[0];
  if (!source) return false;
  const reviewedPlainSource =
    (expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
      member === 'groupBy') ||
    (expressionResolvesToGlobalNamespace(receiver, 'Array', new Set(), 0) &&
      member === 'fromAsync') ||
    (expressionResolvesToGlobalNamespace(receiver, 'JSON', new Set(), 0) && member === 'stringify');
  if (!reviewedPlainSource) return false;
  const caller = requestEnclosingCallable(call) ?? callable;
  return requestExpressionIsPlainWireValue(
    source,
    {
      bindingKey: 'plain-callback-source',
      bindings: new Map(),
      rootCallable: caller,
      scopeCallable: callable,
      session,
    },
    new Set(),
  );
}

function requestMutableNumericBindingStaysPrimitive(
  symbol: NonNullable<ReturnType<Node['getSymbol']>>,
): boolean {
  const declarations = symbol.getDeclarations();
  const variables = declarations.filter(Node.isVariableDeclaration);
  if (variables.length === 0 || variables.length !== declarations.length) return false;
  if (
    variables.some(
      (declaration) =>
        declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const,
    )
  ) {
    return false;
  }
  const isNumericLiteral = (expression: Node | undefined): boolean => {
    if (!expression) return false;
    const node = unwrapStaticExpression(expression);
    if (Node.isNumericLiteral(node) || Node.isBigIntLiteral(node)) return true;
    return (
      Node.isPrefixUnaryExpression(node) &&
      (node.getOperatorToken() === SyntaxKind.PlusToken ||
        node.getOperatorToken() === SyntaxKind.MinusToken) &&
      (Node.isNumericLiteral(node.getOperand()) || Node.isBigIntLiteral(node.getOperand()))
    );
  };
  if (variables.some((declaration) => !isNumericLiteral(declaration.getInitializer()))) {
    return false;
  }

  const target = requestSymbolKey(symbol);
  for (const sourceFile of new Set(variables.map((declaration) => declaration.getSourceFile()))) {
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const operator = assignment.getOperatorToken().getKind();
      if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
      const projections = requestAssignmentTargetProjections(assignment.getLeft(), []);
      if (!projections.some((projection) => projection.target === target)) continue;
      const left = unwrapStaticExpression(assignment.getLeft());
      if (!Node.isIdentifier(left) || requestSymbolKey(left.getSymbol()!) !== target) return false;
      if (operator === SyntaxKind.EqualsToken && !isNumericLiteral(assignment.getRight())) {
        return false;
      }
      if (
        operator === SyntaxKind.BarBarEqualsToken ||
        operator === SyntaxKind.AmpersandAmpersandEqualsToken ||
        operator === SyntaxKind.QuestionQuestionEqualsToken
      ) {
        return false;
      }
    }
    for (const loop of sourceFile.getDescendantsOfKind(SyntaxKind.ForOfStatement)) {
      if (
        requestAssignmentTargetProjections(loop.getInitializer(), []).some(
          (projection) => projection.target === target,
        )
      ) {
        return false;
      }
    }
    for (const loop of sourceFile.getDescendantsOfKind(SyntaxKind.ForInStatement)) {
      if (
        requestAssignmentTargetProjections(loop.getInitializer(), []).some(
          (projection) => projection.target === target,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function scanRequestJsxComponents(
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  const roots: readonly Node[] = [
    callable.body,
    ...requestCallableParameters(callable.declaration),
  ];
  const elements: Array<import('ts-morph').JsxElement | import('ts-morph').JsxSelfClosingElement> =
    roots
      .flatMap((root) => [
        ...(Node.isJsxElement(root) ? [root] : []),
        ...(Node.isJsxSelfClosingElement(root) ? [root] : []),
        ...root.getDescendantsOfKind(SyntaxKind.JsxElement),
        ...root.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
      ])
      .filter((candidate) => nodeBelongsToRequestCallable(candidate, callable));
  for (const element of elements) {
    const tag = requestJsxTagNameNode(element);
    if (!tag) continue;
    for (const spread of requestJsxSpreadExpressions(element)) {
      scanRequestGetterConsumer(spread, element, callable, context, 'jsx-spread-getters');
    }
    if (requestJsxTagIsIntrinsic(tag)) continue;
    if (requestJsxTagIsReviewedPublicComponent(tag)) {
      for (const value of requestJsxValueExpressions(element)) {
        scanRequestProxyUse(value, element, context);
        scanRequestCallableValuesInExpression(value, context, true);
        if (!requestExpressionIsProtocolSafe(value, callable, new Set(), context.provenance)) {
          for (const accessor of requestAccessorCallablesForExpression(
            value,
            undefined,
            new Set(),
            context.provenance,
          )) {
            scanRequestCallable(accessor, context);
          }
        }
      }
      continue;
    }
    const resolution = resolveRequestCallable(tag, new Set(), 0, context.provenance);
    if (resolution.callables.length === 0) {
      if (resolution.opaqueModule !== undefined) {
        appendOpaqueRequestHandlerFact(context, element, resolution.opaqueModule);
      } else {
        appendRequestProtocolFact(context, element, 'jsx-component', tag);
      }
      continue;
    }
    const values = requestJsxValueExpressions(element);
    for (const value of values) {
      scanRequestProxyUse(value, element, context);
      scanRequestCallableValuesInExpression(value, context);
      if (!requestExpressionIsProtocolSafe(value, callable, new Set(), context.provenance)) {
        for (const accessor of requestAccessorCallablesForExpression(
          value,
          undefined,
          new Set(),
          context.provenance,
        )) {
          scanRequestCallable(accessor, context);
        }
      }
    }
    const propsArePlain = values.every((value) =>
      requestExpressionIsProtocolSafe(value, callable, new Set(), context.provenance),
    );
    for (const nested of resolution.callables) {
      scanRequestCallable(
        {
          ...nested,
          ...(propsArePlain
            ? {
                rootParameterRoles: requestCallableParameters(nested.declaration).map(
                  () => 'input' as const,
                ),
              }
            : {}),
        },
        context,
      );
    }
  }
}

/** Reviewed server-rendered component props can still contain executable callbacks/getters. */
function scanRequestCallableValuesInExpression(
  expression: Node,
  context: RequestProcessScanContext,
  parametersAreInput = false,
): void {
  const reviewed = (callable: RequestCallable): RequestCallable =>
    parametersAreInput
      ? {
          ...callable,
          rootParameterRoles: requestCallableParameters(callable.declaration).map(() => 'input'),
        }
      : callable;
  const resolvedObject = resolveStaticObjectLiteral(expression, new Set(), 0);
  const root = resolvedObject ?? expression;
  const candidates = [
    expression,
    ...(root === expression ? [] : [root]),
    ...root
      .getDescendants()
      .filter(
        (candidate) =>
          Node.isArrowFunction(candidate) ||
          Node.isFunctionExpression(candidate) ||
          Node.isFunctionDeclaration(candidate) ||
          Node.isMethodDeclaration(candidate) ||
          Node.isGetAccessorDeclaration(candidate) ||
          Node.isSetAccessorDeclaration(candidate),
      ),
  ];
  for (const candidate of candidates) {
    const direct = requestCallableForFunctionNode(candidate);
    if (direct) scanRequestCallable(reviewed(direct), context);
  }
  for (const callable of dedupeRequestCallables([
    ...resolveRequestCallable(expression, new Set(), 0, context.provenance).callables,
    ...requestAccessorCallablesForExpression(expression, undefined, new Set(), context.provenance),
    ...(root === expression
      ? []
      : requestAccessorCallablesForExpression(root, undefined, new Set(), context.provenance)),
  ])) {
    scanRequestCallable(reviewed(callable), context);
  }
}

function requestJsxSpreadExpressions(
  element: import('ts-morph').JsxElement | import('ts-morph').JsxSelfClosingElement,
): Node[] {
  const opening = Node.isJsxElement(element) ? element.getOpeningElement() : element;
  return opening
    .getAttributes()
    .filter(Node.isJsxSpreadAttribute)
    .map((attribute) => attribute.getExpression());
}

function requestJsxValueExpressions(
  element: import('ts-morph').JsxElement | import('ts-morph').JsxSelfClosingElement,
): Node[] {
  const opening = Node.isJsxElement(element) ? element.getOpeningElement() : element;
  const values: Node[] = [];
  for (const attribute of opening.getAttributes()) {
    if (Node.isJsxSpreadAttribute(attribute)) {
      values.push(attribute.getExpression());
      continue;
    }
    const initializer = attribute.getInitializer();
    if (initializer && Node.isJsxExpression(initializer)) {
      const expression = initializer.getExpression();
      if (expression) values.push(expression);
    }
  }
  if (Node.isJsxElement(element)) {
    for (const child of element.getJsxChildren()) {
      if (Node.isJsxExpression(child)) {
        const expression = child.getExpression();
        if (expression) values.push(expression);
      } else if (!Node.isJsxText(child)) {
        values.push(child);
      }
    }
  }
  return values;
}

function requestJsxTagNameNode(
  element: import('ts-morph').JsxElement | import('ts-morph').JsxSelfClosingElement,
): Node | undefined {
  return Node.isJsxElement(element)
    ? element.getOpeningElement().getTagNameNode()
    : element.getTagNameNode();
}

function requestJsxTagIsIntrinsic(tag: Node): boolean {
  if (!Node.isIdentifier(tag)) return false;
  const text = tag.getText();
  return text.includes('-') || /^[a-z]/.test(text);
}

/** SPEC §13.1: these exact public components are framework-owned render primitives. */
function requestJsxTagIsReviewedPublicComponent(tag: Node): boolean {
  const imported = requestImportedModuleExportForExpression(
    tag,
    (specifier) => specifier === '@kovojs/core',
    new Set(),
    0,
  );
  return imported?.module === '@kovojs/core' && imported.exportName === 'FormError';
}

function requestCallableWithInvocationRoles(
  callable: RequestCallable,
  args: readonly Node[],
  caller: RequestCallable,
): RequestCallable {
  const roles = requestCallableParameters(callable.declaration).map(
    (_parameter, index): RequestRootParameterRole => {
      const argument = args[index];
      if (!argument) return 'capability';
      const role = requestExpressionRootParameterRole(argument, caller, new Set(), 0);
      if (role) return role;
      return requestExpressionIsIntrinsicValue(argument, caller, new Set(), 0)
        ? 'input'
        : 'capability';
    },
  );
  return roles.length > 0 ? { ...callable, rootParameterRoles: roles } : callable;
}

interface RequestWireBinding {
  readonly expression: Node;
  readonly path: readonly string[];
}

interface RequestWireAnalysisState {
  readonly bindingKey: string;
  readonly bindings: ReadonlyMap<string, RequestWireBinding>;
  readonly rootCallable: RequestCallable;
  readonly session: RequestProvenanceSession;
  readonly scopeCallable: RequestCallable;
}

interface RequestWireAuthority extends RequestRawAuthority {
  readonly source: Node;
}

interface RequestHeaderCallClassification {
  readonly authority?: RequestWireAuthority;
  readonly handled: boolean;
}

function requestNodeIdentity(node: Node): string {
  // Nested property prefixes share a start and syntax kind; the end offset distinguishes
  // `request.headers` from `request.headers.get` in memo and recursion-stack keys.
  return `${node.getSourceFile().getFilePath()}:${node.getStart()}:${node.getEnd()}:${node.getKind()}`;
}

function requestNodesAreSame(left: Node | undefined, right: Node | undefined): boolean {
  return !!left && !!right && requestNodeIdentity(left) === requestNodeIdentity(right);
}

function requestWireBindingKey(bindings: ReadonlyMap<string, RequestWireBinding>): string {
  return [...bindings]
    .map(
      ([symbol, binding]) =>
        `${symbol}=${requestNodeIdentity(unwrapStaticExpression(binding.expression))}:${binding.path.join('.')}`,
    )
    .sort()
    .join(';');
}

function requestWireStateKey(kind: string, node: Node, state: RequestWireAnalysisState): string {
  return [
    kind,
    requestNodeIdentity(node),
    requestNodeIdentity(state.rootCallable.declaration),
    requestNodeIdentity(state.scopeCallable.declaration),
    state.bindingKey,
  ].join('|');
}

function requestProvenanceBudgetAuthority(source: Node): RequestWireAuthority {
  return {
    safePath:
      'simplify the request-reachable provenance graph so the compiler can prove it within the bounded security-analysis budget',
    sink: 'request-handler.provenance-budget',
    source,
  };
}

function requestOpaqueWireAuthority(source: Node, kind: string): RequestWireAuthority {
  return {
    safePath:
      'return only compiler-provable plain data or an explicitly reviewed framework response across a public wire boundary',
    sink: `client-wire.request.opaque-${kind}`,
    source,
  };
}

/**
 * SPEC §6.6 / KV424: request credentials are server authority, not result data. Query and
 * mutation results and endpoint/webhook responses cross a public wire boundary, so follow exact
 * request/header provenance through aliases, local helpers, containers, and response builders.
 * Named non-credential headers remain usable; dynamic names and whole Headers carriers fail
 * closed because they can select Cookie or authorization material.
 */
function scanRequestWireConfidentiality(
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  if (
    !callable.publicWire &&
    !callable.publicWireMethods?.length &&
    !callable.publicWirePaths?.length
  ) {
    return;
  }
  const state: RequestWireAnalysisState = {
    bindingKey: 'root',
    bindings: new Map(),
    rootCallable: callable,
    session: context.provenance,
    scopeCallable: callable,
  };
  const wireExpressions = callable.publicWire ? requestWireOutputExpressions(callable) : [];
  for (const output of requestWireOutputExpressions(callable)) {
    for (const path of callable.publicWirePaths ?? []) {
      wireExpressions.push(...requestWireProjectedExpressions(output, path, new Set()));
    }
  }
  for (const call of callable.body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrapStaticExpression(call.getExpression());
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    if (
      !receiver ||
      !member ||
      !callable.publicWireMethods?.includes(member) ||
      !requestRootRoleIncludesCapability(
        requestExpressionRootParameterRole(receiver, callable, new Set(), 0),
      )
    ) {
      continue;
    }
    wireExpressions.push(call);
  }
  const directRouteOutcomeOutputs = new Set(
    callable.publicWire &&
      ((callable.rootFactory === 'endpoint' && callable.rootCallback === 'handler') ||
        (callable.rootFactory === 'route' && callable.rootCallback === 'page'))
      ? requestWireOutputExpressions(callable).map(requestNodeIdentity)
      : [],
  );
  for (const output of wireExpressions) {
    const authorities = requestWireAuthoritiesForExpression(
      output,
      state,
      directRouteOutcomeOutputs.has(requestNodeIdentity(output)),
    );
    for (const authority of authorities) {
      appendRequestAuthorityFact(context, output, authority, authority.source);
    }
  }
}

function requestWireProjectedExpressions(
  expression: Node,
  path: readonly string[],
  seen: Set<string>,
): Node[] {
  if (path.length === 0) return [expression];
  const node = unwrapStaticExpression(expression);
  const key = `wire-projection:${requestNodeIdentity(node)}:${path.join('.')}`;
  if (seen.has(key)) return [];
  seen.add(key);
  if (Node.isConditionalExpression(node)) {
    return dedupeRequestNodes(
      [node.getWhenTrue(), node.getWhenFalse()].flatMap((branch) =>
        requestWireProjectedExpressions(branch, path, new Set(seen)),
      ),
    );
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return dedupeRequestNodes(
        [node.getLeft(), node.getRight()].flatMap((branch) =>
          requestWireProjectedExpressions(branch, path, new Set(seen)),
        ),
      );
    }
  }
  const [member, ...rest] = path;
  const projected = requestWireProjectedExpression(node, [member!], new Set(), 0);
  const candidates = projected
    ? requestWireProjectedExpressions(projected, rest, new Set(seen))
    : [];
  for (const assigned of requestAssignedMemberExpressions(node, member!)) {
    candidates.push(...requestWireProjectedExpressions(assigned, rest, new Set(seen)));
  }
  for (const output of requestGetterOutputExpressions(node, member, new Set())) {
    candidates.push(...requestWireProjectedExpressions(output, rest, new Set(seen)));
  }
  if (Node.isIdentifier(node) && node.getSymbol()) {
    for (const assignment of requestAssignedBindingProjections(node.getSymbol()!)) {
      candidates.push(
        ...requestWireProjectedExpressions(
          assignment.expression,
          [...assignment.path, ...path],
          new Set(seen),
        ),
      );
    }
  }
  return dedupeRequestNodes(candidates);
}

function requestWireOutputExpressions(callable: RequestCallable): Node[] {
  if (!Node.isBlock(callable.body)) return [callable.body];
  return callable.body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) => nodeBelongsToRequestCallable(statement, callable))
    .flatMap((statement) => {
      const expression = statement.getExpression();
      return expression ? [expression] : [];
    });
}

function requestWireAuthoritiesForExpression(
  expression: Node,
  state: RequestWireAnalysisState,
  routeOutcomePosition = false,
): RequestWireAuthority[] {
  const node = unwrapStaticExpression(expression);
  const nodeKey = requestWireStateKey(
    routeOutcomePosition ? 'wire-route-outcome' : 'wire',
    node,
    state,
  );
  const memoized = state.session.wireMemo.get(nodeKey);
  if (memoized) return [...memoized];
  if (state.session.wireActive.has(nodeKey)) return [];
  if (!requestProvenanceStep(state.session, node)) {
    return [requestProvenanceBudgetAuthority(node)];
  }
  state.session.wireActive.add(nodeKey);
  const authorities = requestWireAuthoritiesForExpressionUncached(
    node,
    state,
    routeOutcomePosition,
  );
  state.session.wireActive.delete(nodeKey);
  const result = dedupeRequestWireAuthorities(
    state.session.exhaustedAt
      ? [...authorities, requestProvenanceBudgetAuthority(state.session.exhaustedAt)]
      : authorities,
  );
  state.session.wireMemo.set(nodeKey, result);
  return result;
}

function requestWireAuthoritiesForExpressionUncached(
  node: Node,
  state: RequestWireAnalysisState,
  routeOutcomePosition: boolean,
): RequestWireAuthority[] {
  if (Node.isAwaitExpression(node)) {
    return dedupeRequestWireAuthorities([
      ...requestWireAuthoritiesForExpression(node.getExpression(), state, routeOutcomePosition),
      ...requestWireThenableAuthorities(node.getExpression(), state),
    ]);
  }

  if (Node.isCallExpression(node)) {
    if (
      requestCallIsExactFrameworkNativePromise(node) ||
      (requestCallIsExactRespondMethod(node) &&
        (!routeOutcomePosition || !requestCallIsReviewedRouteOutcome(node, state.rootCallable)))
    ) {
      return dedupeRequestWireAuthorities([
        ...requestWireAuthoritiesForExpressions(node.getArguments(), state),
        requestOpaqueWireAuthority(node, 'value'),
      ]);
    }
    if (requestCallIsPublicStyleCreate(node)) {
      return requestWireAuthoritiesForExpressions(node.getArguments(), state);
    }
    if (requestCallIsReviewedDrizzleDbReadChainInDeclaredRoot(node, state.session)) {
      // A reviewed Drizzle select chain yields app-owned row data. Query arguments remain
      // server-side selectors and are scanned by the request-handler sink pass; they are not
      // themselves emitted on the public wire (SPEC §6.6, §9.4).
      return [];
    }
    if (
      requestCallIsReviewedPublicJsxAttributeHelper(node) &&
      requestCallIsExactJsxSpreadExpression(node)
    ) {
      return requestWireAuthoritiesForExpressions(
        requestCallIsPublicStyleAttrs(node) ? node.getArguments() : [],
        state,
      );
    }
    if (requestCallIsReviewedPublicUiRender(node)) {
      return requestWireAuthoritiesForExpressions(node.getArguments(), state);
    }
    const headerCall = requestWireHeaderCallClassification(node, state);
    if (headerCall.handled) return headerCall.authority ? [headerCall.authority] : [];

    const invocation = requestNormalizedCall(node);
    const callee = invocation.target;
    const invocationArguments = invocation.args ?? [];
    const receiver = requestCallReceiver(callee);
    const receiverCarrier = receiver
      ? requestWireCarrierForExpression(receiver, state, new Set(), 0)
      : undefined;
    const member = requestStaticCallMember(callee);
    const callbackAuthorities = requestWireCallbackOutputAuthorities(
      node,
      callee,
      invocationArguments,
      state,
    );
    const promiseAuthorities = requestWirePromiseAssimilationAuthorities(node, state);
    const iterableAuthorities = requestWireIterableConsumerAuthorities(node, state);
    if (receiverCarrier === 'request' || receiverCarrier === 'context') {
      if (receiverCarrier === 'request' && member === 'clone') {
        return [requestWholeWireAuthority(node, 'request')];
      }
      return requestWireAuthoritiesForExpressions(invocationArguments, state);
    }

    const resolution = resolveRequestCallable(callee, new Set(), 0, state.session);
    if (resolution.callables.length > 0) {
      const authorities: RequestWireAuthority[] = [];
      for (const nested of resolution.callables) {
        const bindings = requestWireBindingsForCall(nested, invocationArguments, state.bindings);
        const nestedState: RequestWireAnalysisState = {
          bindingKey: requestWireBindingKey(bindings),
          bindings,
          rootCallable: state.rootCallable,
          session: state.session,
          scopeCallable: nested,
        };
        for (const output of requestWireOutputExpressions(nested)) {
          authorities.push(
            // A helper result is ordinary authored data. Only the endpoint handler/route page's
            // own return slot may carry a respond.* outcome; propagating this positional bit into
            // helpers also blesses retained callback results such as array.map(() => respond.file()).
            ...requestWireAuthoritiesForExpression(output, nestedState),
          );
        }
      }
      if (invocation.args === undefined) {
        authorities.push(...requestWireAuthoritiesForExpressions(node.getArguments(), state));
      }
      authorities.push(...callbackAuthorities);
      authorities.push(...promiseAuthorities);
      authorities.push(...iterableAuthorities);
      return dedupeRequestWireAuthorities(authorities);
    }

    return dedupeRequestWireAuthorities([
      ...(receiver ? requestWireAuthoritiesForExpression(receiver, state) : []),
      ...requestWireAuthoritiesForExpressions(
        requestWireResultValueArguments(callee, invocation.args ?? node.getArguments(), state),
        state,
      ),
      ...callbackAuthorities,
      ...promiseAuthorities,
      ...iterableAuthorities,
    ]);
  }

  if (Node.isNewExpression(node)) {
    const constructTarget = unwrapStaticExpression(node.getExpression());
    const isPromiseConstruction =
      Node.isIdentifier(constructTarget) &&
      constructTarget.getText() === 'Promise' &&
      unshadowedGlobalIdentifier(constructTarget, 'Promise');
    return dedupeRequestWireAuthorities([
      ...(isPromiseConstruction
        ? []
        : requestWireAuthoritiesForExpressions(node.getArguments(), state)),
      ...requestWirePromiseExecutorAuthorities(node, state),
      ...requestWireAuthoritiesForExpressions(
        requestClassInstanceSerializedExpressions(node),
        state,
      ),
      ...requestWireAuthoritiesForExpressions(
        requestGetterOutputExpressions(node, undefined, new Set()),
        state,
      ),
      ...requestWireAuthoritiesForExpressions(
        requestJsonSerializationOutputExpressions(node, state.session),
        state,
      ),
    ]);
  }

  if (Node.isJsxElement(node) || Node.isJsxSelfClosingElement(node)) {
    return requestWireAuthoritiesForJsxElement(node, state);
  }
  if (Node.isJsxFragment(node)) {
    return requestWireAuthoritiesForJsxChildren(node.getJsxChildren(), state);
  }
  if (Node.isJsxExpression(node)) {
    const expression = node.getExpression();
    return expression ? requestWireAuthoritiesForExpression(expression, state) : [];
  }

  const carrier = requestWireCarrierForExpression(node, state, new Set(), 0);
  if (carrier) return [requestWholeWireAuthority(node, carrier)];

  if (Node.isIdentifier(node)) {
    return requestWireAuthoritiesForIdentifier(node, state);
  }

  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const receiver = node.getExpression();
    const receiverCarrier = requestWireCarrierForExpression(receiver, state, new Set(), 0);
    if (receiverCarrier) return [];
    const member = Node.isPropertyAccessExpression(node)
      ? node.getName()
      : staticMemberName(node.getArgumentExpression());
    const projected = member
      ? requestWireProjectedExpression(receiver, [member], new Set(), 0)
      : undefined;
    if (projected) return requestWireAuthoritiesForExpression(projected, state);
    if (member) {
      const classValues = requestClassFactoryMemberValues(receiver, member, state.session);
      if (classValues.length > 0) {
        return requestWireAuthoritiesForExpressions(classValues, state);
      }
    }
    const getterOutputs = member ? requestGetterOutputExpressions(receiver, member, new Set()) : [];
    if (getterOutputs.length > 0) {
      return requestWireAuthoritiesForExpressions(getterOutputs, state);
    }
    return dedupeRequestWireAuthorities([
      ...requestWireAuthoritiesForExpression(receiver, state),
      ...(Node.isElementAccessExpression(node) && node.getArgumentExpression()
        ? requestWireAuthoritiesForExpression(node.getArgumentExpression()!, state)
        : []),
    ]);
  }

  if (Node.isObjectLiteralExpression(node)) {
    const authorities: RequestWireAuthority[] = [];
    for (const property of node.getProperties()) {
      if (Node.isPropertyAssignment(property)) {
        const name = property.getNameNode();
        if (Node.isComputedPropertyName(name)) {
          authorities.push(...requestWireAuthoritiesForExpression(name.getExpression(), state));
        }
        const initializer = property.getInitializer();
        if (initializer)
          authorities.push(...requestWireAuthoritiesForExpression(initializer, state));
      } else if (Node.isShorthandPropertyAssignment(property)) {
        authorities.push(...requestWireAuthoritiesForExpression(property.getNameNode(), state));
      } else if (Node.isSpreadAssignment(property)) {
        authorities.push(...requestWireAuthoritiesForExpression(property.getExpression(), state));
      } else if (Node.isGetAccessorDeclaration(property) || Node.isMethodDeclaration(property)) {
        const name = property.getNameNode();
        if (Node.isComputedPropertyName(name)) {
          authorities.push(...requestWireAuthoritiesForExpression(name.getExpression(), state));
        }
        const body = property.getBody();
        if (!body) continue;
        const nested: RequestCallable = { body, declaration: property };
        for (const output of requestWireOutputExpressions(nested)) {
          authorities.push(...requestWireAuthoritiesForExpression(output, state));
        }
      }
    }
    return dedupeRequestWireAuthorities(authorities);
  }

  if (Node.isArrayLiteralExpression(node)) {
    return requestWireAuthoritiesForExpressions(node.getElements(), state);
  }
  if (Node.isSpreadElement(node)) {
    const iterable = node.getExpression();
    const iteration = requestWireIterationValues(iterable, state, new Set(), false);
    return dedupeRequestWireAuthorities([
      ...requestWireAuthoritiesForExpression(iterable, state),
      ...(iteration.handled
        ? requestWireAuthoritiesForIterationCandidates(iteration.candidates, [])
        : [requestOpaqueWireAuthority(iterable, 'iterator-value')]),
    ]);
  }
  if (Node.isYieldExpression(node)) {
    const yielded = node.getExpression();
    return yielded ? requestWireAuthoritiesForExpression(yielded, state) : [];
  }
  if (Node.isConditionalExpression(node)) {
    return dedupeRequestWireAuthorities([
      ...requestWireAuthoritiesForExpression(node.getCondition(), state),
      ...requestWireAuthoritiesForExpression(node.getWhenTrue(), state, routeOutcomePosition),
      ...requestWireAuthoritiesForExpression(node.getWhenFalse(), state, routeOutcomePosition),
    ]);
  }
  if (Node.isBinaryExpression(node)) {
    return requestWireAuthoritiesForExpressions([node.getLeft(), node.getRight()], state);
  }
  if (Node.isTemplateExpression(node)) {
    return requestWireAuthoritiesForExpressions(
      node.getTemplateSpans().map((span) => span.getExpression()),
      state,
    );
  }
  if (Node.isTaggedTemplateExpression(node)) {
    return dedupeRequestWireAuthorities([
      ...requestWireAuthoritiesForExpression(node.getTemplate(), state),
      ...requestWireTaggedTemplateAuthorities(node, state),
    ]);
  }
  if (Node.isPrefixUnaryExpression(node) || Node.isPostfixUnaryExpression(node)) {
    return requestWireAuthoritiesForExpression(node.getOperand(), state);
  }

  // Drizzle retains this exact zero-argument callback as schema metadata; the function object is
  // not a query result. Its expression-bodied output is separately restricted to one reviewed
  // table column by requestDrizzleReferenceCallbackIsClosed().
  if (requestDrizzleReferenceCallbackIsExactArgument(node)) return [];

  return requestExpressionIsPlainWireValue(node, state, new Set())
    ? []
    : [requestOpaqueWireAuthority(node, 'value')];
}

/**
 * Some reviewed intrinsics place a callback's return value directly on the public result path.
 * Merely traversing the callback as request-reachable execution is insufficient: an outer
 * credential alias returned from the callback must retain wire provenance (SPEC §6.6).
 * Predicate/comparator callbacks are intentionally absent because their return controls a
 * decision rather than becoming raw result data.
 */
function requestWireCallbackOutputAuthorities(
  call: import('ts-morph').CallExpression,
  callee: Node,
  invocationArguments: readonly Node[],
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  const indexes: number[] = [];
  const callbackParametersAreInput = !!(
    receiver && requestWireExpressionIsExactNativeArray(receiver, state, new Set())
  );

  if (
    receiver &&
    expressionResolvesToGlobalNamespace(receiver, 'JSON', new Set(), 0) &&
    (member === 'parse' || member === 'stringify')
  ) {
    indexes.push(1);
  } else if (
    receiver &&
    expressionResolvesToGlobalNamespace(receiver, 'Array', new Set(), 0) &&
    (member === 'from' || member === 'fromAsync')
  ) {
    indexes.push(1);
  } else if (
    receiver &&
    expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
    member === 'groupBy'
  ) {
    indexes.push(1);
  } else if (
    receiver &&
    expressionResolvesToGlobalNamespace(receiver, 'Promise', new Set(), 0) &&
    member === 'try'
  ) {
    indexes.push(0);
  } else if (
    member &&
    ['flatMap', 'map', 'reduce', 'reduceRight', 'replace', 'replaceAll'].includes(member)
  ) {
    indexes.push(member === 'replace' || member === 'replaceAll' ? 1 : 0);
  } else if (member === 'then') {
    indexes.push(0, 1);
  } else if (member === 'catch') {
    indexes.push(0);
  }

  const authorities: RequestWireAuthority[] = [];
  for (const index of indexes) {
    const callback = invocationArguments[index];
    if (!callback) continue;
    const resolution = resolveRequestCallable(callback, new Set(), 0, state.session);
    if (resolution.callables.length === 0) {
      if (
        Node.isIdentifier(callback) &&
        REQUEST_SAFE_GLOBAL_CALLABLES.has(callback.getText()) &&
        unshadowedGlobalIdentifier(callback, callback.getText())
      ) {
        continue;
      }
      authorities.push(requestOpaqueWireAuthority(callback, 'callback-result'));
      continue;
    }
    for (const nested of resolution.callables) {
      const reviewed = callbackParametersAreInput
        ? {
            ...nested,
            rootParameterRoles: requestCallableParameters(nested.declaration).map(
              () => 'input' as const,
            ),
          }
        : nested;
      const nestedState: RequestWireAnalysisState = {
        bindingKey: state.bindingKey,
        bindings: state.bindings,
        rootCallable: state.rootCallable,
        session: state.session,
        scopeCallable: reviewed,
      };
      for (const output of requestWireOutputExpressions(reviewed)) {
        authorities.push(...requestWireAuthoritiesForExpression(output, nestedState));
      }
    }
  }
  return dedupeRequestWireAuthorities(authorities);
}

/**
 * Array and object iterable consumers expose iterator-produced values on their public result.
 * Follow exact local iterators instead of treating only the iterable object as data (SPEC §6.6).
 */
function requestWireIterableConsumerAuthorities(
  call: import('ts-morph').CallExpression,
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  const callee = unwrapStaticExpression(call.getExpression());
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  if (!receiver || !member) return [];
  const asyncIteration =
    expressionResolvesToGlobalNamespace(receiver, 'Array', new Set(), 0) && member === 'fromAsync';
  const consumesIterable =
    asyncIteration ||
    (expressionResolvesToGlobalNamespace(receiver, 'Array', new Set(), 0) && member === 'from') ||
    (expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
      (member === 'fromEntries' || member === 'groupBy'));
  if (!consumesIterable) return [];

  const iterable = call.getArguments()[0];
  if (!iterable) return [];
  const iteration = requestWireIterationValues(iterable, state, new Set(), asyncIteration);
  const authorities = requestWireAuthoritiesForExpression(iterable, state);
  if (!iteration.handled) {
    authorities.push(requestOpaqueWireAuthority(iterable, 'iterator-value'));
    return dedupeRequestWireAuthorities(authorities);
  }
  authorities.push(...requestWireAuthoritiesForIterationCandidates(iteration.candidates, []));
  if (asyncIteration) {
    for (const candidate of iteration.candidates) {
      authorities.push(...requestWireThenableAuthorities(candidate.expression, candidate.state));
    }
  }
  return dedupeRequestWireAuthorities(authorities);
}

/** A reviewed intrinsic invokes these callback positions; the callback object itself is not data. */
function requestWireResultValueArguments(
  callee: Node,
  args: readonly Node[],
  state: RequestWireAnalysisState,
): Node[] {
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  if (!receiver || !member) return [...args];

  let callbackIndexes: readonly number[] = [];
  const receiverNode = unwrapStaticExpression(receiver);
  if (
    requestWireExpressionIsExactNativeArray(receiverNode, state, new Set()) &&
    [
      'every',
      'filter',
      'find',
      'findIndex',
      'findLast',
      'findLastIndex',
      'flatMap',
      'forEach',
      'map',
      'reduce',
      'reduceRight',
      'some',
      'sort',
      'toSorted',
    ].includes(member)
  ) {
    callbackIndexes = REQUEST_CALLBACK_ARGUMENTS.get(member) ?? [];
  } else if (
    expressionResolvesToGlobalNamespace(receiver, 'Array', new Set(), 0) &&
    (member === 'from' || member === 'fromAsync')
  ) {
    callbackIndexes = [1];
  } else if (
    ['then', 'catch', 'finally'].includes(member) &&
    requestExpressionIsExactNativePromise(receiver, new Set(), state.session)
  ) {
    callbackIndexes = REQUEST_CALLBACK_ARGUMENTS.get(member) ?? [];
  } else if (
    expressionResolvesToGlobalNamespace(receiver, 'JSON', new Set(), 0) &&
    (member === 'parse' || member === 'stringify')
  ) {
    callbackIndexes = [1];
  } else if (
    expressionResolvesToGlobalNamespace(receiver, 'Promise', new Set(), 0) &&
    member === 'try'
  ) {
    callbackIndexes = [0];
  } else if (
    expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
    member === 'groupBy'
  ) {
    callbackIndexes = [1];
  } else if (
    (Node.isStringLiteral(receiverNode) ||
      Node.isNoSubstitutionTemplateLiteral(receiverNode) ||
      Node.isTemplateExpression(receiverNode)) &&
    (member === 'replace' || member === 'replaceAll')
  ) {
    callbackIndexes = [1];
  }
  return args.filter((_argument, index) => !callbackIndexes.includes(index));
}

function requestWireExpressionIsExactNativeArray(
  expression: Node,
  state: RequestWireAnalysisState,
  seen: Set<string>,
): boolean {
  const node = unwrapStaticExpression(expression);
  if (Node.isArrayLiteralExpression(node)) return true;
  if (Node.isAwaitExpression(node)) {
    return requestWireExpressionIsExactNativeArray(node.getExpression(), state, new Set(seen));
  }
  if (
    Node.isCallExpression(node) &&
    requestCallIsReviewedDrizzleDbReadChainInDeclaredRoot(node, state.session)
  ) {
    return true;
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (!symbol) return false;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return false;
  seen.add(symbolKey);
  if (requestAssignedBindingProjections(symbol, state.session).length > 0) return false;
  const declarations = symbol.getDeclarations();
  return (
    declarations.length > 0 &&
    declarations.every((declaration) => {
      if (
        !Node.isVariableDeclaration(declaration) ||
        declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
      ) {
        return false;
      }
      const initializer = declaration.getInitializer();
      return (
        !!initializer && requestWireExpressionIsExactNativeArray(initializer, state, new Set(seen))
      );
    })
  );
}

function requestExpressionIsExactNativePromise(
  expression: Node,
  seen: Set<string>,
  session: RequestProvenanceSession,
): boolean {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `native-promise:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey) || !requestProvenanceStep(session, node)) return false;
  seen.add(nodeKey);
  if (Node.isNewExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    return (
      Node.isIdentifier(callee) &&
      callee.getText() === 'Promise' &&
      unshadowedGlobalIdentifier(callee, 'Promise') &&
      !requestGlobalIntrinsicBindingIsMutated('Promise', node.getSourceFile())
    );
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    if (!receiver || !member) return false;
    if (
      expressionResolvesToGlobalNamespace(receiver, 'Promise', new Set(), 0) &&
      !requestGlobalIntrinsicBindingIsMutated('Promise', node.getSourceFile()) &&
      ['all', 'allSettled', 'any', 'race', 'reject', 'resolve'].includes(member)
    ) {
      return true;
    }
    return (
      ['then', 'catch', 'finally'].includes(member) &&
      requestExpressionIsExactNativePromise(receiver, new Set(seen), session)
    );
  }
  return false;
}

function requestWireThenableAuthorities(
  expression: Node,
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  if (requestExpressionIsExactNativePromise(expression, new Set(), state.session)) return [];
  const callables = requestAccessorCallablesForExpression(
    expression,
    'then',
    new Set(),
    state.session,
  );
  if (callables.length === 0) {
    return requestExpressionIsPlainWireValue(expression, state, new Set())
      ? []
      : [requestOpaqueWireAuthority(expression, 'thenable')];
  }
  const authorities: RequestWireAuthority[] = [];
  for (const callable of dedupeRequestCallables(callables)) {
    const resolution = requestWireResolverCallableAuthorities(callable, state);
    if (!resolution.handled) continue;
    authorities.push(...resolution.authorities);
  }
  return dedupeRequestWireAuthorities(
    authorities.length > 0
      ? authorities
      : [requestOpaqueWireAuthority(expression, 'thenable-resolution')],
  );
}

interface RequestWireResolverAnalysis {
  readonly authorities: readonly RequestWireAuthority[];
  readonly handled: boolean;
}

/**
 * Promise/thenable resolution is a public-value continuation, not an ordinary callback. Follow
 * the framework-visible resolve function through local aliases so authored thenables and Promise
 * executors cannot launder a request credential behind `await` (SPEC §6.6).
 */
function requestWireResolverCallableAuthorities(
  callable: RequestCallable,
  state: RequestWireAnalysisState,
): RequestWireResolverAnalysis {
  const resolveParameter = requestCallableParameters(callable.declaration)[0];
  const resolveName = resolveParameter?.getNameNode();
  const resolveSymbol = Node.isIdentifier(resolveName) ? resolveName.getSymbol() : undefined;
  if (!resolveSymbol) return { authorities: [], handled: false };

  const target = requestSymbolKey(resolveSymbol);
  const nestedState: RequestWireAnalysisState = {
    bindingKey: state.bindingKey,
    bindings: state.bindings,
    rootCallable: state.rootCallable,
    session: state.session,
    scopeCallable: callable,
  };
  const authorities: RequestWireAuthority[] = [];
  let handled = false;
  const calls = [
    ...(Node.isCallExpression(callable.body) ? [callable.body] : []),
    ...callable.body.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  for (const call of calls) {
    if (!nodeBelongsToRequestCallable(call, callable)) continue;
    const callee = unwrapStaticExpression(call.getExpression());
    if (!requestWireExpressionResolvesToSymbol(callee, target, new Set(), 0, state.session)) {
      continue;
    }
    handled = true;
    authorities.push(...requestWireAuthoritiesForExpressions(call.getArguments(), nestedState));
    for (const argument of call.getArguments()) {
      const thenCallables = requestAccessorCallablesForExpression(
        argument,
        'then',
        new Set(),
        state.session,
      );
      if (thenCallables.length > 0) {
        authorities.push(...requestWireThenableAuthorities(argument, nestedState));
      }
    }
  }
  return { authorities: dedupeRequestWireAuthorities(authorities), handled };
}

function requestWirePromiseAssimilationAuthorities(
  call: import('ts-morph').CallExpression,
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  const callee = unwrapStaticExpression(call.getExpression());
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  if (
    !receiver ||
    !member ||
    !expressionResolvesToGlobalNamespace(receiver, 'Promise', new Set(), 0)
  ) {
    return [];
  }

  const args = call.getArguments();
  if (member === 'reject') {
    return requestWireAuthoritiesForExpressions(args, state);
  }
  if (member === 'resolve') {
    const value = args[0];
    return value
      ? dedupeRequestWireAuthorities([
          ...requestWireAuthoritiesForExpression(value, state),
          ...requestWireThenableAuthorities(value, state),
        ])
      : [];
  }
  if (!['all', 'allSettled', 'any', 'race'].includes(member)) return [];

  const iterable = args[0];
  if (!iterable || !Node.isArrayLiteralExpression(unwrapStaticExpression(iterable))) {
    return dedupeRequestWireAuthorities([
      ...requestWireAuthoritiesForExpressions(args, state),
      requestOpaqueWireAuthority(iterable ?? call, 'promise-iterable'),
    ]);
  }

  const array = unwrapStaticExpression(iterable);
  if (!Node.isArrayLiteralExpression(array)) {
    return [requestOpaqueWireAuthority(iterable, 'promise-iterable')];
  }
  const authorities: RequestWireAuthority[] = [];
  for (const element of array.getElements()) {
    if (Node.isOmittedExpression(element)) continue;
    if (Node.isSpreadElement(element)) {
      authorities.push(...requestWireAuthoritiesForExpression(element.getExpression(), state));
      if (!requestExpressionIsPlainWireValue(element.getExpression(), state, new Set())) {
        authorities.push(requestOpaqueWireAuthority(element, 'promise-iterable'));
      }
      continue;
    }
    authorities.push(...requestWireAuthoritiesForExpression(element, state));
    authorities.push(...requestWireThenableAuthorities(element, state));
  }
  return dedupeRequestWireAuthorities(authorities);
}

function requestWirePromiseExecutorAuthorities(
  construct: import('ts-morph').NewExpression,
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  const callee = unwrapStaticExpression(construct.getExpression());
  if (
    !Node.isIdentifier(callee) ||
    callee.getText() !== 'Promise' ||
    !unshadowedGlobalIdentifier(callee, 'Promise')
  ) {
    return [];
  }

  const executor = construct.getArguments()[0];
  if (!executor) return [requestOpaqueWireAuthority(construct, 'promise-executor')];
  const resolution = resolveRequestCallable(executor, new Set(), 0, state.session);
  if (resolution.callables.length === 0) {
    return [requestOpaqueWireAuthority(executor, 'promise-executor')];
  }
  const authorities: RequestWireAuthority[] = [];
  let handled = false;
  for (const callable of resolution.callables) {
    const result = requestWireResolverCallableAuthorities(callable, state);
    handled ||= result.handled;
    authorities.push(...result.authorities);
  }
  if (!handled) authorities.push(requestOpaqueWireAuthority(executor, 'promise-executor'));
  return dedupeRequestWireAuthorities(authorities);
}

function requestWireTaggedTemplateAuthorities(
  tagged: import('ts-morph').TaggedTemplateExpression,
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  const tag = tagged.getTag();
  const resolution = resolveRequestCallable(tag, new Set(), 0, state.session);
  if (resolution.callables.length === 0) {
    const safeStringRaw =
      Node.isPropertyAccessExpression(tag) &&
      tag.getName() === 'raw' &&
      expressionResolvesToGlobalNamespace(tag.getExpression(), 'String', new Set(), 0);
    return safeStringRaw ? [] : [requestOpaqueWireAuthority(tagged, 'tag-result')];
  }
  const authorities: RequestWireAuthority[] = [];
  for (const callable of resolution.callables) {
    const nestedState: RequestWireAnalysisState = {
      bindingKey: state.bindingKey,
      bindings: state.bindings,
      rootCallable: state.rootCallable,
      session: state.session,
      scopeCallable: callable,
    };
    for (const output of requestWireOutputExpressions(callable)) {
      authorities.push(...requestWireAuthoritiesForExpression(output, nestedState));
    }
  }
  return dedupeRequestWireAuthorities(authorities);
}

function requestExpressionIsPlainWireValue(
  expression: Node,
  state: RequestWireAnalysisState,
  seen: Set<string>,
): boolean {
  const node = unwrapStaticExpression(expression);
  const key = `plain-wire:${requestNodeIdentity(node)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isNumericLiteral(node) ||
    Node.isBigIntLiteral(node) ||
    Node.isTrueLiteral(node) ||
    Node.isFalseLiteral(node) ||
    node.getKind() === SyntaxKind.NullKeyword ||
    Node.isTemplateExpression(node) ||
    Node.isPrefixUnaryExpression(node) ||
    Node.isPostfixUnaryExpression(node) ||
    Node.isTypeOfExpression(node)
  ) {
    return true;
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node
      .getElements()
      .every((element) =>
        Node.isOmittedExpression(element)
          ? true
          : requestExpressionIsPlainWireValue(
              Node.isSpreadElement(element) ? element.getExpression() : element,
              state,
              new Set(seen),
            ),
      );
  }
  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().every((property) => {
      if (Node.isPropertyAssignment(property)) {
        if (Node.isComputedPropertyName(property.getNameNode())) return false;
        const initializer = property.getInitializer();
        return (
          !!initializer && requestExpressionIsPlainWireValue(initializer, state, new Set(seen))
        );
      }
      if (Node.isShorthandPropertyAssignment(property)) {
        return requestExpressionIsPlainWireValue(property.getNameNode(), state, new Set(seen));
      }
      return false;
    });
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    if (requestExpressionIsReviewedFrozenStyleValue(node)) return true;
    const role =
      requestExpressionRootParameterRole(node, state.rootCallable, new Set(), 0) ??
      requestExpressionRootParameterRole(node, state.scopeCallable, new Set(), 0);
    return role === 'request' || requestRootRoleIncludesInput(role);
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    if (
      Node.isIdentifier(callee) &&
      ['Boolean', 'Number', 'String'].includes(callee.getText()) &&
      unshadowedGlobalIdentifier(callee, callee.getText())
    ) {
      return true;
    }
    if (requestCallIsPublicStyleCreate(node)) return true;
    if (requestCallIsReviewedDrizzleDbReadChainInDeclaredRoot(node, state.session)) return true;
    if (
      receiver &&
      expressionResolvesToGlobalNamespace(receiver, 'Promise', new Set(), 0) &&
      ['all', 'allSettled', 'any', 'race', 'reject', 'resolve'].includes(member ?? '')
    ) {
      return node
        .getArguments()
        .every((argument) => requestExpressionIsPlainWireValue(argument, state, new Set(seen)));
    }
    if (requestCallIsGovernedFetch(node)) return true;
    if (
      receiver &&
      member &&
      (REQUEST_SAFE_FETCH_RESPONSE_METHODS.has(member) || REQUEST_SAFE_REQUEST_METHODS.has(member))
    ) {
      return true;
    }
    if (receiver && requestExpressionContainsClosedAuthority(receiver, new Set(), 0)) {
      return true;
    }
  }
  if (Node.isNewExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    return !!(
      Node.isIdentifier(callee) &&
      callee.getText() === 'Array' &&
      unshadowedGlobalIdentifier(callee, callee.getText())
    );
  }
  if (!Node.isIdentifier(node)) return false;
  if (unshadowedGlobalIdentifier(node, 'undefined')) return true;
  if (requestIdentifierIsImportedMutableContainer(node)) return false;
  const carrier = requestWireCarrierForExpression(node, state, new Set(), 0);
  if (carrier) return false;
  const symbol = requestIdentifierValueSymbol(node);
  if (!symbol) return false;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return false;
  seen.add(symbolKey);
  const declarations = symbol.getDeclarations();
  const initializers = declarations
    .map(valueDeclarationInitializer)
    .filter((initializer): initializer is Node => initializer !== undefined);
  return (
    initializers.length > 0 &&
    initializers.every((initializer) =>
      requestExpressionIsPlainWireValue(initializer, state, new Set(seen)),
    )
  );
}

function requestWireAuthoritiesForJsxElement(
  element: import('ts-morph').JsxElement | import('ts-morph').JsxSelfClosingElement,
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  const tag = requestJsxTagNameNode(element);
  if (!tag) return [requestOpaqueWireAuthority(element, 'jsx-tag')];
  const opening = Node.isJsxElement(element) ? element.getOpeningElement() : element;
  const children = Node.isJsxElement(element) ? element.getJsxChildren() : [];
  if (requestJsxTagIsIntrinsic(tag)) {
    return dedupeRequestWireAuthorities([
      ...requestWireAuthoritiesForJsxAttributes(opening.getAttributes(), state),
      ...requestWireAuthoritiesForJsxChildren(children, state),
    ]);
  }
  if (requestJsxTagIsReviewedPublicComponent(tag)) {
    return requestWireAuthoritiesForReviewedFormError(element, state);
  }

  const resolution = resolveRequestCallable(tag, new Set(), 0, state.session);
  if (resolution.callables.length === 0) {
    return [requestOpaqueWireAuthority(element, 'jsx-component')];
  }
  const authorities: RequestWireAuthority[] = [];
  for (const callable of resolution.callables) {
    const bindings = requestWireBindingsForJsxComponent(callable, element, state.bindings);
    const nestedState: RequestWireAnalysisState = {
      bindingKey: requestWireBindingKey(bindings),
      bindings,
      rootCallable: state.rootCallable,
      session: state.session,
      scopeCallable: callable,
    };
    for (const output of requestWireOutputExpressions(callable)) {
      authorities.push(...requestWireAuthoritiesForExpression(output, nestedState));
    }
  }
  return dedupeRequestWireAuthorities(authorities);
}

function requestWireAuthoritiesForReviewedFormError(
  element: import('ts-morph').JsxElement | import('ts-morph').JsxSelfClosingElement,
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  const opening = Node.isJsxElement(element) ? element.getOpeningElement() : element;
  const authorities: RequestWireAuthority[] = [];
  const add = (name: string, value: Node): void => {
    if (name === 'message' || name === 'children') {
      authorities.push(...requestWireAuthoritiesForReviewedFormErrorMessage(value, state));
      return;
    }
    if (name === 'failure') {
      const code = requestWireProjectedExpression(value, ['code'], new Set(), 0);
      if (code) authorities.push(...requestWireAuthoritiesForExpression(code, state));
      else if (!requestExpressionIsPlainWireValue(value, state, new Set())) {
        authorities.push(requestOpaqueWireAuthority(value, 'form-error-failure'));
      }
      return;
    }
    if (['class', 'code', 'id', 'role'].includes(name)) {
      authorities.push(...requestWireAuthoritiesForExpression(value, state));
      return;
    }
    // Compiler-owned mutation/result carriers select server-side form state; they are not emitted.
    if (name === 'mutation' || name === 'result') return;
    // FormErrorProps intentionally has an index signature. Unknown current/future props must not
    // become an untracked output channel merely because today's renderer ignores them.
    authorities.push(...requestWireAuthoritiesForExpression(value, state));
  };

  for (const attribute of opening.getAttributes()) {
    if (Node.isJsxSpreadAttribute(attribute)) {
      const spread = resolveStaticObjectLiteral(attribute.getExpression(), new Set(), 0);
      if (!spread) {
        authorities.push(...requestWireAuthoritiesForExpression(attribute.getExpression(), state));
        continue;
      }
      for (const property of spread.getProperties()) {
        const name = staticMemberName(requestObjectLiteralElementNameNode(property));
        const value = requestHandlerPropertyExpression(property);
        if (name && value) add(name, value);
        else if (Node.isSpreadAssignment(property)) {
          authorities.push(...requestWireAuthoritiesForExpression(property.getExpression(), state));
        }
      }
      continue;
    }
    const name = attribute.getNameNode().getText();
    const initializer = attribute.getInitializer();
    if (!initializer) continue;
    if (Node.isJsxExpression(initializer)) {
      const value = initializer.getExpression();
      if (value) add(name, value);
    }
  }
  if (Node.isJsxElement(element)) {
    for (const child of element.getJsxChildren()) {
      if (Node.isJsxText(child)) continue;
      const value = Node.isJsxExpression(child) ? child.getExpression() : child;
      if (value) add('children', value);
    }
  }
  return dedupeRequestWireAuthorities(authorities);
}

function requestWireAuthoritiesForReviewedFormErrorMessage(
  value: Node,
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  const resolution = resolveRequestCallable(value, new Set(), 0, state.session);
  if (resolution.callables.length === 0) {
    return requestWireAuthoritiesForExpression(value, state);
  }
  const authorities: RequestWireAuthority[] = [];
  for (const callable of resolution.callables) {
    const reviewed: RequestCallable = {
      ...callable,
      rootParameterRoles: requestCallableParameters(callable.declaration).map(() => 'input'),
    };
    const nestedState: RequestWireAnalysisState = {
      bindingKey: state.bindingKey,
      bindings: state.bindings,
      rootCallable: state.rootCallable,
      scopeCallable: reviewed,
      session: state.session,
    };
    for (const output of requestWireOutputExpressions(reviewed)) {
      authorities.push(...requestWireAuthoritiesForExpression(output, nestedState));
    }
  }
  return dedupeRequestWireAuthorities(authorities);
}

function requestWireAuthoritiesForJsxAttributes(
  attributes: readonly import('ts-morph').JsxAttributeLike[],
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  const authorities: RequestWireAuthority[] = [];
  for (const attribute of attributes) {
    if (Node.isJsxSpreadAttribute(attribute)) {
      authorities.push(...requestWireAuthoritiesForExpression(attribute.getExpression(), state));
      continue;
    }
    const initializer = attribute.getInitializer();
    if (initializer && Node.isJsxExpression(initializer)) {
      const expression = initializer.getExpression();
      if (
        expression &&
        !(
          state.scopeCallable.compilerOwnedJsxEventHandlers &&
          requestJsxAttributeIsCompilerOwnedEventHandler(attribute) &&
          requestJsxEventHandlerIsAuthoredInCallable(expression, state.scopeCallable, state.session)
        )
      ) {
        authorities.push(...requestWireAuthoritiesForExpression(expression, state));
      }
    }
  }
  return dedupeRequestWireAuthorities(authorities);
}

function requestJsxEventHandlerIsAuthoredInCallable(
  expression: Node,
  callable: RequestCallable,
  session: RequestProvenanceSession,
): boolean {
  const resolution = resolveRequestCallable(expression, new Set(), 0, session);
  return (
    resolution.callables.length > 0 &&
    resolution.callables.every((candidate) =>
      nodeBelongsToRequestCallable(candidate.declaration, callable),
    )
  );
}

function requestJsxAttributeIsCompilerOwnedEventHandler(
  attribute: import('ts-morph').JsxAttribute,
): boolean {
  // Keep this grammar identical to the typed parser fact in
  // packages/compiler/src/scan/parse.ts. Lower-case `onclick`, `on:*`, spreads, component props,
  // and local lookalikes remain ordinary wire values and therefore fail closed here.
  return /^on[A-Z][A-Za-z0-9]*$/u.test(attribute.getNameNode().getText());
}

function requestWireAuthoritiesForJsxChildren(
  children: readonly import('ts-morph').JsxChild[],
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  const authorities: RequestWireAuthority[] = [];
  for (const child of children) {
    if (Node.isJsxText(child)) continue;
    authorities.push(...requestWireAuthoritiesForExpression(child, state));
  }
  return dedupeRequestWireAuthorities(authorities);
}

function requestWireBindingsForJsxComponent(
  callable: RequestCallable,
  element: import('ts-morph').JsxElement | import('ts-morph').JsxSelfClosingElement,
  inherited: ReadonlyMap<string, RequestWireBinding>,
): ReadonlyMap<string, RequestWireBinding> {
  const bindings = new Map(inherited);
  const parameter = requestCallableParameters(callable.declaration)[0];
  if (parameter) {
    requestWireCollectPatternBindings(parameter.getNameNode(), element, [], bindings);
  }
  return bindings;
}

function requestWireAuthoritiesForExpressions(
  expressions: readonly Node[],
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  return dedupeRequestWireAuthorities(
    expressions.flatMap((expression) => requestWireAuthoritiesForExpression(expression, state)),
  );
}

function requestWireAuthoritiesForIdentifier(
  identifier: Node,
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  if (!Node.isIdentifier(identifier)) return [];
  const parent = identifier.getParent();
  const symbol = Node.isShorthandPropertyAssignment(parent)
    ? (parent.getValueSymbol() ?? identifier.getSymbol())
    : identifier.getSymbol();
  const symbolKey = symbol ? requestSymbolKey(symbol) : undefined;
  if (symbolKey) {
    const binding = state.bindings.get(symbolKey);
    if (binding) {
      const projected = requestWireProjectedExpression(
        binding.expression,
        binding.path,
        new Set(),
        0,
      );
      if (projected) return requestWireAuthoritiesForExpression(projected, state);
      const boundCarrier = requestWireCarrierForBoundValue(binding, state);
      if (boundCarrier) return [requestWholeWireAuthority(identifier, boundCarrier)];
    }
  }

  const iterationAuthority = requestWireHeaderIterationAuthority(identifier, state);
  if (iterationAuthority) return [iterationAuthority];
  const iteration = requestWireIterationBindingAuthorities(identifier, state);
  if (iteration.handled) return [...iteration.authorities];

  const authorities: RequestWireAuthority[] = [];
  const catchBinding = requestWireCatchBindingAuthorities(identifier, state);
  if (catchBinding.handled) authorities.push(...catchBinding.authorities);
  authorities.push(
    ...requestWireAuthoritiesForExpressions(
      requestJsonSerializationOutputExpressions(identifier, state.session),
      state,
    ),
  );
  const declarations = symbol?.getDeclarations() ?? [];
  for (const declaration of declarations) {
    if (Node.isBindingElement(declaration)) {
      const destructuredIteration = requestWireDestructuredIterationAuthorities(
        identifier,
        declaration,
        state,
      );
      if (destructuredIteration.handled) {
        authorities.push(...destructuredIteration.authorities);
        continue;
      }
      const projection = requestBindingElementProjection(declaration);
      if (projection) {
        authorities.push(...requestWireAuthoritiesForBindingProjection(projection, state));
      }
      const fallback = declaration.getInitializer();
      if (fallback) {
        authorities.push(...requestWireAuthoritiesForExpression(fallback, state));
      }
      continue;
    }
    const initializer = valueDeclarationInitializer(declaration);
    if (initializer) authorities.push(...requestWireAuthoritiesForExpression(initializer, state));
  }
  if (declarations.length === 0) {
    const declaration = localValueDeclaration(identifier);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) authorities.push(...requestWireAuthoritiesForExpression(initializer, state));
  }

  if (symbolKey && Node.isBlock(state.scopeCallable.body)) {
    authorities.push(...requestWireAuthoritiesWrittenToSymbol(symbolKey, state));
    for (const projection of requestAssignedBindingProjections(symbol!, state.session)) {
      const destructured = requestWireAssignedDestructuredIterationAuthorities(projection, state);
      if (destructured.handled) {
        authorities.push(...destructured.authorities);
        continue;
      }
      authorities.push(...requestWireAuthoritiesForBindingProjection(projection, state));
    }
  }
  return dedupeRequestWireAuthorities(authorities);
}

function requestWireAssignedDestructuredIterationAuthorities(
  projection: RequestAssignedBindingProjection,
  state: RequestWireAnalysisState,
): RequestWireIterationAuthorities {
  const assignment = projection.expression.getParentIfKind(SyntaxKind.BinaryExpression);
  if (
    !assignment ||
    assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken ||
    !requestNodesAreSame(assignment.getRight(), projection.expression) ||
    !Node.isArrayLiteralExpression(unwrapStaticExpression(assignment.getLeft()))
  ) {
    return { authorities: [], handled: false };
  }
  const index = projection.path[0] === undefined ? undefined : Number(projection.path[0]);
  if (index === undefined || !Number.isSafeInteger(index) || index < 0) {
    return {
      authorities: [requestOpaqueWireAuthority(projection.expression, 'iterator-binding')],
      handled: true,
    };
  }
  const iteration = requestWireIterationValues(projection.expression, state, new Set(), false);
  if (!iteration.handled) {
    return {
      authorities: [requestOpaqueWireAuthority(projection.expression, 'iterator-value')],
      handled: true,
    };
  }
  const candidate = iteration.candidates[index];
  return {
    authorities: candidate
      ? requestWireAuthoritiesForIterationCandidates([candidate], projection.path.slice(1))
      : [],
    handled: true,
  };
}

interface RequestWireCatchBindingResult {
  readonly authorities: readonly RequestWireAuthority[];
  readonly handled: boolean;
}

function requestWireCatchBindingAuthorities(
  identifier: import('ts-morph').Identifier,
  state: RequestWireAnalysisState,
): RequestWireCatchBindingResult {
  const symbol = identifier.getSymbol();
  if (!symbol) return { authorities: [], handled: false };
  const authorities: RequestWireAuthority[] = [];
  let handled = false;
  for (const declaration of symbol.getDeclarations()) {
    const catchClause = declaration.getFirstAncestorByKind(SyntaxKind.CatchClause);
    if (!catchClause) continue;
    const variable = catchClause.getVariableDeclaration();
    if (!variable) continue;
    const path = requestPatternPathForIdentifier(variable.getNameNode(), identifier, []);
    if (!path) continue;
    handled = true;
    const tryStatement = catchClause.getParentIfKind(SyntaxKind.TryStatement);
    const thrown = tryStatement
      ? requestThrownExpressionsForReachableBlock(tryStatement.getTryBlock(), state, new Set())
      : [];
    if (thrown.length === 0) {
      authorities.push(requestOpaqueWireAuthority(identifier, 'catch-binding'));
      continue;
    }
    for (const expression of thrown) {
      const before = authorities.length;
      authorities.push(...requestWireAuthoritiesForBindingProjection({ expression, path }, state));
      if (
        authorities.length === before &&
        !requestExpressionIsPlainWireValue(expression, state, new Set())
      ) {
        authorities.push(requestOpaqueWireAuthority(expression, 'catch-value'));
      }
    }
  }
  return { authorities: dedupeRequestWireAuthorities(authorities), handled };
}

function requestPatternPathForIdentifier(
  pattern: Node,
  target: import('ts-morph').Identifier,
  path: readonly string[],
): readonly string[] | undefined {
  if (Node.isIdentifier(pattern)) {
    const patternSymbol = pattern.getSymbol();
    const targetSymbol = target.getSymbol();
    return patternSymbol &&
      targetSymbol &&
      requestSymbolKey(patternSymbol) === requestSymbolKey(targetSymbol)
      ? path
      : undefined;
  }
  if (!Node.isObjectBindingPattern(pattern) && !Node.isArrayBindingPattern(pattern)) {
    return undefined;
  }
  for (const [index, element] of pattern.getElements().entries()) {
    if (Node.isOmittedExpression(element)) continue;
    const rest = element.getDotDotDotToken() !== undefined;
    const member = Node.isObjectBindingPattern(pattern)
      ? requestCallableMemberName(element.getPropertyNameNode() ?? element.getNameNode())
      : String(index);
    const resolved = requestPatternPathForIdentifier(
      element.getNameNode(),
      target,
      rest || member === undefined ? path : [...path, member],
    );
    if (resolved) return resolved;
  }
  return undefined;
}

function requestThrownExpressionsForReachableBlock(
  block: Node,
  state: RequestWireAnalysisState,
  seen: Set<string>,
): Node[] {
  const key = `throws:${requestNodeIdentity(block)}`;
  if (seen.has(key) || !requestProvenanceStep(state.session, block)) return [];
  seen.add(key);
  const expressions: Node[] = [];
  for (const statement of block.getDescendantsOfKind(SyntaxKind.ThrowStatement)) {
    if (!requestNodeBelongsToLexicalBody(statement, block)) continue;
    const expression = statement.getExpression();
    if (expression) expressions.push(expression);
  }
  for (const call of block.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!requestNodeBelongsToLexicalBody(call, block)) continue;
    for (const callable of resolveRequestCallable(
      requestNormalizedCall(call).target,
      new Set(),
      0,
      state.session,
    ).callables) {
      expressions.push(
        ...requestThrownExpressionsForReachableBlock(callable.body, state, new Set(seen)),
      );
    }
  }
  return dedupeRequestNodes(expressions);
}

function requestNodeBelongsToLexicalBody(node: Node, body: Node): boolean {
  for (const ancestor of node.getAncestors()) {
    if (ancestor === body) return true;
    if (requestCallableForFunctionNode(ancestor)) return false;
  }
  return false;
}

function requestWireAuthoritiesForBindingProjection(
  projection: RequestAssignedBindingProjection,
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  let candidates: Node[] = [projection.expression];
  const authorities: RequestWireAuthority[] = [];
  for (const member of projection.path) {
    const next: Node[] = [];
    for (const candidate of candidates) {
      const getterOutputs = requestGetterOutputExpressions(candidate, member, new Set());
      authorities.push(...requestWireAuthoritiesForExpressions(getterOutputs, state));
      next.push(...getterOutputs);
      const projected = requestWireProjectedExpression(candidate, [member], new Set(), 0);
      if (projected) next.push(projected);
      // SPEC §6.6: binding-pattern projection must not erase governed server authority. Exact
      // runCommand/rootedFiles results are opaque on public wires even when authored code selects
      // a property through one-step or aliased destructuring rather than ordinary member access.
      if (
        getterOutputs.length === 0 &&
        !projected &&
        requestExpressionContainsExactFrameworkNativePromise(candidate, new Set())
      ) {
        authorities.push(...requestWireAuthoritiesForExpression(candidate, state));
      }
    }
    candidates = dedupeRequestNodes(next);
    if (candidates.length === 0) break;
  }
  if (projection.path.length === 0) {
    authorities.push(...requestWireAuthoritiesForExpression(projection.expression, state));
  } else {
    authorities.push(...requestWireAuthoritiesForExpressions(candidates, state));
  }
  return dedupeRequestWireAuthorities(authorities);
}

function requestWireAuthoritiesWrittenToSymbol(
  symbolKey: string,
  state: RequestWireAnalysisState,
): RequestWireAuthority[] {
  if (!Node.isBlock(state.scopeCallable.body)) return [];
  const scanKey = `${requestWireStateKey('write', state.scopeCallable.declaration, state)}:${symbolKey}`;
  const memoized = state.session.writeMemo.get(scanKey);
  if (memoized) return [...memoized];
  if (state.session.writeActive.has(scanKey)) return [];
  if (!requestProvenanceStep(state.session, state.scopeCallable.declaration)) {
    return [requestProvenanceBudgetAuthority(state.scopeCallable.declaration)];
  }
  state.session.writeActive.add(scanKey);
  const authorities: RequestWireAuthority[] = [];
  for (const assignment of state.scopeCallable.body.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  )) {
    if (
      assignment.getOperatorToken().getKind() >= SyntaxKind.FirstAssignment &&
      assignment.getOperatorToken().getKind() <= SyntaxKind.LastAssignment &&
      requestWireMutationTargetResolvesToSymbol(assignment.getLeft(), symbolKey)
    ) {
      authorities.push(
        ...requestWireAuthoritiesForExpressions(
          requestWireComputedMutationKeys(assignment.getLeft()),
          state,
        ),
      );
      authorities.push(...requestWireAuthoritiesForExpression(assignment.getRight(), state));
    }
  }
  for (const call of state.scopeCallable.body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrapStaticExpression(call.getExpression());
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    const mutatesReceiver =
      !!receiver &&
      requestWireMutationTargetResolvesToSymbol(receiver, symbolKey) &&
      !!member &&
      ['add', 'append', 'push', 'set', 'unshift'].includes(member);
    const objectAssigns =
      member === 'assign' &&
      !!receiver &&
      expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
      call.getArguments()[0] !== undefined &&
      requestWireMutationTargetResolvesToSymbol(call.getArguments()[0]!, symbolKey);
    const globalDefinesOrSets =
      !!member &&
      !!receiver &&
      (expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) ||
        expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0)) &&
      ['defineProperties', 'defineProperty', 'set', 'setPrototypeOf'].includes(member) &&
      call.getArguments()[0] !== undefined &&
      requestWireMutationTargetResolvesToSymbol(call.getArguments()[0]!, symbolKey);
    if (mutatesReceiver) {
      authorities.push(...requestWireAuthoritiesForExpressions(call.getArguments(), state));
      continue;
    }
    if (objectAssigns) {
      authorities.push(
        ...requestWireAuthoritiesForExpressions(call.getArguments().slice(1), state),
      );
      continue;
    }
    if (globalDefinesOrSets) {
      authorities.push(
        ...requestWireAuthoritiesForExpressions(call.getArguments().slice(1), state),
      );
      continue;
    }

    for (const [index, argument] of call.getArguments().entries()) {
      if (!requestWireExpressionResolvesToSymbol(argument, symbolKey, new Set(), 0)) continue;
      const resolution = resolveRequestCallable(callee, new Set(), 0, state.session);
      for (const nested of resolution.callables) {
        const parameter = requestCallableParameters(nested.declaration)[index];
        const name = parameter?.getNameNode();
        if (!name || !Node.isIdentifier(name) || !name.getSymbol()) continue;
        const bindings = requestWireBindingsForCall(nested, call.getArguments(), state.bindings);
        authorities.push(
          ...requestWireAuthoritiesWrittenToSymbol(requestSymbolKey(name.getSymbol()!), {
            bindingKey: requestWireBindingKey(bindings),
            bindings,
            rootCallable: state.rootCallable,
            session: state.session,
            scopeCallable: nested,
          }),
        );
      }
    }
  }
  state.session.writeActive.delete(scanKey);
  const result = dedupeRequestWireAuthorities(authorities);
  state.session.writeMemo.set(scanKey, result);
  return result;
}

function requestWireComputedMutationKeys(expression: Node): Node[] {
  const keys: Node[] = [];
  let node = unwrapStaticExpression(expression);
  while (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    if (Node.isElementAccessExpression(node)) {
      const argument = node.getArgumentExpression();
      if (argument) keys.push(argument);
    }
    node = unwrapStaticExpression(node.getExpression());
  }
  return keys;
}

interface RequestWireIterationCandidate {
  readonly expression: Node;
  readonly state: RequestWireAnalysisState;
}

interface RequestWireIterationValues {
  readonly candidates: readonly RequestWireIterationCandidate[];
  readonly handled: boolean;
}

interface RequestWireIterationAuthorities {
  readonly authorities: readonly RequestWireAuthority[];
  readonly handled: boolean;
}

function requestWireAuthoritiesForIterationCandidates(
  candidates: readonly RequestWireIterationCandidate[],
  path: readonly string[],
): RequestWireAuthority[] {
  return dedupeRequestWireAuthorities(
    candidates.flatMap((candidate) =>
      requestWireAuthoritiesForBindingProjection(
        { expression: candidate.expression, path },
        candidate.state,
      ),
    ),
  );
}

function requestWireIterationBindingAuthorities(
  identifier: import('ts-morph').Identifier,
  state: RequestWireAnalysisState,
): RequestWireIterationAuthorities {
  const authorities: RequestWireAuthority[] = [];
  let handled = false;
  for (const declaration of identifier.getSymbol()?.getDeclarations() ?? []) {
    const variable = Node.isVariableDeclaration(declaration)
      ? declaration
      : declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    const loop = variable?.getFirstAncestorByKind(SyntaxKind.ForOfStatement);
    if (!variable || !loop) continue;
    const path = requestPatternPathForIdentifier(variable.getNameNode(), identifier, []);
    if (!path) continue;
    handled = true;
    const iterable = loop.getExpression();
    const iteration = requestWireIterationValues(
      iterable,
      state,
      new Set(),
      loop.getAwaitKeyword() !== undefined,
    );
    if (!iteration.handled) {
      authorities.push(requestOpaqueWireAuthority(iterable, 'iterator-value'));
      continue;
    }
    authorities.push(...requestWireAuthoritiesForIterationCandidates(iteration.candidates, path));
    if (loop.getAwaitKeyword()) {
      for (const candidate of iteration.candidates) {
        authorities.push(...requestWireThenableAuthorities(candidate.expression, candidate.state));
      }
    }
  }
  return { authorities: dedupeRequestWireAuthorities(authorities), handled };
}

function requestWireDestructuredIterationAuthorities(
  identifier: import('ts-morph').Identifier,
  declaration: import('ts-morph').BindingElement,
  state: RequestWireAnalysisState,
): RequestWireIterationAuthorities {
  const variable = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  const initializer = variable?.getInitializer();
  const name = variable?.getNameNode();
  if (!variable || !initializer || !name || !Node.isArrayBindingPattern(name)) {
    return { authorities: [], handled: false };
  }
  const path = requestPatternPathForIdentifier(name, identifier, []);
  const index = path?.[0] === undefined ? undefined : Number(path[0]);
  if (!path || index === undefined || !Number.isSafeInteger(index) || index < 0) {
    return {
      authorities: [requestOpaqueWireAuthority(initializer, 'iterator-binding')],
      handled: true,
    };
  }
  const iteration = requestWireIterationValues(initializer, state, new Set(), false);
  if (!iteration.handled) {
    return {
      authorities: [requestOpaqueWireAuthority(initializer, 'iterator-value')],
      handled: true,
    };
  }
  const candidate = iteration.candidates[index];
  return {
    authorities: candidate
      ? requestWireAuthoritiesForIterationCandidates([candidate], path.slice(1))
      : [],
    handled: true,
  };
}

function requestWireIterationValues(
  expression: Node,
  state: RequestWireAnalysisState,
  seen: Set<string>,
  asyncIteration: boolean,
): RequestWireIterationValues {
  const node = unwrapStaticExpression(expression);
  const key = `wire-iteration:${requestNodeIdentity(node)}:${asyncIteration ? 'async' : 'sync'}:${state.bindingKey}`;
  if (seen.has(key) || !requestProvenanceStep(state.session, node)) {
    return { candidates: [], handled: false };
  }
  seen.add(key);

  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return { candidates: [], handled: true };
  }
  if (Node.isTemplateExpression(node)) {
    return { candidates: [{ expression: node, state }], handled: true };
  }
  if (Node.isArrayLiteralExpression(node)) {
    const candidates: RequestWireIterationCandidate[] = [];
    for (const element of node.getElements()) {
      if (Node.isOmittedExpression(element)) continue;
      if (!Node.isSpreadElement(element)) {
        candidates.push({ expression: element, state });
        continue;
      }
      const spread = requestWireIterationValues(
        element.getExpression(),
        state,
        new Set(seen),
        false,
      );
      if (!spread.handled) return { candidates, handled: false };
      candidates.push(...spread.candidates);
    }
    return { candidates, handled: true };
  }
  if (Node.isConditionalExpression(node)) {
    const whenTrue = requestWireIterationValues(
      node.getWhenTrue(),
      state,
      new Set(seen),
      asyncIteration,
    );
    const whenFalse = requestWireIterationValues(
      node.getWhenFalse(),
      state,
      new Set(seen),
      asyncIteration,
    );
    return {
      candidates: [...whenTrue.candidates, ...whenFalse.candidates],
      handled: whenTrue.handled && whenFalse.handled,
    };
  }
  if (Node.isCallExpression(node)) {
    const invocation = requestNormalizedCall(node);
    const resolution = resolveRequestCallable(invocation.target, new Set(), 0, state.session);
    if (resolution.callables.length > 0) {
      const candidates: RequestWireIterationCandidate[] = [];
      let handled = true;
      for (const callable of resolution.callables) {
        const bindings = requestWireBindingsForCall(
          callable,
          invocation.args ?? node.getArguments(),
          state.bindings,
        );
        const nestedState: RequestWireAnalysisState = {
          bindingKey: requestWireBindingKey(bindings),
          bindings,
          rootCallable: state.rootCallable,
          session: state.session,
          scopeCallable: callable,
        };
        const yielded = requestWireYieldedIterationValues(
          callable,
          nestedState,
          new Set(seen),
          asyncIteration,
        );
        if (yielded.handled) {
          candidates.push(...yielded.candidates);
          continue;
        }
        const outputs = requestWireOutputExpressions(callable);
        if (outputs.length === 0) {
          handled = false;
          continue;
        }
        for (const output of outputs) {
          const returned = requestWireIterationValues(
            output,
            nestedState,
            new Set(seen),
            asyncIteration,
          );
          handled &&= returned.handled;
          candidates.push(...returned.candidates);
        }
      }
      return { candidates, handled };
    }
  }
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol();
    const symbolKey = symbol ? requestSymbolKey(symbol) : undefined;
    const binding = symbolKey ? state.bindings.get(symbolKey) : undefined;
    if (binding) {
      const projected = requestWireProjectedExpression(
        binding.expression,
        binding.path,
        new Set(),
        0,
      );
      if (projected) {
        return requestWireIterationValues(projected, state, new Set(seen), asyncIteration);
      }
    }
    const initializers = symbol
      ? symbol
          .getDeclarations()
          .map(valueDeclarationInitializer)
          .filter((initializer): initializer is Node => initializer !== undefined)
      : [];
    if (initializers.length > 0) {
      const results = initializers.map((initializer) =>
        requestWireIterationValues(initializer, state, new Set(seen), asyncIteration),
      );
      return {
        candidates: results.flatMap((result) => result.candidates),
        handled: results.every((result) => result.handled),
      };
    }
    if (
      requestRootRoleIncludesInput(
        requestExpressionRootParameterRole(node, state.rootCallable, new Set(), 0),
      )
    ) {
      return { candidates: [], handled: true };
    }
  }

  if (
    requestRootRoleIncludesInput(
      requestExpressionRootParameterRole(node, state.rootCallable, new Set(), 0),
    )
  ) {
    return { candidates: [], handled: true };
  }

  const hooks = asyncIteration ? ['@@asyncIterator', '@@iterator'] : ['@@iterator'];
  const callables = dedupeRequestCallables(
    hooks.flatMap((hook) =>
      requestAccessorCallablesForExpression(node, hook, new Set(), state.session),
    ),
  );
  if (callables.length === 0) return { candidates: [], handled: false };
  const candidates: RequestWireIterationCandidate[] = [];
  let handled = true;
  for (const callable of callables) {
    const nestedState: RequestWireAnalysisState = {
      bindingKey: state.bindingKey,
      bindings: state.bindings,
      rootCallable: state.rootCallable,
      session: state.session,
      scopeCallable: callable,
    };
    const yielded = requestWireYieldedIterationValues(
      callable,
      nestedState,
      new Set(seen),
      asyncIteration,
    );
    handled &&= yielded.handled;
    candidates.push(...yielded.candidates);
  }
  return { candidates, handled };
}

function requestWireYieldedIterationValues(
  callable: RequestCallable,
  state: RequestWireAnalysisState,
  seen: Set<string>,
  asyncIteration: boolean,
): RequestWireIterationValues {
  const yields = [
    ...(Node.isYieldExpression(callable.body) ? [callable.body] : []),
    ...callable.body.getDescendantsOfKind(SyntaxKind.YieldExpression),
  ].filter((yielded) => nodeBelongsToRequestCallable(yielded, callable));
  if (yields.length === 0) return { candidates: [], handled: false };
  const candidates: RequestWireIterationCandidate[] = [];
  let handled = true;
  for (const yielded of yields) {
    const value = yielded.getExpression();
    if (!value) continue;
    if (!yielded.getAsteriskToken()) {
      candidates.push({ expression: value, state });
      continue;
    }
    const delegated = requestWireIterationValues(value, state, new Set(seen), asyncIteration);
    handled &&= delegated.handled;
    candidates.push(...delegated.candidates);
  }
  return { candidates, handled };
}

function requestWireHeaderIterationAuthority(
  identifier: import('ts-morph').Identifier,
  state: RequestWireAnalysisState,
): RequestWireAuthority | undefined {
  for (const declaration of identifier.getSymbol()?.getDeclarations() ?? []) {
    if (Node.isParameterDeclaration(declaration)) {
      const fn = declaration.getParent();
      const callable = requestCallableForFunctionNode(fn);
      const parent = fn.getParent();
      if (!callable || !parent || !Node.isCallExpression(parent)) continue;
      const callee = unwrapStaticExpression(parent.getExpression());
      const receiver = requestCallReceiver(callee);
      if (
        requestStaticCallMember(callee) === 'forEach' &&
        receiver &&
        requestWireCarrierForExpression(receiver, state, new Set(), 0) === 'headers'
      ) {
        return requestWholeWireAuthority(parent, 'headers');
      }
    }

    const loop = declaration.getFirstAncestorByKind(SyntaxKind.ForOfStatement);
    if (!loop) continue;
    const iterable = loop.getExpression();
    const carrier = requestWireCarrierForExpression(iterable, state, new Set(), 0);
    if (carrier === 'headers' || carrier === 'header-enumerator') {
      return requestWholeWireAuthority(iterable, 'headers');
    }
    if (Node.isCallExpression(iterable)) {
      const classification = requestWireHeaderCallClassification(iterable, state);
      if (classification.authority?.sink === 'client-wire.request.headers') {
        return classification.authority;
      }
    }
  }
  return undefined;
}

function requestWireHeaderCallClassification(
  call: import('ts-morph').CallExpression,
  state: RequestWireAnalysisState,
): RequestHeaderCallClassification {
  const invocation = requestNormalizedCall(call);
  const callee = invocation.target;
  const directCarrier = requestWireCarrierForExpression(callee, state, new Set(), 0);
  const receiver = requestCallReceiver(callee);
  const receiverCarrier = receiver
    ? requestWireCarrierForExpression(receiver, state, new Set(), 0)
    : undefined;
  const member = requestStaticCallMember(callee);
  const getter =
    directCarrier === 'header-getter' || (receiverCarrier === 'headers' && member === 'get');
  if (getter) {
    const [name] = invocation.args ?? [];
    const header = requestStaticStringValue(name, state, new Set());
    if (header !== undefined) {
      const canonical = REQUEST_SENSITIVE_WIRE_HEADERS.get(header.toLowerCase());
      // Raw endpoint/webhook handlers receive EndpointRequest, whose framework-owned ingress
      // clone removes ambient browser Cookie authority before app code runs (SPEC §9.1). Exact
      // Cookie reads therefore return null on these roots; Authorization and whole/dynamic header
      // reads remain sensitive because those carriers can still reach the app-owned response.
      if (
        canonical === 'Cookie' &&
        (state.rootCallable.rootFactory === 'endpoint' ||
          state.rootCallable.rootFactory === 'webhook')
      ) {
        return { handled: true };
      }
      return canonical
        ? {
            handled: true,
            authority: {
              sink: `client-wire.request.header.${canonical}`,
              safePath: REQUEST_WIRE_CREDENTIAL_SAFE_PATH,
              source: call,
            },
          }
        : { handled: true };
    }
    return {
      handled: true,
      authority: {
        sink: 'client-wire.request.headers.dynamic',
        safePath: REQUEST_WIRE_CREDENTIAL_SAFE_PATH,
        source: call,
      },
    };
  }

  if (receiverCarrier === 'headers') {
    if (member === 'has' || member === 'append' || member === 'delete' || member === 'set') {
      return { handled: true };
    }
    if (!member || ['entries', 'forEach', 'getSetCookie', 'keys', 'values'].includes(member)) {
      return {
        handled: true,
        authority: requestWholeWireAuthority(call, 'headers'),
      };
    }
  }
  if (directCarrier === 'header-enumerator') {
    return { handled: true, authority: requestWholeWireAuthority(call, 'headers') };
  }
  return { handled: false };
}

function requestWholeWireAuthority(
  source: Node,
  carrier: RequestWireCarrier,
): RequestWireAuthority {
  return {
    sink:
      carrier === 'request' || carrier === 'context'
        ? 'client-wire.request.credentials'
        : 'client-wire.request.headers',
    safePath: REQUEST_WIRE_CREDENTIAL_SAFE_PATH,
    source,
  };
}

function requestWireCarrierForExpression(
  expression: Node,
  state: RequestWireAnalysisState,
  _seen: Set<string> = new Set(),
  _depth = 0,
): RequestWireCarrier | undefined {
  const node = unwrapStaticExpression(expression);
  const nodeKey = requestWireStateKey('carrier', node, state);
  if (state.session.carrierMemo.has(nodeKey)) {
    return state.session.carrierMemo.get(nodeKey) ?? undefined;
  }
  if (state.session.carrierActive.has(nodeKey)) return undefined;
  if (!requestProvenanceStep(state.session, node)) return undefined;
  state.session.carrierActive.add(nodeKey);
  const carrier = requestWireCarrierForExpressionUncached(node, state);
  state.session.carrierActive.delete(nodeKey);
  state.session.carrierMemo.set(nodeKey, carrier ?? null);
  return carrier;
}

function requestWireCarrierForExpressionUncached(
  node: Node,
  state: RequestWireAnalysisState,
): RequestWireCarrier | undefined {
  if (Node.isAwaitExpression(node)) {
    return requestWireCarrierForExpression(node.getExpression(), state);
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const base = requestWireCarrierForExpression(node.getExpression(), state);
    if (!base) return undefined;
    const member = Node.isPropertyAccessExpression(node)
      ? node.getName()
      : staticMemberName(node.getArgumentExpression());
    return requestWireCarrierForMember(base, member);
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    if (!receiver) return undefined;
    const receiverCarrier = requestWireCarrierForExpression(receiver, state);
    if (member === 'bind' && receiverCarrier === 'header-getter') return 'header-getter';
    if (member === 'clone' && receiverCarrier === 'request') return 'request';
    return undefined;
  }
  if (!Node.isIdentifier(node)) return undefined;

  const symbol = node.getSymbol();
  const key = symbol ? requestSymbolKey(symbol) : undefined;
  if (key) {
    const binding = state.bindings.get(key);
    if (binding) return requestWireCarrierForBoundValue(binding, state);
  }

  const rootCarrier = requestWireRootCarrierForIdentifier(node, state.rootCallable);
  if (rootCarrier) return rootCarrier;

  for (const declaration of symbol?.getDeclarations() ?? []) {
    const variable = Node.isBindingElement(declaration)
      ? declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
      : Node.isVariableDeclaration(declaration)
        ? declaration
        : undefined;
    if (variable) {
      const initializer = variable.getInitializer();
      if (initializer) {
        const base = requestWireCarrierForExpression(initializer, state);
        const resolved = base
          ? requestWireCarrierForBindingName(variable.getNameNode(), node, base)
          : undefined;
        if (resolved) return resolved;
      }
    }
    const initializer = valueDeclarationInitializer(declaration);
    if (initializer) {
      const resolved = requestWireCarrierForExpression(initializer, state);
      if (resolved) return resolved;
    }
  }
  if (symbol) {
    for (const projection of requestAssignedBindingProjections(symbol, state.session)) {
      let assigned = requestWireCarrierForExpression(projection.expression, state);
      for (const member of projection.path) {
        if (!assigned) break;
        assigned = requestWireCarrierForMember(assigned, member);
      }
      if (assigned) return assigned;
    }
  }
  return undefined;
}

function requestWireRootCarrierForIdentifier(
  identifier: Node,
  callable: RequestCallable,
): RequestWireCarrier | undefined {
  for (const root of callable.rootCarriers ?? []) {
    const parameter = requestCallableParameters(callable.declaration)[root.index];
    if (!parameter) continue;
    const carrier = requestWireCarrierForBindingName(
      parameter.getNameNode(),
      identifier,
      root.carrier,
    );
    if (carrier) return carrier;
  }
  return undefined;
}

function requestWireCarrierForBindingName(
  name: Node,
  target: Node,
  base: RequestWireCarrier,
): RequestWireCarrier | undefined {
  if (Node.isIdentifier(name)) {
    const targetSymbol = target.getSymbol();
    const nameSymbol = name.getSymbol();
    return (
      targetSymbol && nameSymbol ? targetSymbol === nameSymbol : name.getText() === target.getText()
    )
      ? base
      : undefined;
  }
  if (!Node.isObjectBindingPattern(name) && !Node.isArrayBindingPattern(name)) return undefined;
  for (const element of name.getElements()) {
    if (Node.isOmittedExpression(element)) continue;
    const rest = element.getDotDotDotToken() !== undefined;
    const member = rest
      ? undefined
      : staticMemberName(element.getPropertyNameNode() ?? element.getNameNode());
    const next = rest ? base : requestWireCarrierForMember(base, member);
    if (!next) continue;
    const resolved = requestWireCarrierForBindingName(element.getNameNode(), target, next);
    if (resolved) return resolved;
  }
  return undefined;
}

function requestWireCarrierForMember(
  base: RequestWireCarrier,
  member: string | undefined,
): RequestWireCarrier | undefined {
  if (!member) return base === 'context' ? 'request' : base;
  if (base === 'context') return member === 'request' ? 'request' : undefined;
  if (base === 'verification') return member === 'headers' ? 'headers' : undefined;
  if (base === 'request') return member === 'headers' ? 'headers' : undefined;
  if (base === 'headers') {
    if (member === 'get') return 'header-getter';
    if (['entries', 'forEach', 'getSetCookie', 'keys', 'values'].includes(member)) {
      return 'header-enumerator';
    }
  }
  return undefined;
}

function requestWireBindingsForCall(
  callable: RequestCallable,
  args: readonly Node[],
  inherited: ReadonlyMap<string, RequestWireBinding>,
): ReadonlyMap<string, RequestWireBinding> {
  const bindings = new Map(inherited);
  for (const [index, parameter] of requestCallableParameters(callable.declaration).entries()) {
    const argument = args[index];
    if (!argument) continue;
    requestWireCollectPatternBindings(parameter.getNameNode(), argument, [], bindings);
  }
  return bindings;
}

function requestWireCollectPatternBindings(
  name: Node,
  expression: Node,
  path: readonly string[],
  bindings: Map<string, RequestWireBinding>,
): void {
  if (Node.isIdentifier(name)) {
    const symbol = name.getSymbol();
    if (symbol) bindings.set(requestSymbolKey(symbol), { expression, path });
    return;
  }
  if (!Node.isObjectBindingPattern(name) && !Node.isArrayBindingPattern(name)) return;
  for (const element of name.getElements()) {
    if (Node.isOmittedExpression(element)) continue;
    const rest = element.getDotDotDotToken() !== undefined;
    const member = staticMemberName(element.getPropertyNameNode() ?? element.getNameNode());
    requestWireCollectPatternBindings(
      element.getNameNode(),
      expression,
      rest || !member ? path : [...path, member],
      bindings,
    );
  }
}

function requestWireCarrierForBoundValue(
  binding: RequestWireBinding,
  state: RequestWireAnalysisState,
): RequestWireCarrier | undefined {
  let carrier = requestWireCarrierForExpression(binding.expression, state);
  for (const member of binding.path) {
    if (!carrier) return undefined;
    carrier = requestWireCarrierForMember(carrier, member);
  }
  return carrier;
}

function requestWireProjectedExpression(
  expression: Node,
  path: readonly string[],
  seen: Set<string>,
  depth: number,
): Node | undefined {
  if (path.length === 0) return expression;
  const node = unwrapStaticExpression(expression);
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol();
    if (symbol) {
      const key = requestSymbolKey(symbol);
      if (seen.has(key)) return undefined;
      seen.add(key);
      for (const declaration of symbol.getDeclarations()) {
        const initializer = valueDeclarationInitializer(declaration);
        if (!initializer) continue;
        const projected = requestWireProjectedExpression(initializer, path, seen, depth + 1);
        if (projected) return projected;
      }
    }
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      const projected = requestWireProjectedExpression(initializer, path, seen, depth + 1);
      if (projected) return projected;
    }
  }
  if (Node.isJsxElement(node) || Node.isJsxSelfClosingElement(node)) {
    const [member, ...rest] = path;
    if (member === 'children' && Node.isJsxElement(node)) {
      const child = node
        .getJsxChildren()
        .find((candidate) => !Node.isJsxText(candidate) || candidate.getText().trim().length > 0);
      if (!child) return undefined;
      const value = Node.isJsxExpression(child) ? child.getExpression() : child;
      return value ? requestWireProjectedExpression(value, rest, seen, depth + 1) : undefined;
    }
    const opening = Node.isJsxElement(node) ? node.getOpeningElement() : node;
    for (const attribute of opening.getAttributes()) {
      if (Node.isJsxSpreadAttribute(attribute)) {
        const projected = requestWireProjectedExpression(
          attribute.getExpression(),
          path,
          new Set(seen),
          depth + 1,
        );
        if (projected) return projected;
        continue;
      }
      if (attribute.getNameNode().getText() !== member) continue;
      const initializer = attribute.getInitializer();
      if (!initializer || !Node.isJsxExpression(initializer)) return undefined;
      const value = initializer.getExpression();
      return value ? requestWireProjectedExpression(value, rest, seen, depth + 1) : undefined;
    }
    return undefined;
  }
  if (Node.isArrayLiteralExpression(node)) {
    const [member, ...rest] = path;
    const index = Number(member);
    if (!Number.isSafeInteger(index) || index < 0) return undefined;
    const element = node.getElements()[index];
    if (!element || Node.isOmittedExpression(element)) return undefined;
    return requestWireProjectedExpression(element, rest, seen, depth + 1);
  }
  if (!Node.isObjectLiteralExpression(node)) return undefined;
  const [member, ...rest] = path;
  for (const property of node.getProperties()) {
    if (
      Node.isPropertyAssignment(property) &&
      staticMemberName(property.getNameNode()) === member
    ) {
      const initializer = property.getInitializer();
      return initializer
        ? requestWireProjectedExpression(initializer, rest, seen, depth + 1)
        : undefined;
    }
    if (Node.isShorthandPropertyAssignment(property) && property.getName() === member) {
      return requestWireProjectedExpression(property.getNameNode(), rest, seen, depth + 1);
    }
    if (Node.isSpreadAssignment(property)) {
      const projected = requestWireProjectedExpression(
        property.getExpression(),
        path,
        new Set(seen),
        depth + 1,
      );
      if (projected) return projected;
    }
  }
  return undefined;
}

function requestGetterOutputExpressions(
  expression: Node,
  member: string | undefined,
  seen: Set<string>,
): Node[] {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `node:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey)) return [];
  seen.add(nodeKey);
  if (Node.isAwaitExpression(node)) {
    return requestGetterOutputExpressions(node.getExpression(), member, seen);
  }
  if (Node.isObjectLiteralExpression(node)) {
    const outputs: Node[] = [];
    for (const property of node.getProperties()) {
      if (!Node.isGetAccessorDeclaration(property)) continue;
      if (member !== undefined && staticMemberName(property.getNameNode()) !== member) continue;
      const body = property.getBody();
      if (!body) continue;
      outputs.push(...requestWireOutputExpressions({ body, declaration: property }));
    }
    return outputs;
  }
  if (Node.isNewExpression(node)) {
    const outputs: Node[] = [];
    for (const declaration of requestClassDeclarationsForExpression(
      node.getExpression(),
      new Set(seen),
    )) {
      for (const property of declaration.getGetAccessors()) {
        if (member !== undefined && property.getName() !== member) continue;
        const body = property.getBody();
        if (!body) continue;
        outputs.push(...requestWireOutputExpressions({ body, declaration: property }));
      }
    }
    return outputs;
  }
  if (Node.isCallExpression(node)) {
    const outputs: Node[] = [];
    for (const callable of resolveRequestCallable(node.getExpression(), new Set(), 0).callables) {
      for (const returned of requestWireOutputExpressions(callable)) {
        outputs.push(...requestGetterOutputExpressions(returned, member, new Set(seen)));
      }
    }
    return outputs;
  }
  if (!Node.isIdentifier(node)) return [];
  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return [];
    seen.add(key);
    const outputs: Node[] = [];
    for (const declaration of symbol.getDeclarations()) {
      const initializer = valueDeclarationInitializer(declaration);
      if (initializer) {
        outputs.push(...requestGetterOutputExpressions(initializer, member, new Set(seen)));
      }
    }
    if (outputs.length > 0) return outputs;
  }
  const declaration = localValueDeclaration(node);
  const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
  return initializer ? requestGetterOutputExpressions(initializer, member, seen) : [];
}

function requestGetterCallablesForExpression(
  expression: Node,
  member: string | undefined,
  seen: Set<string>,
  session: RequestProvenanceSession,
): RequestCallable[] {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `getter:${requestNodeIdentity(node)}:${member ?? '*'}`;
  if (seen.has(nodeKey) || !requestProvenanceStep(session, node)) return [];
  seen.add(nodeKey);

  if (Node.isAwaitExpression(node)) {
    return requestGetterCallablesForExpression(node.getExpression(), member, seen, session);
  }
  if (Node.isConditionalExpression(node)) {
    return dedupeRequestCallables(
      [node.getWhenTrue(), node.getWhenFalse()].flatMap((branch) =>
        requestGetterCallablesForExpression(branch, member, new Set(seen), session),
      ),
    );
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return dedupeRequestCallables(
        [node.getLeft(), node.getRight()].flatMap((branch) =>
          requestGetterCallablesForExpression(branch, member, new Set(seen), session),
        ),
      );
    }
  }
  if (Node.isObjectLiteralExpression(node)) {
    const callables: RequestCallable[] = [];
    for (const property of node.getProperties()) {
      if (Node.isGetAccessorDeclaration(property)) {
        if (member === undefined || requestCallableMemberName(property.getNameNode()) === member) {
          const callable = requestCallableForFunctionNode(property);
          if (callable) callables.push(callable);
        }
        continue;
      }
      if (Node.isSpreadAssignment(property)) {
        callables.push(
          ...requestGetterCallablesForExpression(
            property.getExpression(),
            member,
            new Set(seen),
            session,
          ),
        );
      }
    }
    return dedupeRequestCallables(callables);
  }
  if (Node.isNewExpression(node)) {
    const callables = requestClassDeclarationsForExpression(
      node.getExpression(),
      new Set(seen),
    ).flatMap((declaration) =>
      declaration
        .getGetAccessors()
        .filter(
          (getter) =>
            member === undefined || requestCallableMemberName(getter.getNameNode()) === member,
        )
        .flatMap((getter) => {
          const callable = requestCallableForFunctionNode(getter);
          return callable ? [callable] : [];
        }),
    );
    return dedupeRequestCallables(callables);
  }
  if (Node.isCallExpression(node)) {
    const callables: RequestCallable[] = [];
    for (const factory of resolveRequestCallable(node.getExpression(), new Set(), 0, session)
      .callables) {
      for (const output of requestWireOutputExpressions(factory)) {
        callables.push(
          ...requestGetterCallablesForExpression(output, member, new Set(seen), session),
        );
      }
    }
    return dedupeRequestCallables(callables);
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const projectedMember = Node.isPropertyAccessExpression(node)
      ? requestCallableMemberName(node.getNameNode())
      : requestCallableMemberName(node.getArgumentExpression());
    if (projectedMember !== undefined) {
      const candidates = requestGetterOutputExpressions(
        node.getExpression(),
        projectedMember,
        new Set(),
      );
      const projected = requestWireProjectedExpression(
        node.getExpression(),
        [projectedMember],
        new Set(),
        0,
      );
      if (projected) candidates.push(projected);
      return dedupeRequestCallables(
        candidates.flatMap((candidate) =>
          requestGetterCallablesForExpression(candidate, member, new Set(seen), session),
        ),
      );
    }
  }
  if (!Node.isIdentifier(node)) return [];
  const symbol = node.getSymbol();
  if (!symbol) return [];
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return [];
  seen.add(symbolKey);
  const callables: RequestCallable[] = [];
  for (const declaration of symbol.getDeclarations()) {
    if (Node.isBindingElement(declaration)) {
      const projection = requestBindingElementProjection(declaration);
      if (projection) {
        for (const candidate of requestDestructuredValueCandidates(
          projection.expression,
          projection.path[0],
          projection.path.length === 0,
        )) {
          callables.push(
            ...requestGetterCallablesForExpression(candidate, member, new Set(seen), session),
          );
        }
      }
    }
    const initializer = valueDeclarationInitializer(declaration);
    if (initializer) {
      callables.push(
        ...requestGetterCallablesForExpression(initializer, member, new Set(seen), session),
      );
    }
  }
  for (const getter of requestDefinedGetterExpressions(node, member)) {
    callables.push(...resolveRequestCallable(getter, new Set(), 0, session).callables);
  }
  return dedupeRequestCallables(callables);
}

const requestDefinedGetterMemo = new WeakMap<
  SourceFile,
  ReadonlyMap<string, ReadonlyMap<string, readonly Node[]>>
>();

function requestDefinedGetterExpressions(owner: Node, member: string | undefined): Node[] {
  const node = unwrapStaticExpression(owner);
  if (!Node.isIdentifier(node) || !node.getSymbol()) return [];
  const sourceFile = node.getSourceFile();
  let index = requestDefinedGetterMemo.get(sourceFile);
  if (!index) {
    const mutable = new Map<string, Map<string, Node[]>>();
    const symbolMemo = new Map<string, readonly string[]>();
    const add = (target: Node, name: string | undefined, getter: Node | undefined): void => {
      if (name === undefined || !getter) return;
      for (const key of requestWireExpressionSymbolKeys(target, symbolMemo, new Set())) {
        const members = mutable.get(key) ?? new Map<string, Node[]>();
        const values = members.get(name) ?? [];
        values.push(getter);
        members.set(name, values);
        mutable.set(key, members);
      }
    };
    const descriptorGetter = (descriptor: Node | undefined): Node | undefined => {
      const object = descriptor ? resolveStaticObjectLiteral(descriptor, new Set(), 0) : undefined;
      const property = object ? requestStaticObjectProperty(object, 'get') : undefined;
      if (!property) return undefined;
      return requestCallableForFunctionNode(property)
        ? property
        : requestHandlerPropertyExpression(property);
    };
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = unwrapStaticExpression(call.getExpression());
      const receiver = requestCallReceiver(callee);
      const method = requestStaticCallMember(callee);
      if (!receiver || !method) continue;
      const objectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0);
      const reflectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0);
      const [target, property, descriptor] = call.getArguments();
      if (!target) continue;
      if ((objectGlobal || reflectGlobal) && method === 'defineProperty') {
        add(target, requestCallableMemberName(property), descriptorGetter(descriptor));
        continue;
      }
      if (!objectGlobal || method !== 'defineProperties' || !property) continue;
      const descriptors = resolveStaticObjectLiteral(property, new Set(), 0);
      if (!descriptors) continue;
      for (const entry of descriptors.getProperties()) {
        const name = requestCallableMemberName(requestObjectLiteralElementNameNode(entry));
        const value = requestHandlerPropertyExpression(entry);
        add(target, name, descriptorGetter(value));
      }
    }
    index = new Map(
      [...mutable].map(([key, members]) => [
        key,
        new Map([...members].map(([name, values]) => [name, dedupeRequestNodes(values)] as const)),
      ]),
    );
    requestDefinedGetterMemo.set(sourceFile, index);
  }
  const members = index.get(requestSymbolKey(node.getSymbol()!));
  return member === undefined
    ? dedupeRequestNodes([...(members?.values() ?? [])].flat())
    : [...(members?.get(member) ?? [])];
}

function dedupeRequestCallables(callables: readonly RequestCallable[]): RequestCallable[] {
  return [
    ...new Map(
      callables.map((callable) => [requestNodeIdentity(callable.declaration), callable]),
    ).values(),
  ];
}

function requestClassDeclarationsForExpression(
  expression: Node,
  seen: Set<string>,
): Array<import('ts-morph').ClassDeclaration | import('ts-morph').ClassExpression> {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `class:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey)) return [];
  seen.add(nodeKey);
  if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
    const declarations: Array<
      import('ts-morph').ClassDeclaration | import('ts-morph').ClassExpression
    > = [node];
    const heritage = node.getExtends();
    if (heritage) {
      declarations.push(
        ...requestClassDeclarationsForExpression(heritage.getExpression(), new Set(seen)),
      );
    }
    return [
      ...new Map(
        declarations.map((declaration) => [requestNodeIdentity(declaration), declaration]),
      ).values(),
    ];
  }
  const symbol = node.getSymbol();
  if (!symbol) return [];
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return [];
  seen.add(key);
  const classes: Array<import('ts-morph').ClassDeclaration | import('ts-morph').ClassExpression> =
    [];
  for (const declaration of symbol.getDeclarations()) {
    if (Node.isClassDeclaration(declaration) || Node.isClassExpression(declaration)) {
      classes.push(...requestClassDeclarationsForExpression(declaration, new Set(seen)));
      continue;
    }
    const initializer = valueDeclarationInitializer(declaration);
    if (initializer) {
      classes.push(...requestClassDeclarationsForExpression(initializer, new Set(seen)));
    }
  }
  return classes;
}

function requestWireMutationTargetResolvesToSymbol(expression: Node, target: string): boolean {
  let node = unwrapStaticExpression(expression);
  while (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    node = unwrapStaticExpression(node.getExpression());
  }
  return requestWireExpressionResolvesToSymbol(node, target, new Set(), 0);
}

function requestWireExpressionResolvesToSymbol(
  expression: Node,
  target: string,
  seen: Set<string>,
  depth: number,
  session: RequestProvenanceSession = createRequestProvenanceSession(),
): boolean {
  const node = unwrapStaticExpression(expression);
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (!symbol) return false;
  const key = requestSymbolKey(symbol);
  if (key === target) return true;
  if (seen.has(key)) return false;
  seen.add(key);
  for (const declaration of symbol.getDeclarations()) {
    if (Node.isParameterDeclaration(declaration)) {
      const owner = declaration.getParent();
      const index = requestCallableParameters(owner).indexOf(declaration);
      if (index >= 0) {
        for (const call of owner.getSourceFile().getDescendantsOfKind(SyntaxKind.CallExpression)) {
          const invocation = requestNormalizedCall(call);
          const reachesOwner = resolveRequestCallable(
            invocation.target,
            new Set(),
            0,
            session,
          ).callables.some((callable) => requestNodesAreSame(callable.declaration, owner));
          const argument = reachesOwner ? invocation.args?.[index] : undefined;
          if (
            argument &&
            requestWireExpressionResolvesToSymbol(
              argument,
              target,
              new Set(seen),
              depth + 1,
              session,
            )
          ) {
            return true;
          }
        }
        for (const construct of owner
          .getSourceFile()
          .getDescendantsOfKind(SyntaxKind.NewExpression)) {
          const reachesOwner = resolveRequestCallable(
            construct.getExpression(),
            new Set(),
            0,
            session,
          ).callables.some((callable) => requestNodesAreSame(callable.declaration, owner));
          const argument = reachesOwner ? construct.getArguments()[index] : undefined;
          if (
            argument &&
            requestWireExpressionResolvesToSymbol(
              argument,
              target,
              new Set(seen),
              depth + 1,
              session,
            )
          ) {
            return true;
          }
        }
      }
    }
    const initializer = valueDeclarationInitializer(declaration);
    if (
      initializer &&
      requestWireExpressionResolvesToSymbol(initializer, target, seen, depth + 1, session)
    ) {
      return true;
    }
  }
  return false;
}

function requestStaticStringValue(
  expression: Node | undefined,
  state: RequestWireAnalysisState,
  seen: Set<string>,
): string | undefined {
  if (!expression) return undefined;
  const node = unwrapStaticExpression(expression);
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (!Node.isIdentifier(node)) return undefined;
  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return undefined;
    seen.add(key);
    const binding = state.bindings.get(key);
    if (binding) {
      const projected = requestWireProjectedExpression(
        binding.expression,
        binding.path,
        new Set(),
        0,
      );
      if (projected) return requestStaticStringValue(projected, state, seen);
    }
    for (const declaration of symbol.getDeclarations()) {
      // A mutable binding is never a static header name: control-flow writes can select Cookie or
      // Authorization after a harmless initializer (KV418/KV424 fail-closed string semantics).
      if (
        Node.isVariableDeclaration(declaration) &&
        declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
      ) {
        return undefined;
      }
      const initializer = valueDeclarationInitializer(declaration);
      const value = requestStaticStringValue(initializer, state, seen);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function dedupeRequestWireAuthorities(
  authorities: readonly RequestWireAuthority[],
): RequestWireAuthority[] {
  const seen = new Set<string>();
  return authorities.filter((authority) => {
    if (seen.has(authority.sink)) return false;
    seen.add(authority.sink);
    return true;
  });
}

function nodeBelongsToRequestCallable(node: Node, callable: RequestCallable): boolean {
  if (node === callable.body) return true;
  for (const ancestor of node.getAncestors()) {
    if (ancestor === callable.declaration) return true;
    if (requestCallableForFunctionNode(ancestor)) return false;
  }
  return false;
}

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
  'Reflect',
  'Response',
  'String',
  'Symbol',
  'URL',
  'crypto',
]);

/**
 * Global binding lockdown proves identity, not the semantics of future static members. Keep this
 * inventory finite so a runtime upgrade cannot silently widen request-reachable execution
 * (SPEC §6.6).
 */
const REQUEST_REVIEWED_GLOBAL_NAMESPACE_MEMBERS = new Map<string, ReadonlySet<string>>([
  ['Array', new Set(['from', 'fromAsync', 'isArray', 'of'])],
  ['BigInt', new Set(['asIntN', 'asUintN'])],
  ['Buffer', new Set(['byteLength', 'compare', 'concat', 'from', 'isBuffer'])],
  ['Date', new Set(['now', 'parse', 'UTC'])],
  ['Error', new Set()],
  ['JSON', new Set(['parse', 'stringify'])],
  [
    'Math',
    new Set([
      'abs',
      'acos',
      'acosh',
      'asin',
      'asinh',
      'atan',
      'atan2',
      'atanh',
      'cbrt',
      'ceil',
      'clz32',
      'cos',
      'cosh',
      'exp',
      'expm1',
      'floor',
      'fround',
      'hypot',
      'imul',
      'log',
      'log10',
      'log1p',
      'log2',
      'max',
      'min',
      'pow',
      'random',
      'round',
      'sign',
      'sin',
      'sinh',
      'sqrt',
      'tan',
      'tanh',
      'trunc',
    ]),
  ],
  [
    'Number',
    new Set(['isFinite', 'isInteger', 'isNaN', 'isSafeInteger', 'parseFloat', 'parseInt']),
  ],
  [
    'Object',
    new Set([
      'assign',
      'create',
      'defineProperties',
      'defineProperty',
      'entries',
      'freeze',
      'fromEntries',
      'getOwnPropertyDescriptor',
      'getOwnPropertyDescriptors',
      'getOwnPropertyNames',
      'getOwnPropertySymbols',
      'getPrototypeOf',
      'groupBy',
      'hasOwn',
      'is',
      'isExtensible',
      'isFrozen',
      'isSealed',
      'keys',
      'preventExtensions',
      'seal',
      'setPrototypeOf',
      'values',
    ]),
  ],
  [
    'Promise',
    new Set(['all', 'allSettled', 'any', 'race', 'reject', 'resolve', 'try', 'withResolvers']),
  ],
  [
    'Reflect',
    new Set([
      'apply',
      'construct',
      'defineProperty',
      'deleteProperty',
      'get',
      'getOwnPropertyDescriptor',
      'getPrototypeOf',
      'has',
      'isExtensible',
      'ownKeys',
      'preventExtensions',
      'set',
      'setPrototypeOf',
    ]),
  ],
  ['Response', new Set(['error', 'json', 'redirect'])],
  ['String', new Set(['fromCharCode', 'fromCodePoint', 'raw'])],
  ['Symbol', new Set(['for', 'keyFor'])],
  ['URL', new Set(['canParse', 'parse'])],
  ['crypto', new Set(['getRandomValues', 'randomUUID'])],
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
  'forEach',
  'formData',
  'get',
  'has',
  'json',
  'keys',
  'text',
  'values',
]);

const REQUEST_SAFE_FETCH_RESPONSE_METHODS = new Set([
  'arrayBuffer',
  'blob',
  'clone',
  'formData',
  'json',
  'text',
]);

const REQUEST_SAFE_JSON_VALUE_METHODS = new Set([
  'at',
  'charAt',
  'charCodeAt',
  'codePointAt',
  'endsWith',
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'forEach',
  'includes',
  'indexOf',
  'lastIndexOf',
  'localeCompare',
  'map',
  'match',
  'normalize',
  'padEnd',
  'padStart',
  'reduce',
  'reduceRight',
  'repeat',
  'replace',
  'replaceAll',
  'slice',
  'some',
  'split',
  'startsWith',
  'substring',
  'substr',
  'toFixed',
  'toLowerCase',
  'toPrecision',
  'toString',
  'toUpperCase',
  'trim',
  'trimEnd',
  'trimStart',
  'valueOf',
]);

const REQUEST_REVIEWED_LOCAL_ARRAY_METHODS = new Set([
  'concat',
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'forEach',
  'flatMap',
  'join',
  'map',
  'pop',
  'push',
  'reduce',
  'reduceRight',
  'shift',
  'some',
  'sort',
  'toLocaleString',
  'toSorted',
  'unshift',
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

  if (requestCallIsPromiseSettlement(call, callable, context)) return true;

  // Module-initializer scanning reaches the same exact framework constructors and request-root
  // factories that the retained-config pass reviews below. Their authored callbacks are still
  // scanned as independent roots; accepting the constructor call itself grants no package-wide
  // execution authority.
  if (requestRetainedConfigCallIsReviewed(call, context.provenance)) return true;

  if (requestCallIsExactTrustedOutput(call)) {
    scanRequestFunctionArguments(call, context);
    return true;
  }

  if (requestCallIsPublicStyleCreate(call)) {
    scanRequestFunctionArguments(call, context);
    return true;
  }

  if (requestCallIsReviewedPublicJsxAttributeHelper(call)) {
    scanRequestFunctionArguments(call, context);
    return true;
  }

  if (requestCallIsReviewedPublicUiRender(call)) {
    scanRequestFunctionArguments(call, context);
    return true;
  }

  if (requestCallIsExactRunCommand(call)) {
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (requestCallIsExactPostgresRuntimeConstructor(call)) {
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (requestCallIsExactClosedRedirect(call)) {
    if (!requestRespondOutcomeCallIsWholeFunctionReturn(call, callable)) return false;
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (requestCallIsExactRespondMethod(call)) {
    if (!requestRespondOutcomeCallIsWholeFunctionReturn(call, callable)) return false;
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (requestImportedModuleExportForExpression(callee, isReviewedSafeBuiltinModule, new Set(), 0)) {
    if (requestSafeBuiltinCapabilityIsMutated(callee)) return false;
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (receiver && requestExpressionIsSafeBuiltinCapability(receiver, new Set(), 0)) {
    if (requestSafeBuiltinCapabilityIsMutated(receiver)) return false;
    scanRequestFunctionArguments(call, context);
    return requestKnownCallbacksAreClosed(call, member, context);
  }
  if (receiver && requestExpressionContainsClosedAuthority(receiver, new Set(), 0)) {
    return true;
  }
  if (
    receiver &&
    member &&
    ['db', 'systemDb'].includes(member) &&
    requestExpressionResolvesToExactPostgresRuntime(receiver, new Set()) &&
    requestExactPostgresRuntimeIsPristine(receiver)
  ) {
    scanRequestFunctionArguments(call, context);
    return true;
  }

  if (
    receiver &&
    member &&
    ['then', 'catch', 'finally'].includes(member) &&
    requestExpressionIsExactNativePromise(receiver, new Set(), context.provenance)
  ) {
    scanRequestFunctionArguments(call, context);
    return requestKnownCallbacksAreClosed(call, member, context);
  }

  if (receiver && member) {
    const localContainer = requestLocalIntrinsicContainerKind(
      receiver,
      callable,
      context,
      new Set(),
    );
    const reviewedMethods =
      localContainer === 'array'
        ? REQUEST_REVIEWED_LOCAL_ARRAY_METHODS
        : localContainer === 'map'
          ? new Set(['get', 'set'])
          : localContainer === 'url-search-params'
            ? new Set(['append', 'toString'])
            : undefined;
    if (reviewedMethods?.has(member)) {
      if (
        !requestLocalIntrinsicContainerIsPristine(
          receiver,
          call,
          reviewedMethods,
          callable,
          context,
        )
      ) {
        return false;
      }
      if (scanRequestKnownSafePrototypeMutations(call, member, context)) return false;
      if (localContainer === 'array') {
        if (member === 'join') {
          scanRequestArrayLikePrimitiveValues(
            receiver,
            call,
            callable,
            context,
            'Array.join-elements',
            new Set(),
          );
          const separator = call.getArguments()[0];
          if (separator) {
            scanRequestProtocolUse(separator, REQUEST_TO_PRIMITIVE_HOOKS, call, callable, context);
          }
        }
        if (member === 'toLocaleString') {
          scanRequestIterableValueProtocols(receiver, 'locale-string', call, callable, context);
        }
        scanRequestFunctionArguments(call, context);
        return requestKnownCallbacksAreClosed(call, member, context);
      }
      if (localContainer === 'url-search-params' && member === 'append') {
        for (const argument of call.getArguments()) {
          scanRequestProtocolUse(argument, REQUEST_TO_PRIMITIVE_HOOKS, call, callable, context);
        }
      }
      return true;
    }
  }

  if (Node.isIdentifier(callee) && REQUEST_SAFE_GLOBAL_CALLABLES.has(callee.getText())) {
    if (!unshadowedGlobalIdentifier(callee, callee.getText())) return false;
    if (requestGlobalIntrinsicBindingIsMutated(callee.getText(), callee.getSourceFile())) {
      return false;
    }
    scanRequestFunctionArguments(call, context);
    return true;
  }
  for (const callbackGlobal of ['queueMicrotask', 'setInterval', 'setTimeout'] as const) {
    if (!expressionResolvesToGlobalCallable(callee, callbackGlobal, new Set(), 0, false)) continue;
    scanRequestFunctionArguments(call, context);
    return requestKnownCallbacksAreClosed(call, callbackGlobal, context);
  }

  if (!receiver || !member) return false;
  if (
    REQUEST_SAFE_FETCH_RESPONSE_METHODS.has(member) &&
    requestExpressionIsFetchResponse(receiver, new Set())
  ) {
    if (
      !requestLocalIntrinsicContainerIsPristine(
        receiver,
        call,
        REQUEST_SAFE_FETCH_RESPONSE_METHODS,
        callable,
        context,
      )
    ) {
      return false;
    }
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (requestExpressionIsSafeGlobalNamespace(receiver)) {
    if (!requestGlobalNamespaceMemberIsReviewed(receiver, member)) return false;
    scanRequestFunctionArguments(call, context);
    if (expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0)) {
      return member === 'apply' || member === 'construct'
        ? requestReflectiveTargetIsClosed(call, member, callable, context)
        : requestReflectiveOperationIsClosed(call, member, callable, context);
    }
    return requestKnownCallbacksAreClosed(call, member, context);
  }

  const role = requestExpressionRootParameterRole(receiver, callable, new Set(), 0);
  if (requestRootRoleIncludesCapability(role)) {
    if (!requestRootCapabilityMethodIsPristine(receiver, callable)) return false;
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (role === 'request' && REQUEST_SAFE_REQUEST_METHODS.has(member)) {
    if (
      !requestLocalIntrinsicContainerIsPristine(
        receiver,
        call,
        REQUEST_SAFE_REQUEST_METHODS,
        callable,
        context,
      )
    ) {
      return false;
    }
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (
    (requestRootRoleIncludesInput(role) ||
      (requestExpressionIsIntrinsicValue(receiver, callable, new Set(), 0) &&
        !requestExpressionHasMutableObjectOrigin(receiver, new Set()))) &&
    REQUEST_SAFE_JSON_VALUE_METHODS.has(member)
  ) {
    if (
      requestRootRoleIncludesInput(role) &&
      !requestInputJsonReceiverIsPristine(receiver, call, callable)
    ) {
      return false;
    }
    if (
      !requestRootRoleIncludesInput(role) &&
      Node.isIdentifier(unwrapStaticExpression(receiver)) &&
      !requestLocalIntrinsicContainerIsPristine(
        receiver,
        call,
        REQUEST_SAFE_JSON_VALUE_METHODS,
        callable,
        context,
      )
    ) {
      return false;
    }
    for (const argument of call.getArguments()) {
      scanRequestProtocolUse(argument, REQUEST_TO_PRIMITIVE_HOOKS, call, callable, context);
    }
    scanRequestFunctionArguments(call, context);
    if (scanRequestKnownSafePrototypeMutations(call, member, context)) return true;
    return requestKnownCallbacksAreClosed(call, member, context);
  }
  return false;
}

function requestRootCapabilityKey(
  expression: Node,
  callable: RequestCallable,
  seen: Set<string>,
): string | undefined {
  const node = unwrapStaticExpression(expression);
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol();
    if (!symbol) return undefined;
    const symbolKey = requestSymbolKey(symbol);
    if (seen.has(symbolKey)) return undefined;
    seen.add(symbolKey);
    const declarations = [localValueDeclaration(node), ...symbol.getDeclarations()].filter(
      (declaration, index, all): declaration is Node =>
        !!declaration && all.indexOf(declaration) === index,
    );
    for (const declaration of declarations) {
      if (
        !Node.isVariableDeclaration(declaration) ||
        declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
      ) {
        continue;
      }
      const initializer = declaration.getInitializer();
      if (initializer) {
        const aliased = requestRootCapabilityKey(initializer, callable, new Set(seen));
        if (aliased) return aliased;
      }
    }
    return requestRootRoleIncludesCapability(
      requestExpressionRootParameterRole(node, callable, new Set(), 0),
    )
      ? `root:${symbolKey}`
      : undefined;
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : node.getArgumentExpression()
        ? (requestStaticStringExpressionValue(node.getArgumentExpression()!) ?? '*')
        : '*';
    const receiver = requestRootCapabilityKey(node.getExpression(), callable, new Set(seen));
    return receiver ? `${receiver}.${member}` : undefined;
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    if (receiver && member && REQUEST_REVIEWED_DRIZZLE_DB_DATA_METHODS.has(member)) {
      return requestRootCapabilityKey(receiver, callable, new Set(seen));
    }
  }
  return undefined;
}

function requestExpressionContainsIdentityCarrier(
  expression: Node | undefined,
  identifiesCarrier: (candidate: Node | undefined) => boolean,
  seen: Set<string>,
): boolean {
  if (!expression) return false;
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  if (seen.has(key)) return false;
  seen.add(key);
  if (identifiesCarrier(node)) return true;
  if (Node.isConditionalExpression(node)) {
    return [node.getWhenTrue(), node.getWhenFalse()].some((part) =>
      requestExpressionContainsIdentityCarrier(part, identifiesCarrier, new Set(seen)),
    );
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      ![
        SyntaxKind.AmpersandAmpersandToken,
        SyntaxKind.BarBarToken,
        SyntaxKind.QuestionQuestionToken,
        SyntaxKind.CommaToken,
        SyntaxKind.EqualsToken,
      ].includes(operator)
    ) {
      return false;
    }
    return (
      requestExpressionContainsIdentityCarrier(node.getLeft(), identifiesCarrier, new Set(seen)) ||
      requestExpressionContainsIdentityCarrier(node.getRight(), identifiesCarrier, new Set(seen))
    );
  }
  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().some((property) => {
      const value = Node.isPropertyAssignment(property)
        ? property.getInitializer()
        : Node.isShorthandPropertyAssignment(property)
          ? property.getNameNode()
          : Node.isSpreadAssignment(property)
            ? property.getExpression()
            : undefined;
      return requestExpressionContainsIdentityCarrier(value, identifiesCarrier, new Set(seen));
    });
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node
      .getElements()
      .some((element) =>
        requestExpressionContainsIdentityCarrier(
          Node.isSpreadElement(element) ? element.getExpression() : element,
          identifiesCarrier,
          new Set(seen),
        ),
      );
  }
  if (Node.isAwaitExpression(node) || Node.isSpreadElement(node)) {
    return requestExpressionContainsIdentityCarrier(
      node.getExpression(),
      identifiesCarrier,
      new Set(seen),
    );
  }
  if (
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  ) {
    return [node, ...node.getDescendants()].some(
      (candidate) => candidate !== node && identifiesCarrier(candidate),
    );
  }
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol();
    if (!symbol) return false;
    return symbol.getDeclarations().some((declaration) => {
      if (Node.isFunctionDeclaration(declaration)) {
        return requestExpressionContainsIdentityCarrier(
          declaration,
          identifiesCarrier,
          new Set(seen),
        );
      }
      const initializer = valueDeclarationInitializer(declaration);
      return !!(
        initializer &&
        (Node.isArrowFunction(unwrapStaticExpression(initializer)) ||
          Node.isFunctionExpression(unwrapStaticExpression(initializer))) &&
        requestExpressionContainsIdentityCarrier(initializer, identifiesCarrier, new Set(seen))
      );
    });
  }
  return false;
}

function requestRootCapabilityMethodIsPristine(receiver: Node, callable: RequestCallable): boolean {
  const targetKey = requestRootCapabilityKey(receiver, callable, new Set());
  if (!targetKey) return false;
  const keyMayPrefix = (prefix: string, value: string): boolean => {
    const prefixParts = prefix.split('.');
    const valueParts = value.split('.');
    return (
      prefixParts.length <= valueParts.length &&
      prefixParts.every(
        (part, index) => part === '*' || valueParts[index] === '*' || part === valueParts[index],
      )
    );
  };
  const isTargetRoot = (candidate: Node | undefined): boolean => {
    if (!candidate) return false;
    const node = unwrapStaticExpression(candidate);
    // A reviewed DB method's result remains associated with its receiver only so chained methods
    // can be checked. It is data/query-builder output, not an escape of the DB carrier itself.
    if (Node.isCallExpression(node)) return false;
    const key = requestRootCapabilityKey(node, callable, new Set());
    return key === targetKey;
  };
  const isTargetMember = (candidate: Node | undefined): boolean => {
    if (!candidate) return false;
    const key = requestRootCapabilityKey(candidate, callable, new Set());
    return !!key && keyMayPrefix(targetKey, key);
  };
  const isTargetOrAncestorCarrier = (candidate: Node | undefined): boolean => {
    if (!candidate) return false;
    const node = unwrapStaticExpression(candidate);
    if (Node.isCallExpression(node)) return false;
    const key = requestRootCapabilityKey(node, callable, new Set());
    return !!key && keyMayPrefix(key, targetKey);
  };
  const expressionContainsTargetOrAncestorCarrier = (candidate: Node | undefined): boolean =>
    requestExpressionContainsIdentityCarrier(candidate, isTargetOrAncestorCarrier, new Set());
  const sourceFile = callable.declaration.getSourceFile();

  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = assignment.getOperatorToken().getKind();
    if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
    const left = unwrapStaticExpression(assignment.getLeft());
    if (isTargetMember(left)) return false;
    if (expressionContainsTargetOrAncestorCarrier(assignment.getRight())) return false;
  }
  for (const deletion of sourceFile.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
    if (isTargetMember(deletion.getExpression())) {
      return false;
    }
  }
  for (const update of [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
  ]) {
    if (isTargetMember(update.getOperand())) {
      return false;
    }
  }
  for (const object of sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    for (const property of object.getProperties()) {
      const value = Node.isPropertyAssignment(property)
        ? property.getInitializer()
        : Node.isShorthandPropertyAssignment(property)
          ? property.getNameNode()
          : Node.isSpreadAssignment(property)
            ? property.getExpression()
            : undefined;
      if (expressionContainsTargetOrAncestorCarrier(value)) return false;
    }
  }
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer();
    if (!initializer || !expressionContainsTargetOrAncestorCarrier(initializer)) continue;
    if (
      declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const &&
      Node.isIdentifier(declaration.getNameNode()) &&
      isTargetRoot(initializer)
    ) {
      continue;
    }
    return false;
  }
  for (const array of sourceFile.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression)) {
    if (
      array
        .getElements()
        .some((element) =>
          expressionContainsTargetOrAncestorCarrier(
            Node.isSpreadElement(element) ? element.getExpression() : element,
          ),
        )
    ) {
      return false;
    }
  }
  for (const returned of sourceFile.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    if (expressionContainsTargetOrAncestorCarrier(returned.getExpression())) {
      return false;
    }
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const matchingArguments = call
      .getArguments()
      .filter((argument) => expressionContainsTargetOrAncestorCarrier(argument));
    if (matchingArguments.length === 0) continue;
    const exactRespondMember = requestCallIsExactRespondMethod(call)
      ? requestStaticCallMember(unwrapStaticExpression(call.getExpression()))
      : undefined;
    if (exactRespondMember === 'storedFile' && isTargetRoot(call.getArguments()[0])) {
      continue;
    }
    return false;
  }
  for (const construct of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (
      construct
        .getArguments()
        .some((argument) => expressionContainsTargetOrAncestorCarrier(argument))
    ) {
      return false;
    }
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrapStaticExpression(call.getExpression());
    const global = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    const [target] = call.getArguments();
    if (
      target &&
      isTargetOrAncestorCarrier(target) &&
      global &&
      member &&
      ((expressionResolvesToGlobalNamespace(global, 'Object', new Set(), 0) &&
        ['assign', 'defineProperties', 'defineProperty', 'setPrototypeOf'].includes(member)) ||
        (expressionResolvesToGlobalNamespace(global, 'Reflect', new Set(), 0) &&
          ['defineProperty', 'deleteProperty', 'set', 'setPrototypeOf'].includes(member)))
    ) {
      return false;
    }
  }
  return true;
}

function requestSafeBuiltinCapabilityIsMutated(expression: Node): boolean {
  const targets = requestSafeBuiltinRootSymbolKeys(expression, new Set());
  if (targets.size === 0) return false;
  const sourceFile = expression.getSourceFile();
  const referencesTarget = (candidate: Node): boolean =>
    [...targets].some((target) => requestExpressionReferencesSymbol(candidate, target));
  const carriesTarget = (candidate: Node): boolean => {
    const node = unwrapStaticExpression(candidate);
    if (Node.isIdentifier(node)) return referencesTarget(node);
    if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
      return carriesTarget(node.getExpression());
    }
    if (Node.isConditionalExpression(node)) {
      return carriesTarget(node.getWhenTrue()) || carriesTarget(node.getWhenFalse());
    }
    if (Node.isArrayLiteralExpression(node)) {
      return node
        .getElements()
        .some((element) =>
          carriesTarget(Node.isSpreadElement(element) ? element.getExpression() : element),
        );
    }
    if (Node.isObjectLiteralExpression(node)) {
      return node.getProperties().some((property) => {
        const value = requestHandlerPropertyExpression(property);
        return !!value && carriesTarget(value);
      });
    }
    return false;
  };

  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = assignment.getOperatorToken().getKind();
    if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
    if (referencesTarget(assignment.getLeft()) || carriesTarget(assignment.getRight())) {
      return true;
    }
  }
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer();
    if (initializer && carriesTarget(initializer)) return true;
  }
  for (const invocation of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (invocation.getArguments().some(carriesTarget)) return true;
  }
  for (const construction of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (construction.getArguments().some(carriesTarget)) return true;
  }
  for (const tagged of sourceFile.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression)) {
    if (referencesTarget(tagged.getTemplate())) return true;
  }
  for (const jsx of sourceFile.getDescendantsOfKind(SyntaxKind.JsxExpression)) {
    const value = jsx.getExpression();
    if (value && referencesTarget(value)) return true;
  }
  for (const deletion of sourceFile.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
    if (referencesTarget(deletion.getExpression())) return true;
  }
  for (const update of [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
  ]) {
    if (referencesTarget(update.getOperand())) return true;
  }
  return false;
}

function requestSafeBuiltinRootSymbolKeys(expression: Node, seen: Set<string>): Set<string> {
  const node = unwrapStaticExpression(expression);
  const result = new Set<string>();
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return requestSafeBuiltinRootSymbolKeys(node.getExpression(), seen);
  }
  if (Node.isCallExpression(node)) {
    const receiver = requestCallReceiver(unwrapStaticExpression(node.getExpression()));
    return receiver ? requestSafeBuiltinRootSymbolKeys(receiver, seen) : result;
  }
  if (!Node.isIdentifier(node)) return result;
  const symbol = node.getSymbol();
  if (!symbol) return result;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return result;
  seen.add(symbolKey);
  if (requestModuleNamespaceSpecifier(node, isReviewedSafeBuiltinModule, new Set(), 0)) {
    result.add(symbolKey);
  }
  for (const declaration of symbol.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (!initializer) continue;
    for (const target of requestSafeBuiltinRootSymbolKeys(initializer, new Set(seen))) {
      result.add(target);
    }
  }
  return result;
}

function requestInputJsonReceiverIsPristine(
  receiver: Node,
  call: import('ts-morph').CallExpression,
  callable: RequestCallable,
): boolean {
  const body = callable.body;
  const hasInputRole = (candidate: Node): boolean =>
    requestRootRoleIncludesInput(
      requestExpressionRootParameterRole(candidate, callable, new Set(), 0),
    );

  for (const assignment of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = assignment.getOperatorToken().getKind();
    if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
    if (hasInputRole(assignment.getLeft())) return false;
  }
  for (const invocation of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (requestNodesAreSame(invocation, call)) continue;
    if (invocation.getArguments().some(hasInputRole)) return false;
    const invocationCallee = unwrapStaticExpression(invocation.getExpression());
    const invocationReceiver = requestCallReceiver(invocationCallee);
    if (invocationReceiver && hasInputRole(invocationReceiver)) {
      const member = requestStaticCallMember(invocationCallee);
      if (!member || !REQUEST_SAFE_JSON_VALUE_METHODS.has(member)) return false;
    }
  }
  for (const construction of body.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (construction.getArguments().some(hasInputRole)) return false;
  }
  for (const tagged of body.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression)) {
    if (hasInputRole(tagged.getTemplate())) return false;
  }
  for (const jsx of body.getDescendantsOfKind(SyntaxKind.JsxExpression)) {
    const value = jsx.getExpression();
    if (value && hasInputRole(value)) return false;
  }
  for (const deletion of body.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
    if (hasInputRole(deletion.getExpression())) return false;
  }
  return hasInputRole(receiver);
}

type RequestLocalIntrinsicContainerKind = 'array' | 'map' | 'url-search-params';

function requestLocalIntrinsicContainerKind(
  expression: Node,
  callable: RequestCallable,
  context: RequestProcessScanContext,
  seen: Set<string>,
): RequestLocalIntrinsicContainerKind | undefined {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `local-container:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey)) return undefined;
  seen.add(nodeKey);
  if (Node.isArrayLiteralExpression(node)) return 'array';
  if (Node.isAwaitExpression(node)) {
    return requestLocalIntrinsicContainerKind(
      node.getExpression(),
      callable,
      context,
      new Set(seen),
    );
  }
  if (Node.isCallExpression(node) && requestCallIsReviewedDrizzleDbReadChain(node, callable)) {
    return 'array';
  }
  if (Node.isNewExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    if (!Node.isIdentifier(callee) || !unshadowedGlobalIdentifier(callee, callee.getText())) {
      return undefined;
    }
    const name = callee.getText();
    if (requestGlobalIntrinsicBindingIsMutated(name, node.getSourceFile())) return undefined;
    if (name === 'Array') return 'array';
    if (name === 'Map') return 'map';
    if (name === 'URLSearchParams') return 'url-search-params';
    return undefined;
  }
  if (!Node.isIdentifier(node)) return undefined;
  const symbol = node.getSymbol();
  if (!symbol) return undefined;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return undefined;
  seen.add(symbolKey);
  const declarations = symbol.getDeclarations();
  if (
    declarations.length === 0 ||
    declarations.some(
      (declaration) =>
        !Node.isVariableDeclaration(declaration) ||
        !nodeBelongsToRequestCallable(declaration, callable) ||
        declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const,
    ) ||
    requestAssignedBindingProjections(symbol, context.provenance).some(
      (projection) => projection.path.length === 0,
    )
  ) {
    return undefined;
  }
  const kinds = declarations.map((declaration) => {
    const initializer = valueDeclarationInitializer(declaration);
    const initialNode = initializer ? unwrapStaticExpression(initializer) : undefined;
    if (
      !initialNode ||
      Node.isIdentifier(initialNode) ||
      Node.isConditionalExpression(initialNode)
    ) {
      return undefined;
    }
    return initializer
      ? requestLocalIntrinsicContainerKind(initializer, callable, context, new Set(seen))
      : undefined;
  });
  const [kind] = kinds;
  return kind && kinds.every((candidate) => candidate === kind) ? kind : undefined;
}

function requestLocalIntrinsicContainerIsPristine(
  receiver: Node,
  call: import('ts-morph').CallExpression,
  reviewedMethods: ReadonlySet<string>,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): boolean {
  const node = unwrapStaticExpression(receiver);
  if (!Node.isIdentifier(node)) return true;
  const symbol = node.getSymbol();
  if (!symbol) return false;
  const aliases = new Set([requestSymbolKey(symbol)]);
  const body = callable.body;

  const declarations = body
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter((declaration) => declaration.getStart() < call.getStart());
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const initializer = declaration.getInitializer();
      const name = declaration.getNameNode();
      if (!initializer || !Node.isIdentifier(name)) continue;
      const initialNode = unwrapStaticExpression(initializer);
      if (
        !Node.isIdentifier(initialNode) ||
        !requestExpressionReferencesAny(initialNode, aliases)
      ) {
        continue;
      }
      const alias = name.getSymbol();
      if (alias && !aliases.has(requestSymbolKey(alias))) {
        aliases.add(requestSymbolKey(alias));
        changed = true;
      }
    }
  }

  for (const assignment of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (assignment.getStart() >= call.getStart()) continue;
    const operator = assignment.getOperatorToken().getKind();
    if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
    if (requestExpressionReferencesAny(assignment.getLeft(), aliases)) return false;
    if (requestExpressionReferencesAny(assignment.getRight(), aliases)) return false;
  }
  for (const declaration of declarations) {
    const initializer = declaration.getInitializer();
    if (!initializer || !requestExpressionReferencesAny(initializer, aliases)) continue;
    const initialNode = unwrapStaticExpression(initializer);
    if (Node.isIdentifier(initialNode)) continue;
    if (!requestAliasReferencesAreReviewedCalls(initializer, aliases, reviewedMethods)) {
      return false;
    }
  }
  for (const invocation of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (invocation.getStart() >= call.getStart() || requestNodesAreSame(invocation, call)) continue;
    if (
      invocation
        .getArguments()
        .some((argument) => requestExpressionReferencesAny(argument, aliases))
    ) {
      return false;
    }
    const invocationCallee = unwrapStaticExpression(invocation.getExpression());
    const invocationReceiver = requestCallReceiver(invocationCallee);
    if (!invocationReceiver || !requestExpressionReferencesAny(invocationReceiver, aliases)) {
      continue;
    }
    const invocationMember = requestStaticCallMember(invocationCallee);
    if (!invocationMember || !reviewedMethods.has(invocationMember)) return false;
  }
  for (const construction of body.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (
      construction.getStart() < call.getStart() &&
      construction
        .getArguments()
        .some((argument) => requestExpressionReferencesAny(argument, aliases))
    ) {
      return false;
    }
  }
  for (const deletion of body.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
    if (
      deletion.getStart() < call.getStart() &&
      requestExpressionReferencesAny(deletion.getExpression(), aliases)
    ) {
      return false;
    }
  }

  const member = requestStaticCallMember(unwrapStaticExpression(call.getExpression()));
  if (!member) return false;
  const assigned = requestAssignedMemberExpressions(
    node,
    member,
    call.getStart(),
    context.provenance,
  );
  if (assigned.length > 0) {
    for (const expression of assigned) {
      for (const nested of resolveRequestCallable(expression, new Set(), 0, context.provenance)
        .callables) {
        scanRequestCallable(nested, context);
      }
    }
    return false;
  }
  return true;
}

function requestExpressionReferencesAny(expression: Node, targets: ReadonlySet<string>): boolean {
  return [...targets].some((target) => requestExpressionReferencesSymbol(expression, target));
}

function requestAliasReferencesAreReviewedCalls(
  expression: Node,
  aliases: ReadonlySet<string>,
  reviewedMethods: ReadonlySet<string>,
): boolean {
  const identifiers = [
    ...(Node.isIdentifier(expression) ? [expression] : []),
    ...expression.getDescendantsOfKind(SyntaxKind.Identifier),
  ].filter((identifier) => {
    const symbol = identifier.getSymbol();
    return !!symbol && aliases.has(requestSymbolKey(symbol));
  });
  return identifiers.every((identifier) => {
    let node: Node = identifier;
    while (
      Node.isParenthesizedExpression(node.getParent()) ||
      Node.isAsExpression(node.getParent()) ||
      Node.isSatisfiesExpression(node.getParent()) ||
      Node.isAwaitExpression(node.getParent())
    ) {
      node = node.getParent()!;
    }
    const access = node.getParent();
    if (!Node.isPropertyAccessExpression(access) && !Node.isElementAccessExpression(access)) {
      return false;
    }
    if (!requestNodesAreSame(access.getExpression(), node)) return false;
    const member = Node.isPropertyAccessExpression(access)
      ? access.getName()
      : staticMemberName(access.getArgumentExpression());
    let target: Node = access;
    while (
      Node.isParenthesizedExpression(target.getParent()) ||
      Node.isAsExpression(target.getParent()) ||
      Node.isSatisfiesExpression(target.getParent())
    ) {
      target = target.getParent()!;
    }
    const invocation = target.getParent();
    return !!(
      member &&
      reviewedMethods.has(member) &&
      Node.isCallExpression(invocation) &&
      requestNodesAreSame(invocation.getExpression(), target)
    );
  });
}

function requestExpressionReferencesSymbol(expression: Node, target: string): boolean {
  const node = unwrapStaticExpression(expression);
  const identifiers = [
    ...(Node.isIdentifier(node) ? [node] : []),
    ...node.getDescendantsOfKind(SyntaxKind.Identifier),
  ];
  return identifiers.some((identifier) => {
    const symbol = identifier.getSymbol();
    return !!symbol && requestSymbolKey(symbol) === target;
  });
}

const requestGlobalIntrinsicMutationMemo = new WeakMap<SourceFile, Map<string, boolean>>();

function requestGlobalIntrinsicBindingIsMutated(name: string, sourceFile: SourceFile): boolean {
  let sourceMemo = requestGlobalIntrinsicMutationMemo.get(sourceFile);
  if (!sourceMemo) {
    sourceMemo = new Map();
    requestGlobalIntrinsicMutationMemo.set(sourceFile, sourceMemo);
  }
  const cached = sourceMemo.get(name);
  if (cached !== undefined) return cached;
  const result = requestGlobalIntrinsicBindingIsMutatedUncached(name, sourceFile);
  sourceMemo.set(name, result);
  return result;
}

function requestGlobalIntrinsicBindingIsMutatedUncached(
  name: string,
  sourceFile: SourceFile,
): boolean {
  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = assignment.getOperatorToken().getKind();
    if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
    const target = unwrapStaticExpression(assignment.getLeft());
    if (
      (Node.isIdentifier(target) &&
        target.getText() === name &&
        unshadowedGlobalIdentifier(target, name)) ||
      ((Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) &&
        staticMemberName(
          Node.isPropertyAccessExpression(target)
            ? target.getNameNode()
            : target.getArgumentExpression(),
        ) === name &&
        requestExpressionIsGlobalObject(target.getExpression()))
    ) {
      return true;
    }
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrapStaticExpression(call.getExpression());
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    if (!receiver || !member) continue;
    const objectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0);
    const reflectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0);
    const [target, property] = call.getArguments();
    if (!target || !requestExpressionIsGlobalObject(target)) continue;
    if ((objectGlobal || reflectGlobal) && ['defineProperty', 'set'].includes(member)) {
      const propertyName = staticMemberName(property);
      if (propertyName === undefined || propertyName === name) return true;
    }
    if (objectGlobal && member === 'assign') {
      for (const source of call.getArguments().slice(1)) {
        const object = resolveStaticObjectLiteral(source, new Set(), 0);
        if (!object) return true;
        if (
          object.getProperties().some((candidate) => {
            const propertyName = staticMemberName(requestObjectLiteralElementNameNode(candidate));
            return propertyName === undefined || propertyName === name;
          })
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function requestExpressionIsGlobalObject(expression: Node): boolean {
  const node = unwrapStaticExpression(expression);
  return (
    (Node.isIdentifier(node) &&
      (unshadowedGlobalIdentifier(node, 'globalThis') ||
        unshadowedGlobalIdentifier(node, 'global'))) ||
    false
  );
}

function requestCallIsPromiseSettlement(
  call: import('ts-morph').CallExpression,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): boolean {
  if (
    !context.provenance.promiseSettlementCallables.has(requestNodeIdentity(callable.declaration)) &&
    !requestCallableIsPromiseExecutor(callable, context.provenance)
  ) {
    return false;
  }
  const callee = unwrapStaticExpression(call.getExpression());
  for (const [index, parameter] of requestCallableParameters(callable.declaration)
    .slice(0, 2)
    .entries()) {
    const name = parameter.getNameNode();
    const symbol = Node.isIdentifier(name) ? name.getSymbol() : undefined;
    if (
      !symbol ||
      !requestWireExpressionResolvesToSymbol(
        callee,
        requestSymbolKey(symbol),
        new Set(),
        0,
        context.provenance,
      )
    ) {
      continue;
    }
    if (index === 0) {
      for (const argument of call.getArguments()) {
        scanRequestProtocolUse(argument, ['then'], call, callable, context);
      }
    }
    return true;
  }
  return false;
}

function requestCallableIsPromiseExecutor(
  callable: RequestCallable,
  session: RequestProvenanceSession,
): boolean {
  let expression = callable.declaration;
  while (
    Node.isParenthesizedExpression(expression.getParent()) ||
    Node.isAsExpression(expression.getParent()) ||
    Node.isSatisfiesExpression(expression.getParent())
  ) {
    expression = expression.getParent()!;
  }
  const parent = expression.getParent();
  if (
    Node.isNewExpression(parent) &&
    parent.getArguments()[0] === expression &&
    requestNewExpressionIsGlobalPromise(parent)
  ) {
    return true;
  }

  return callable.declaration
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.NewExpression)
    .some((construct) => {
      if (!requestNewExpressionIsGlobalPromise(construct)) return false;
      const executor = construct.getArguments()[0];
      return (
        !!executor &&
        resolveRequestCallable(executor, new Set(), 0, session).callables.some((candidate) =>
          requestNodesAreSame(candidate.declaration, callable.declaration),
        )
      );
    });
}

function requestNewExpressionIsGlobalPromise(construct: import('ts-morph').NewExpression): boolean {
  const callee = unwrapStaticExpression(construct.getExpression());
  return (
    Node.isIdentifier(callee) &&
    callee.getText() === 'Promise' &&
    unshadowedGlobalIdentifier(callee, 'Promise')
  );
}

function scanRequestKnownSafePrototypeMutations(
  call: import('ts-morph').CallExpression,
  member: string,
  context: RequestProcessScanContext,
): boolean {
  const candidates: Node[] = [];
  let mutated = false;
  const sourceFile = call.getSourceFile();
  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (
      assignment.getOperatorToken().getKind() < SyntaxKind.FirstAssignment ||
      assignment.getOperatorToken().getKind() > SyntaxKind.LastAssignment
    ) {
      continue;
    }
    const target = unwrapStaticExpression(assignment.getLeft());
    if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) {
      continue;
    }
    const assignedMember = Node.isPropertyAccessExpression(target)
      ? staticMemberName(target.getNameNode())
      : staticMemberName(target.getArgumentExpression());
    if (
      assignedMember === member &&
      requestExpressionIsKnownGlobalPrototype(target.getExpression(), new Set())
    ) {
      mutated = true;
      candidates.push(assignment.getRight());
    }
  }
  for (const expression of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrapStaticExpression(expression.getExpression());
    const receiver = requestCallReceiver(callee);
    if (!receiver) continue;
    const method = requestStaticCallMember(callee);
    const objectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0);
    const reflectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0);
    const [target, property, descriptorOrValue] = expression.getArguments();
    if (!target || !requestExpressionIsKnownGlobalPrototype(target, new Set())) continue;
    if (objectGlobal && method === 'assign') {
      for (const source of expression.getArguments().slice(1)) {
        const map = resolveStaticObjectLiteral(source, new Set(), 0);
        if (!map) {
          mutated = true;
          appendOpaqueRequestHandlerFact(context, source, '<dynamic-prototype-mutation>');
          continue;
        }
        const assigned = requestStaticObjectProperty(map, member);
        if (assigned) {
          mutated = true;
          candidates.push(requestHandlerPropertyExpression(assigned) ?? assigned);
        }
        if (
          map
            .getProperties()
            .some(
              (candidate) =>
                Node.isSpreadAssignment(candidate) ||
                staticMemberName(requestObjectLiteralElementNameNode(candidate)) === undefined,
            )
        ) {
          mutated = true;
          appendOpaqueRequestHandlerFact(context, source, '<computed-prototype-mutation>');
        }
      }
      continue;
    }
    if (reflectGlobal && method === 'set') {
      if (staticMemberName(property) === member && descriptorOrValue) {
        mutated = true;
        candidates.push(descriptorOrValue);
      }
      if (staticMemberName(property) === undefined) {
        mutated = true;
        appendOpaqueRequestHandlerFact(context, expression, '<computed-prototype-mutation>');
      }
      continue;
    }
    if ((objectGlobal || reflectGlobal) && method === 'defineProperty') {
      if (staticMemberName(property) === member && descriptorOrValue) {
        mutated = true;
        const value = requestConfigDescriptorValue(descriptorOrValue, context);
        if (value) candidates.push(value);
      }
      if (staticMemberName(property) === undefined) {
        mutated = true;
        appendOpaqueRequestHandlerFact(context, expression, '<computed-prototype-mutation>');
      }
      continue;
    }
    if (objectGlobal && method === 'defineProperties') {
      const descriptors = property;
      const map = descriptors ? resolveStaticObjectLiteral(descriptors, new Set(), 0) : undefined;
      const descriptor = map ? requestStaticObjectProperty(map, member) : undefined;
      if (descriptor) {
        mutated = true;
        const value = requestConfigDescriptorValue(
          requestHandlerPropertyExpression(descriptor) ?? descriptor,
          context,
        );
        if (value) candidates.push(value);
      } else if (!map) {
        mutated = true;
        appendOpaqueRequestHandlerFact(
          context,
          descriptors ?? expression,
          '<dynamic-prototype-mutation>',
        );
      }
    }
  }
  for (const candidate of dedupeRequestNodes(candidates)) {
    const resolution = resolveRequestCallable(candidate, new Set(), 0, context.provenance);
    if (resolution.callables.length === 0) {
      appendOpaqueRequestHandlerFact(
        context,
        candidate,
        resolution.opaqueModule ?? '<non-callable-prototype-mutation>',
      );
      continue;
    }
    for (const nested of resolution.callables) scanRequestCallable(nested, context);
  }
  return mutated;
}

function requestExpressionIsKnownGlobalPrototype(expression: Node, seen: Set<string>): boolean {
  const node = unwrapStaticExpression(expression);
  const key = `global-prototype:${requestNodeIdentity(node)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    const owner = unwrapStaticExpression(node.getExpression());
    if (member === 'prototype' && Node.isIdentifier(owner)) {
      const name = owner.getText();
      return (
        (REQUEST_SAFE_GLOBAL_CALLABLES.has(name) ||
          REQUEST_SAFE_GLOBAL_CONSTRUCTORS.has(name) ||
          REQUEST_SAFE_GLOBAL_NAMESPACES.has(name)) &&
        unshadowedGlobalIdentifier(owner, name)
      );
    }
  }
  if (!Node.isIdentifier(node) || !node.getSymbol()) return false;
  const symbolKey = requestSymbolKey(node.getSymbol()!);
  if (seen.has(symbolKey)) return false;
  seen.add(symbolKey);
  return node
    .getSymbol()!
    .getDeclarations()
    .some((declaration) => {
      const initializer = valueDeclarationInitializer(declaration);
      return initializer
        ? requestExpressionIsKnownGlobalPrototype(initializer, new Set(seen))
        : false;
    });
}

function requestExpressionHasMutableObjectOrigin(expression: Node, seen: Set<string>): boolean {
  const node = unwrapStaticExpression(expression);
  if (Node.isObjectLiteralExpression(node)) return true;
  if (Node.isConditionalExpression(node)) {
    return (
      requestExpressionHasMutableObjectOrigin(node.getWhenTrue(), new Set(seen)) ||
      requestExpressionHasMutableObjectOrigin(node.getWhenFalse(), new Set(seen))
    );
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (!symbol) return false;
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return false;
  seen.add(key);
  return symbol.getDeclarations().some((declaration) => {
    const initializer = valueDeclarationInitializer(declaration);
    return initializer
      ? requestExpressionHasMutableObjectOrigin(initializer, new Set(seen))
      : false;
  });
}

interface RequestNormalizedInvocation {
  readonly args?: readonly Node[];
  readonly target: Node;
}

function requestNormalizedCall(
  call: import('ts-morph').CallExpression,
): RequestNormalizedInvocation {
  const callee = unwrapStaticExpression(call.getExpression());
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  if (
    receiver &&
    member === 'apply' &&
    expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0)
  ) {
    const [target, _thisArg, argumentList] = call.getArguments();
    const args = requestStaticArgumentList(argumentList);
    return target
      ? { ...(args === undefined ? {} : { args }), target: unwrapStaticExpression(target) }
      : { target: callee };
  }
  if (receiver && member === 'call') {
    return { args: call.getArguments().slice(1), target: unwrapStaticExpression(receiver) };
  }
  if (receiver && member === 'apply') {
    const args = requestStaticArgumentList(call.getArguments()[1]);
    return {
      ...(args === undefined ? {} : { args }),
      target: unwrapStaticExpression(receiver),
    };
  }
  return { args: call.getArguments(), target: callee };
}

function requestGovernedFetchInvocation(
  call: import('ts-morph').CallExpression,
): RequestNormalizedInvocation | undefined {
  const invocation = requestNormalizedCall(call);
  return requestExpressionResolvesToGovernedFetchTarget(invocation.target, new Set())
    ? invocation
    : undefined;
}

function requestExpressionResolvesToGovernedFetchTarget(
  expression: Node,
  seen: Set<string>,
): boolean {
  const node = unwrapStaticExpression(expression);
  if (expressionResolvesToGlobalCallable(node, 'fetch', new Set(), 0, false)) return true;
  if (
    Node.isBinaryExpression(node) &&
    node.getOperatorToken().getKind() === SyntaxKind.CommaToken
  ) {
    return requestExpressionResolvesToGovernedFetchTarget(node.getRight(), seen);
  }
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    if (receiver && requestStaticCallMember(callee) === 'bind') {
      return requestExpressionResolvesToGovernedFetchTarget(receiver, seen);
    }
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (!symbol) return false;
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return false;
  seen.add(key);
  for (const declaration of symbol.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (initializer && requestExpressionResolvesToGovernedFetchTarget(initializer, seen)) {
      return true;
    }
  }
  return false;
}

function requestCallIsGovernedFetch(call: import('ts-morph').CallExpression): boolean {
  return requestGovernedFetchInvocation(call) !== undefined;
}

function scanOutboundFetchConfidentiality(
  call: import('ts-morph').CallExpression,
  args: readonly Node[] | undefined,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  if (!callable.rootFactory) return;
  if (!args) {
    appendRequestAuthorityFact(
      context,
      call,
      {
        safePath: REQUEST_FETCH_CREDENTIAL_SAFE_PATH,
        sink: 'outbound-fetch.dynamic-arguments',
      },
      call,
    );
    return;
  }
  const state: RequestWireAnalysisState = {
    bindingKey: 'root',
    bindings: new Map(),
    rootCallable: callable,
    session: context.provenance,
    scopeCallable: callable,
  };
  for (const argument of args) {
    for (const authority of requestWireAuthoritiesForExpression(argument, state)) {
      const outbound = authority.sink.startsWith('client-wire.request')
        ? {
            safePath: REQUEST_FETCH_CREDENTIAL_SAFE_PATH,
            sink: `outbound-fetch.${authority.sink.slice('client-wire.'.length)}`,
          }
        : authority;
      appendRequestAuthorityFact(context, call, outbound, authority.source);
    }
  }
}

function scanRequestGovernedFetchProtocols(
  call: import('ts-morph').CallExpression,
  args: readonly Node[] | undefined,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): void {
  if (!args) {
    appendRequestProtocolFact(context, call, 'fetch-arguments', call.getExpression());
    return;
  }
  const [input, init] = args;
  if (input) {
    const role = requestExpressionRootParameterRole(input, callable, new Set(), 0);
    const node = unwrapStaticExpression(input);
    const exactRequest =
      role === 'request' ||
      (Node.isNewExpression(node) &&
        Node.isIdentifier(unwrapStaticExpression(node.getExpression())) &&
        unshadowedGlobalIdentifier(unwrapStaticExpression(node.getExpression()), 'Request'));
    if (!exactRequest) {
      scanRequestProtocolUse(input, REQUEST_TO_PRIMITIVE_HOOKS, call, callable, context);
    }
  }
  if (init) {
    scanRequestRecordPrimitiveValues(init, call, callable, context, 'fetch-init-values', new Set());
  }
}

function requestReflectiveTargetIsClosed(
  call: import('ts-morph').CallExpression,
  member: 'apply' | 'construct',
  callable: RequestCallable,
  context: RequestProcessScanContext,
): boolean {
  const [target] = call.getArguments();
  if (!target) return false;
  const resolution = resolveRequestCallable(target, new Set(), 0, context.provenance);
  if (resolution.callables.length > 0) {
    for (const nested of resolution.callables) scanRequestCallable(nested, context);
    return true;
  }
  if (resolution.opaqueModule !== undefined) return false;
  if (
    Node.isIdentifier(target) &&
    REQUEST_SAFE_GLOBAL_CALLABLES.has(target.getText()) &&
    unshadowedGlobalIdentifier(target, target.getText())
  ) {
    return member === 'apply';
  }
  if (
    member === 'construct' &&
    Node.isIdentifier(target) &&
    REQUEST_SAFE_GLOBAL_CONSTRUCTORS.has(target.getText()) &&
    unshadowedGlobalIdentifier(target, target.getText())
  ) {
    return true;
  }
  if (requestImportedModuleExportForExpression(target, isReviewedSafeBuiltinModule, new Set(), 0)) {
    return true;
  }
  return (
    member === 'construct' && requestKnownLocalClassConstructorIsClosed(target, callable, context)
  );
}

function requestReflectiveOperationIsClosed(
  call: import('ts-morph').CallExpression,
  member: string,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): boolean {
  const [target, property] = call.getArguments();
  if (!target || opaqueBareModuleForExpression(target, new Set(), 0)) return false;
  if (member === 'get' || member === 'set') {
    const propertyName = staticMemberName(property);
    for (const accessor of requestAccessorCallablesForExpression(target, propertyName, new Set())) {
      scanRequestCallable(accessor, context);
    }
  }
  return requestExpressionIsIntrinsicValue(target, callable, new Set(), 0);
}

function requestAccessorCallablesForExpression(
  expression: Node,
  member: string | undefined,
  seen: Set<string>,
  session: RequestProvenanceSession = createRequestProvenanceSession(),
): RequestCallable[] {
  const node = unwrapStaticExpression(expression);
  const direct = requestCallableForFunctionNode(node);
  if (direct && member === undefined) return [direct];
  const nodeKey = `node:${requestNodeIdentity(node)}:${member ?? '*'}`;
  if (seen.has(nodeKey) || !requestProvenanceStep(session, node)) return [];
  seen.add(nodeKey);
  if (Node.isConditionalExpression(node)) {
    return [node.getWhenTrue(), node.getWhenFalse()].flatMap((branch) =>
      requestAccessorCallablesForExpression(branch, member, new Set(seen), session),
    );
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return [node.getLeft(), node.getRight()].flatMap((branch) =>
        requestAccessorCallablesForExpression(branch, member, new Set(seen), session),
      );
    }
  }
  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().flatMap((property) => {
      if (
        (Node.isGetAccessorDeclaration(property) ||
          Node.isSetAccessorDeclaration(property) ||
          Node.isMethodDeclaration(property)) &&
        (member === undefined || requestCallableMemberName(property.getNameNode()) === member)
      ) {
        const callable = requestCallableForFunctionNode(property);
        return callable ? [callable] : [];
      }
      if (Node.isSpreadAssignment(property)) {
        return requestAccessorCallablesForExpression(
          property.getExpression(),
          member,
          new Set(seen),
          session,
        );
      }
      if (
        member !== undefined &&
        requestCallableMemberName(requestObjectLiteralElementNameNode(property)) === member
      ) {
        const nested = requestHandlerPropertyExpression(property);
        return nested ? resolveRequestCallable(nested, new Set(), 0, session).callables : [];
      }
      if (member !== undefined) return [];
      const nested = Node.isPropertyAssignment(property)
        ? property.getInitializer()
        : Node.isShorthandPropertyAssignment(property)
          ? property.getNameNode()
          : undefined;
      return nested
        ? requestAccessorCallablesForExpression(nested, undefined, new Set(seen), session)
        : [];
    });
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node
      .getElements()
      .flatMap((element) =>
        requestAccessorCallablesForExpression(
          Node.isSpreadElement(element) ? element.getExpression() : element,
          undefined,
          new Set(seen),
          session,
        ),
      );
  }
  if (Node.isNewExpression(node)) {
    const declared = requestClassDeclarationsForExpression(node.getExpression(), new Set()).flatMap(
      (declaration) =>
        [
          ...declaration.getGetAccessors(),
          ...declaration.getSetAccessors(),
          ...declaration.getMethods(),
        ]
          .filter(
            (property) =>
              member === undefined || requestCallableMemberName(property.getNameNode()) === member,
          )
          .flatMap((property) => {
            const callable = requestCallableForFunctionNode(property);
            return callable ? [callable] : [];
          }),
    );
    const assigned =
      member === undefined
        ? []
        : requestClassFactoryMemberValues(node, member, session).flatMap(
            (candidate) => resolveRequestCallable(candidate, new Set(), 0, session).callables,
          );
    return [
      ...declared,
      ...assigned,
      ...requestClassPrototypeMutationCallables(node.getExpression(), member, session),
    ];
  }
  if (Node.isCallExpression(node)) {
    return resolveRequestCallable(node.getExpression(), new Set(), 0, session).callables.flatMap(
      (resolved) =>
        requestWireOutputExpressions(resolved).flatMap((output) =>
          requestAccessorCallablesForExpression(output, member, new Set(seen), session),
        ),
    );
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const projectedMember = Node.isPropertyAccessExpression(node)
      ? node.getName()
      : staticMemberName(node.getArgumentExpression());
    const projected = projectedMember
      ? requestWireProjectedExpression(node.getExpression(), [projectedMember], new Set(), 0)
      : undefined;
    return projected
      ? requestAccessorCallablesForExpression(projected, member, new Set(seen), session)
      : [];
  }
  if (!Node.isIdentifier(node)) return [];
  const symbol = node.getSymbol();
  if (!symbol) return [];
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return [];
  seen.add(key);
  const declarations = [...symbol.getDeclarations()];
  try {
    const aliased = symbol.getAliasedSymbol();
    if (aliased && aliased !== symbol) declarations.push(...aliased.getDeclarations());
  } catch {
    // Bare-package aliases remain opaque at the call/root classifier.
  }
  const callables = declarations.flatMap((declaration) => {
    const declaredCallable = requestCallableForFunctionNode(declaration);
    if (declaredCallable && member === undefined) return [declaredCallable];
    const initializer = valueDeclarationInitializer(declaration);
    return initializer
      ? requestAccessorCallablesForExpression(initializer, member, new Set(seen), session)
      : [];
  });
  for (const getter of requestDefinedGetterExpressions(node, member)) {
    callables.push(...resolveRequestCallable(getter, new Set(), 0, session).callables);
  }
  return dedupeRequestCallables(callables);
}

function requestClassPrototypeMutationCallables(
  classExpression: Node,
  member: string | undefined,
  session: RequestProvenanceSession,
): RequestCallable[] {
  if (member === undefined) return [];
  const classes = requestClassDeclarationsForExpression(classExpression, new Set());
  if (classes.length === 0) return [];
  const candidates: Node[] = [];
  const sourceFiles = new Set(classes.map((declaration) => declaration.getSourceFile()));
  for (const sourceFile of sourceFiles) {
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (
        assignment.getOperatorToken().getKind() < SyntaxKind.FirstAssignment ||
        assignment.getOperatorToken().getKind() > SyntaxKind.LastAssignment
      ) {
        continue;
      }
      const target = unwrapStaticExpression(assignment.getLeft());
      if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) {
        continue;
      }
      const assignedMember = Node.isPropertyAccessExpression(target)
        ? requestCallableMemberName(target.getNameNode())
        : requestCallableMemberName(target.getArgumentExpression());
      if (
        assignedMember === member &&
        requestExpressionResolvesToClassPrototype(target.getExpression(), classes)
      ) {
        candidates.push(assignment.getRight());
      }
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = unwrapStaticExpression(call.getExpression());
      const receiver = requestCallReceiver(callee);
      if (!receiver) continue;
      const method = requestStaticCallMember(callee);
      const objectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0);
      const reflectGlobal = expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0);
      const [target, property, descriptorOrValue] = call.getArguments();
      if (!target || !requestExpressionResolvesToClassPrototype(target, classes)) continue;
      if (reflectGlobal && method === 'set') {
        if (requestCallableMemberName(property) === member && descriptorOrValue) {
          candidates.push(descriptorOrValue);
        }
        continue;
      }
      if ((objectGlobal || reflectGlobal) && method === 'defineProperty') {
        if (requestCallableMemberName(property) === member && descriptorOrValue) {
          const value = requestStaticDescriptorValue(descriptorOrValue);
          if (value) candidates.push(value);
        }
        continue;
      }
      if (objectGlobal && method === 'defineProperties') {
        const map = property ? resolveStaticObjectLiteral(property, new Set(), 0) : undefined;
        const descriptor = map ? requestStaticObjectProperty(map, member) : undefined;
        const value = descriptor
          ? requestStaticDescriptorValue(requestHandlerPropertyExpression(descriptor) ?? descriptor)
          : undefined;
        if (value) candidates.push(value);
        continue;
      }
      if (objectGlobal && method === 'assign') {
        for (const source of call.getArguments().slice(1)) {
          const object = resolveStaticObjectLiteral(source, new Set(), 0);
          const property = object ? requestStaticObjectProperty(object, member) : undefined;
          if (property) candidates.push(requestHandlerPropertyExpression(property) ?? property);
        }
      }
    }
  }
  return dedupeRequestNodes(candidates).flatMap(
    (candidate) => resolveRequestCallable(candidate, new Set(), 0, session).callables,
  );
}

function requestExpressionResolvesToClassPrototype(
  expression: Node,
  classes: readonly (import('ts-morph').ClassDeclaration | import('ts-morph').ClassExpression)[],
): boolean {
  const node = unwrapStaticExpression(expression);
  if (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) return false;
  const member = Node.isPropertyAccessExpression(node)
    ? staticMemberName(node.getNameNode())
    : staticMemberName(node.getArgumentExpression());
  if (member !== 'prototype') return false;
  const resolved = requestClassDeclarationsForExpression(node.getExpression(), new Set());
  const targets = new Set(classes.map(requestNodeIdentity));
  return resolved.some((declaration) => targets.has(requestNodeIdentity(declaration)));
}

function requestStaticDescriptorValue(descriptor: Node): Node | undefined {
  const object = resolveStaticObjectLiteral(descriptor, new Set(), 0);
  if (!object || object.getProperties().some(Node.isSpreadAssignment)) return undefined;
  const value = requestStaticObjectProperty(object, 'value');
  if (!value || Node.isGetAccessorDeclaration(value) || Node.isSetAccessorDeclaration(value)) {
    return undefined;
  }
  return requestHandlerPropertyExpression(value) ?? value;
}

function requestJsonSerializationOutputExpressions(
  expression: Node,
  session: RequestProvenanceSession,
): Node[] {
  const callables = requestAccessorCallablesForExpression(expression, 'toJSON', new Set(), session);
  const node = unwrapStaticExpression(expression);
  if (Node.isIdentifier(node)) {
    for (const assigned of requestAssignedMemberExpressions(node, 'toJSON', node.getStart())) {
      callables.push(...resolveRequestCallable(assigned, new Set(), 0, session).callables);
    }
  }
  return dedupeRequestCallables(callables).flatMap((callable) =>
    requestWireOutputExpressions(callable),
  );
}

function requestExpressionIsFetchResponse(expression: Node, seen: Set<string>): boolean {
  const node = unwrapStaticExpression(expression);
  if (Node.isAwaitExpression(node)) {
    return requestExpressionIsFetchResponse(node.getExpression(), seen);
  }
  if (Node.isCallExpression(node)) {
    if (requestCallIsGovernedFetch(node)) return true;
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    return !!(
      receiver &&
      requestStaticCallMember(callee) === 'clone' &&
      requestExpressionIsFetchResponse(receiver, seen)
    );
  }
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return false;
    seen.add(key);
    for (const declaration of symbol.getDeclarations()) {
      const initializer = valueDeclarationInitializer(declaration);
      if (initializer && requestExpressionIsFetchResponse(initializer, seen)) return true;
    }
  }
  const declaration = localValueDeclaration(node);
  const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
  return initializer ? requestExpressionIsFetchResponse(initializer, seen) : false;
}

function requestCallIsReviewedPureDrizzleExpression(
  call: import('ts-morph').CallExpression,
): boolean {
  const imported = requestImportedModuleExportForExpression(
    call.getExpression(),
    (specifier) => specifier === 'drizzle-orm',
    new Set(),
    0,
  );
  return !!(
    imported &&
    REQUEST_REVIEWED_DRIZZLE_EXPRESSIONS.has(imported.exportName) &&
    requestDrizzleColumnBuilderProtocolsArePristine(call)
  );
}

interface RequestReviewedDrizzleTable {
  readonly columns: import('ts-morph').ObjectLiteralExpression;
  readonly declaration: import('ts-morph').VariableDeclaration;
}

function requestPropertyAccessIsReviewedDrizzleColumn(
  access: import('ts-morph').PropertyAccessExpression | import('ts-morph').ElementAccessExpression,
  member: string,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): boolean {
  const table = requestReviewedDrizzleTableForDirectReference(access.getExpression());
  if (!table || !requestReviewedDrizzleTableHasColumn(table, member)) return false;
  if (!requestReviewedDrizzleTableIsPristine(table, callable, context)) return false;
  return requestNodeIsReviewedDrizzleDataArgument(access, callable);
}

function requestReviewedDrizzleTableForDirectReference(
  expression: Node,
): RequestReviewedDrizzleTable | undefined {
  const node = unwrapStaticExpression(expression);
  if (!Node.isIdentifier(node)) return undefined;
  const symbol = node.getSymbol();
  if (!symbol) return undefined;
  const symbols = [symbol];
  const seen = new Set<string>();
  while (symbols.length > 0) {
    const candidate = symbols.pop()!;
    const key = requestSymbolKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const aliased = candidate.getAliasedSymbol();
      if (aliased && aliased !== candidate) symbols.push(aliased);
    } catch {
      // Unresolved imports remain closed below.
    }
    for (const declaration of candidate.getDeclarations()) {
      if (!Node.isVariableDeclaration(declaration)) continue;
      const statement = declaration.getVariableStatement();
      const initializer = declaration.getInitializer();
      if (
        !statement ||
        statement.getParent() !== declaration.getSourceFile() ||
        statement.getDeclarationKind() !== VariableDeclarationKind.Const ||
        !initializer
      ) {
        continue;
      }
      const call = unwrapStaticExpression(initializer);
      if (!Node.isCallExpression(call)) continue;
      if (
        !requestExpressionIsDirectImportedExport(
          call.getExpression(),
          'drizzle-orm/pg-core',
          'pgTable',
        ) ||
        !requestDrizzleColumnBuilderProtocolsArePristine(call)
      ) {
        continue;
      }
      const [name, columns, extra] = call.getArguments();
      const columnRecord = columns ? unwrapStaticExpression(columns) : undefined;
      if (
        !name ||
        !isStringLiteralLike(unwrapStaticExpression(name)) ||
        !columnRecord ||
        !Node.isObjectLiteralExpression(columnRecord) ||
        !requestDrizzleColumnsObjectIsClosed(columnRecord) ||
        (extra !== undefined && !requestDrizzleExtraConfigIsClosed(extra, columnRecord))
      ) {
        continue;
      }
      return {
        columns: columnRecord,
        declaration,
      };
    }
  }
  return undefined;
}

const REQUEST_DRIZZLE_COLUMN_BUILDER_PROTOCOLS_PRISTINE_MEMO = new WeakMap<object, boolean>();

function requestDrizzleRuntimeModuleSpecifier(module: string): boolean {
  return module === 'drizzle-orm' || module.startsWith('drizzle-orm/');
}

function requestDrizzleRuntimeExportIsReviewed(module: string, exportName: string): boolean {
  if (module === 'drizzle-orm') return REQUEST_REVIEWED_DRIZZLE_EXPRESSIONS.has(exportName);
  if (module === 'drizzle-orm/pg-core') {
    return exportName === 'pgTable' || REQUEST_REVIEWED_PG_COLUMN_BUILDERS.has(exportName);
  }
  return false;
}

function requestDrizzleBuilderFactoryCallIsDirectColumnInitializer(
  factoryCall: import('ts-morph').CallExpression,
): boolean {
  let current: Node = factoryCall;
  while (true) {
    const parent = current.getParent();
    if (!parent) return false;
    if (
      Node.isParenthesizedExpression(parent) ||
      Node.isAsExpression(parent) ||
      Node.isSatisfiesExpression(parent) ||
      Node.isTypeAssertion(parent) ||
      Node.isNonNullExpression(parent)
    ) {
      current = parent;
      continue;
    }
    if (
      (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) &&
      requestNodesAreSame(parent.getExpression(), current)
    ) {
      const invocation = parent.getParentIfKind(SyntaxKind.CallExpression);
      if (invocation && requestNodesAreSame(invocation.getExpression(), parent)) {
        current = invocation;
        continue;
      }
      return false;
    }
    if (
      Node.isPropertyAssignment(parent) &&
      !!parent.getInitializer() &&
      requestNodesAreSame(unwrapStaticExpression(parent.getInitializer()!), current)
    ) {
      const columns = parent.getParentIfKind(SyntaxKind.ObjectLiteralExpression);
      const tableCall = columns?.getParentIfKind(SyntaxKind.CallExpression);
      return !!(
        columns &&
        tableCall &&
        tableCall.getArguments()[1] &&
        requestNodesAreSame(unwrapStaticExpression(tableCall.getArguments()[1]!), columns) &&
        requestExpressionIsDirectImportedExport(
          tableCall.getExpression(),
          'drizzle-orm/pg-core',
          'pgTable',
        )
      );
    }
    return false;
  }
}

function requestReviewedDrizzleExpressionCallIsDirectDbArgument(
  expressionCall: import('ts-morph').CallExpression,
): boolean {
  let current: Node = expressionCall;
  while (true) {
    const parent = current.getParent();
    if (!parent) return false;
    if (
      Node.isParenthesizedExpression(parent) ||
      Node.isAsExpression(parent) ||
      Node.isSatisfiesExpression(parent) ||
      Node.isTypeAssertion(parent) ||
      Node.isNonNullExpression(parent)
    ) {
      current = parent;
      continue;
    }
    if (
      !Node.isCallExpression(parent) ||
      !parent.getArguments().some((argument) => requestNodesAreSame(argument, current))
    ) {
      return false;
    }
    const nested = requestImportedModuleExportForExpression(
      parent.getExpression(),
      (specifier) => specifier === 'drizzle-orm',
      new Set(),
      0,
    );
    if (nested && REQUEST_REVIEWED_DRIZZLE_EXPRESSIONS.has(nested.exportName)) {
      current = parent;
      continue;
    }
    const member = requestStaticCallMember(unwrapStaticExpression(parent.getExpression()));
    return !!member && REQUEST_REVIEWED_DRIZZLE_DB_DATA_METHODS.has(member);
  }
}

function requestDrizzleColumnBuilderProtocolsArePristine(
  schemaCall: import('ts-morph').CallExpression,
): boolean {
  const project = schemaCall.getSourceFile().getProject();
  const memoized = REQUEST_DRIZZLE_COLUMN_BUILDER_PROTOCOLS_PRISTINE_MEMO.get(project);
  if (memoized !== undefined) return memoized;
  let pristine = true;
  for (const sourceFile of project.getSourceFiles()) {
    for (const declaration of sourceFile.getImportDeclarations()) {
      const module = declaration.getModuleSpecifierValue();
      if (!requestDrizzleRuntimeModuleSpecifier(module)) continue;
      if (declaration.isTypeOnly()) continue;
      if (declaration.getNamespaceImport() || declaration.getDefaultImport()) {
        pristine = false;
        break;
      }
      for (const imported of declaration.getNamedImports()) {
        if (imported.isTypeOnly()) continue;
        const exportName = imported.getName();
        if (!requestDrizzleRuntimeExportIsReviewed(module, exportName)) {
          pristine = false;
          break;
        }
      }
      if (!pristine) break;
    }
    if (!pristine) break;
    for (const declaration of sourceFile.getExportDeclarations()) {
      const module = declaration.getModuleSpecifierValue();
      if (!module || !requestDrizzleRuntimeModuleSpecifier(module)) continue;
      if (declaration.isTypeOnly()) continue;
      const exported = declaration.getNamedExports();
      if (
        exported.length === 0 ||
        exported.some(
          (specifier) =>
            !specifier.isTypeOnly() &&
            !requestDrizzleRuntimeExportIsReviewed(module, specifier.getName()),
        )
      ) {
        pristine = false;
        break;
      }
    }
    if (!pristine) break;
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callTarget = unwrapStaticExpression(call.getExpression());
      if (
        callTarget.getKind() === SyntaxKind.ImportKeyword ||
        (Node.isIdentifier(callTarget) && callTarget.getText() === 'require')
      ) {
        const [specifier] = call.getArguments();
        const value =
          specifier && isStringLiteralLike(specifier) ? specifier.getLiteralText() : undefined;
        if (value && requestDrizzleRuntimeModuleSpecifier(value)) {
          pristine = false;
          break;
        }
      }
      const imported = requestImportedModuleExportForExpression(
        call.getExpression(),
        requestDrizzleRuntimeModuleSpecifier,
        new Set(),
        0,
      );
      if (!imported) continue;
      if (
        imported.module === 'drizzle-orm/pg-core' &&
        REQUEST_REVIEWED_PG_COLUMN_BUILDERS.has(imported.exportName) &&
        !requestDrizzleBuilderFactoryCallIsDirectColumnInitializer(call)
      ) {
        pristine = false;
        break;
      }
      if (
        imported.module === 'drizzle-orm' &&
        REQUEST_REVIEWED_DRIZZLE_EXPRESSIONS.has(imported.exportName) &&
        !requestReviewedDrizzleExpressionCallIsDirectDbArgument(call)
      ) {
        pristine = false;
        break;
      }
    }
    if (!pristine) break;
  }
  REQUEST_DRIZZLE_COLUMN_BUILDER_PROTOCOLS_PRISTINE_MEMO.set(project, pristine);
  return pristine;
}

function requestDrizzleColumnsObjectIsClosed(
  columns: import('ts-morph').ObjectLiteralExpression,
): boolean {
  return columns.getProperties().every((property) => {
    if (!Node.isPropertyAssignment(property)) return false;
    const name = property.getNameNode();
    const initializer = property.getInitializer();
    return !!(
      (!Node.isComputedPropertyName(name) || staticMemberName(name) !== undefined) &&
      initializer &&
      requestDrizzleColumnInitializerIsClosed(initializer)
    );
  });
}

function requestDrizzleColumnInitializerIsClosed(expression: Node): boolean {
  const node = unwrapStaticExpression(expression);
  if (!Node.isCallExpression(node)) return false;
  for (const exportName of REQUEST_REVIEWED_PG_COLUMN_BUILDERS) {
    if (
      requestExpressionIsDirectImportedExport(
        node.getExpression(),
        'drizzle-orm/pg-core',
        exportName,
      )
    ) {
      return node.getArguments().every(requestExpressionIsClosedStaticData);
    }
  }
  const callee = unwrapStaticExpression(node.getExpression());
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  if (receiver && member === 'references' && requestDrizzleColumnInitializerIsClosed(receiver)) {
    const [reference, options, ...extra] = node.getArguments();
    return !!(
      reference &&
      extra.length === 0 &&
      requestDrizzleReferenceCallbackIsClosed(reference) &&
      (options === undefined || requestExpressionIsClosedStaticData(options))
    );
  }
  return !!(
    receiver &&
    member &&
    REQUEST_REVIEWED_PG_COLUMN_METHODS.has(member) &&
    requestDrizzleColumnInitializerIsClosed(receiver) &&
    node.getArguments().every(requestExpressionIsClosedStaticData)
  );
}

function requestDrizzleReferenceCallbackIsClosed(expression: Node): boolean {
  const callable = requestCallableForFunctionNode(unwrapStaticExpression(expression));
  if (
    !callable ||
    !Node.isArrowFunction(callable.declaration) ||
    Node.isBlock(callable.declaration.getBody()) ||
    requestCallableParameters(callable.declaration).length !== 0
  ) {
    return false;
  }
  const outputs = requestWireOutputExpressions(callable);
  if (outputs.length !== 1) return false;
  const output = unwrapStaticExpression(outputs[0]!);
  if (!Node.isPropertyAccessExpression(output) && !Node.isElementAccessExpression(output)) {
    return false;
  }
  const member = Node.isPropertyAccessExpression(output)
    ? staticMemberName(output.getNameNode())
    : staticMemberName(output.getArgumentExpression());
  if (!member) return false;
  const table = requestReviewedDrizzleTableForDirectReference(output.getExpression());
  return !!table && requestReviewedDrizzleTableHasColumn(table, member);
}

function requestDrizzleReferenceCallbackIsExactArgument(expression: Node): boolean {
  const callable = requestCallableForFunctionNode(unwrapStaticExpression(expression));
  if (!callable || !requestDrizzleReferenceCallbackIsClosed(expression)) return false;
  const parent = callable.declaration.getParent();
  if (
    !Node.isCallExpression(parent) ||
    !parent.getArguments().some((argument) => requestNodesAreSame(argument, callable.declaration))
  ) {
    return false;
  }
  const callee = unwrapStaticExpression(parent.getExpression());
  return requestStaticCallMember(callee) === 'references';
}

function requestDrizzleExtraConfigIsClosed(
  expression: Node,
  columns: import('ts-morph').ObjectLiteralExpression,
): boolean {
  const node = unwrapStaticExpression(expression);
  if (!Node.isCallExpression(node)) return false;
  if (!requestExpressionIsDirectImportedExport(node.getExpression(), '@kovojs/drizzle', 'kovo')) {
    return false;
  }
  const [config, ...extra] = node.getArguments();
  return !!config && extra.length === 0 && requestDrizzleKovoConfigValueIsClosed(config, columns);
}

function requestDrizzleKovoConfigValueIsClosed(
  expression: Node,
  columns: import('ts-morph').ObjectLiteralExpression,
  seen = new Set<string>(),
): boolean {
  const node = unwrapStaticExpression(expression);
  if (requestExpressionIsClosedStaticData(node)) return true;
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol();
    if (!symbol) return false;
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return false;
    seen.add(key);

    const symbols = [symbol];
    const visited = new Set<string>();
    const initializers: Node[] = [];
    let invalidDeclaration = false;
    while (symbols.length > 0) {
      const candidate = symbols.pop()!;
      const candidateKey = requestSymbolKey(candidate);
      if (visited.has(candidateKey)) continue;
      visited.add(candidateKey);
      try {
        const aliased = candidate.getAliasedSymbol();
        if (aliased && aliased !== candidate) symbols.push(aliased);
      } catch {
        // Unresolved package/import aliases remain closed below.
      }
      for (const declaration of candidate.getDeclarations()) {
        if (
          Node.isImportSpecifier(declaration) ||
          Node.isImportClause(declaration) ||
          Node.isExportSpecifier(declaration)
        ) {
          continue;
        }
        if (
          !Node.isVariableDeclaration(declaration) ||
          declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
        ) {
          invalidDeclaration = true;
          continue;
        }
        const initializer = declaration.getInitializer();
        if (!initializer) invalidDeclaration = true;
        else initializers.push(initializer);
      }
    }
    return !!(
      !invalidDeclaration &&
      initializers.length > 0 &&
      initializers.every((initializer) =>
        requestDrizzleKovoConfigValueIsClosed(initializer, columns, new Set(seen)),
      )
    );
  }
  if (Node.isCallExpression(node) && requestCallIsExactClosedDomainDeclaration(node)) {
    return requestExactDomainResultIsPristine(node);
  }
  const callable = requestCallableForFunctionNode(node);
  if (callable) return requestDrizzleTableSelectorCallbackIsClosed(callable, columns);
  if (Node.isArrayLiteralExpression(node)) {
    return node
      .getElements()
      .every(
        (element) =>
          !Node.isSpreadElement(element) &&
          requestDrizzleKovoConfigValueIsClosed(element, columns, new Set(seen)),
      );
  }
  if (!Node.isObjectLiteralExpression(node)) return false;
  return node.getProperties().every((property) => {
    if (!Node.isPropertyAssignment(property)) return false;
    const name = property.getNameNode();
    const initializer = property.getInitializer();
    return !!(
      (!Node.isComputedPropertyName(name) || staticMemberName(name) !== undefined) &&
      initializer &&
      requestDrizzleKovoConfigValueIsClosed(initializer, columns, new Set(seen))
    );
  });
}

function requestCallIsExactClosedDomainDeclaration(
  call: import('ts-morph').CallExpression,
): boolean {
  if (!requestExpressionIsDirectImportedExport(call.getExpression(), '@kovojs/server', 'domain')) {
    return false;
  }
  const args = call.getArguments();
  return args.length <= 1 && args.every(requestExpressionIsClosedStaticData);
}

function requestExpressionResolvesToExactDomainCall(
  expression: Node,
  target: import('ts-morph').CallExpression,
  seen: Set<string>,
): boolean {
  const node = unwrapStaticExpression(expression);
  if (requestNodesAreSame(node, target)) return true;
  if (!Node.isIdentifier(node)) return false;
  const symbol = node.getSymbol();
  if (!symbol) return false;
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return false;
  seen.add(key);
  const symbols = [symbol];
  const visited = new Set<string>();
  while (symbols.length > 0) {
    const candidate = symbols.pop()!;
    const candidateKey = requestSymbolKey(candidate);
    if (visited.has(candidateKey)) continue;
    visited.add(candidateKey);
    try {
      const aliased = candidate.getAliasedSymbol();
      if (aliased && aliased !== candidate) symbols.push(aliased);
    } catch {
      // Unresolved aliases do not resolve to the exact local domain declaration.
    }
    for (const declaration of candidate.getDeclarations()) {
      if (
        Node.isVariableDeclaration(declaration) &&
        declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const
      ) {
        const initializer = declaration.getInitializer();
        if (
          initializer &&
          requestExpressionContainsIdentityCarrier(
            initializer,
            (candidate) =>
              !!candidate &&
              requestExpressionResolvesToExactDomainCall(candidate, target, new Set(seen)),
            new Set(seen),
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function requestDomainValueContainerIsReviewed(expression: Node): boolean {
  let current = expression;
  while (true) {
    const parent = current.getParent();
    if (!parent) return false;
    if (
      Node.isPropertyAssignment(parent) ||
      Node.isShorthandPropertyAssignment(parent) ||
      Node.isArrayLiteralExpression(parent) ||
      Node.isObjectLiteralExpression(parent) ||
      Node.isParenthesizedExpression(parent) ||
      Node.isAsExpression(parent) ||
      Node.isSatisfiesExpression(parent) ||
      Node.isTypeAssertion(parent) ||
      Node.isNonNullExpression(parent)
    ) {
      current = parent;
      continue;
    }
    if (
      !Node.isCallExpression(parent) ||
      !parent.getArguments().some((argument) => requestNodesAreSame(argument, current))
    ) {
      return false;
    }
    return (
      requestExpressionIsDirectImportedExport(parent.getExpression(), '@kovojs/drizzle', 'kovo') ||
      ['mutation', 'query'].some((exportName) =>
        requestExpressionIsDirectImportedExport(
          parent.getExpression(),
          '@kovojs/server',
          exportName,
        ),
      )
    );
  }
}

function requestExactDomainResultIsPristine(target: import('ts-morph').CallExpression): boolean {
  const resolves = (candidate: Node | undefined): boolean =>
    !!candidate && requestExpressionResolvesToExactDomainCall(candidate, target, new Set());
  const contains = (candidate: Node | undefined): boolean =>
    requestExpressionContainsIdentityCarrier(candidate, resolves, new Set());
  const isMember = (candidate: Node | undefined): boolean => {
    if (!candidate) return false;
    let node = unwrapStaticExpression(candidate);
    if (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node)) {
      return false;
    }
    while (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
      node = unwrapStaticExpression(node.getExpression());
    }
    return resolves(node);
  };

  for (const sourceFile of target.getSourceFile().getProject().getSourceFiles()) {
    for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const initializer = declaration.getInitializer();
      if (
        initializer &&
        contains(initializer) &&
        declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
      ) {
        return false;
      }
    }
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const operator = assignment.getOperatorToken().getKind();
      if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
      if (isMember(assignment.getLeft()) || contains(assignment.getRight())) return false;
    }
    for (const deletion of sourceFile.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
      if (isMember(deletion.getExpression())) return false;
    }
    for (const update of [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
    ]) {
      if (isMember(update.getOperand())) return false;
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      for (const argument of call.getArguments()) {
        if (contains(argument) && !requestDomainValueContainerIsReviewed(argument)) {
          return false;
        }
      }
    }
    for (const object of sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      for (const property of object.getProperties()) {
        const value = Node.isPropertyAssignment(property)
          ? property.getInitializer()
          : Node.isShorthandPropertyAssignment(property)
            ? property.getNameNode()
            : Node.isSpreadAssignment(property)
              ? property.getExpression()
              : undefined;
        if (value && contains(value) && !requestDomainValueContainerIsReviewed(value)) {
          return false;
        }
      }
    }
    for (const array of sourceFile.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression)) {
      for (const element of array.getElements()) {
        const value = Node.isSpreadElement(element) ? element.getExpression() : element;
        if (contains(value) && !requestDomainValueContainerIsReviewed(value)) return false;
      }
    }
    for (const returned of sourceFile.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      if (contains(returned.getExpression())) return false;
    }
    for (const construct of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      if (construct.getArguments().some(contains)) return false;
    }
  }
  return true;
}

function requestDrizzleTableSelectorCallbackIsClosed(
  callable: RequestCallable,
  columns: import('ts-morph').ObjectLiteralExpression,
): boolean {
  if (!Node.isArrowFunction(callable.declaration) || Node.isBlock(callable.declaration.getBody())) {
    return false;
  }
  const [parameter, ...extra] = requestCallableParameters(callable.declaration);
  if (!parameter || extra.length > 0 || !Node.isIdentifier(parameter.getNameNode())) return false;
  const parameterSymbol = parameter.getNameNode().getSymbol();
  const outputs = requestWireOutputExpressions(callable);
  if (!parameterSymbol || outputs.length !== 1) return false;
  const output = unwrapStaticExpression(outputs[0]!);
  if (!Node.isPropertyAccessExpression(output) && !Node.isElementAccessExpression(output)) {
    return false;
  }
  const receiver = unwrapStaticExpression(output.getExpression());
  const member = Node.isPropertyAccessExpression(output)
    ? staticMemberName(output.getNameNode())
    : staticMemberName(output.getArgumentExpression());
  return !!(
    Node.isIdentifier(receiver) &&
    receiver.getSymbol() &&
    requestSymbolKey(receiver.getSymbol()!) === requestSymbolKey(parameterSymbol) &&
    member &&
    columns
      .getProperties()
      .some(
        (property) =>
          Node.isPropertyAssignment(property) &&
          staticMemberName(property.getNameNode()) === member,
      )
  );
}

function requestExpressionIsClosedStaticData(expression: Node): boolean {
  const node = unwrapStaticExpression(expression);
  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isNumericLiteral(node) ||
    Node.isBigIntLiteral(node) ||
    Node.isTrueLiteral(node) ||
    Node.isFalseLiteral(node) ||
    node.getKind() === SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node
      .getElements()
      .every(
        (element) => !Node.isSpreadElement(element) && requestExpressionIsClosedStaticData(element),
      );
  }
  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().every((property) => {
      if (!Node.isPropertyAssignment(property)) return false;
      const name = property.getNameNode();
      const initializer = property.getInitializer();
      return (
        (!Node.isComputedPropertyName(name) || staticMemberName(name) !== undefined) &&
        !!initializer &&
        requestExpressionIsClosedStaticData(initializer)
      );
    });
  }
  return false;
}

function requestReviewedDrizzleTableHasColumn(
  table: RequestReviewedDrizzleTable,
  member: string,
): boolean {
  return table.columns.getProperties().some((property) => {
    if (!Node.isPropertyAssignment(property)) return false;
    return staticMemberName(property.getNameNode()) === member;
  });
}

function requestNodeIsReviewedDrizzleDataArgument(node: Node, callable: RequestCallable): boolean {
  let current = node;
  while (true) {
    const parent = current.getParent();
    if (!parent || !nodeBelongsToRequestCallable(parent, callable)) return false;
    if (
      Node.isArrowFunction(parent) ||
      Node.isFunctionExpression(parent) ||
      Node.isFunctionDeclaration(parent) ||
      Node.isMethodDeclaration(parent) ||
      Node.isGetAccessorDeclaration(parent) ||
      Node.isSetAccessorDeclaration(parent)
    ) {
      return false;
    }
    if (Node.isCallExpression(parent)) {
      if (!parent.getArguments().some((argument) => requestNodesAreSame(argument, current))) {
        return false;
      }
      return (
        requestCallIsReviewedPureDrizzleExpression(parent) ||
        requestCallIsReviewedDrizzleDbDataCall(parent, callable)
      );
    }
    current = parent;
  }
}

function requestNodeIsReviewedDrizzleDataArgumentInDeclaredRoot(
  node: Node,
  session: RequestProvenanceSession,
): boolean {
  let current = node;
  while (true) {
    const parent = current.getParent();
    if (!parent) return false;
    if (
      Node.isArrowFunction(parent) ||
      Node.isFunctionExpression(parent) ||
      Node.isFunctionDeclaration(parent) ||
      Node.isMethodDeclaration(parent) ||
      Node.isGetAccessorDeclaration(parent) ||
      Node.isSetAccessorDeclaration(parent)
    ) {
      return false;
    }
    if (Node.isCallExpression(parent)) {
      if (!parent.getArguments().some((argument) => requestNodesAreSame(argument, current))) {
        return false;
      }
      return (
        requestCallIsReviewedPureDrizzleExpression(parent) ||
        requestCallIsReviewedDrizzleDbDataCallInDeclaredRoot(parent, session)
      );
    }
    current = parent;
  }
}

function requestCallIsReviewedDrizzleDbDataCall(
  call: import('ts-morph').CallExpression,
  callable: RequestCallable,
): boolean {
  const callee = unwrapStaticExpression(call.getExpression());
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  return !!(
    receiver &&
    member &&
    REQUEST_REVIEWED_DRIZZLE_DB_DATA_METHODS.has(member) &&
    requestRootRoleIncludesCapability(
      requestExpressionRootParameterRole(receiver, callable, new Set(), 0),
    )
  );
}

function requestCallIsReviewedDrizzleDbReadChain(
  call: import('ts-morph').CallExpression,
  callable: RequestCallable,
): boolean {
  let current: import('ts-morph').CallExpression | undefined = call;
  while (current) {
    const callee = unwrapStaticExpression(current.getExpression());
    if (!Node.isPropertyAccessExpression(callee)) return false;
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    if (!receiver || !member || !requestCallIsReviewedDrizzleDbDataCall(current, callable)) {
      return false;
    }
    if (REQUEST_REVIEWED_DRIZZLE_DB_READ_ROOT_METHODS.has(member)) {
      // The read constructor must be invoked directly on the request DB capability. A method named
      // `select` later in an insert/update chain is Drizzle's insert-select protocol, not a read.
      return !Node.isCallExpression(unwrapStaticExpression(receiver));
    }
    if (!REQUEST_REVIEWED_DRIZZLE_DB_READ_SUFFIX_METHODS.has(member)) return false;
    const receiverNode = unwrapStaticExpression(receiver);
    current = Node.isCallExpression(receiverNode) ? receiverNode : undefined;
  }
  return false;
}

function requestReviewedDrizzleTableIsPristine(
  table: RequestReviewedDrizzleTable,
  callable: RequestCallable,
  context: RequestProcessScanContext,
): boolean {
  const key = requestNodeIdentity(table.declaration);
  const cached = context.provenance.drizzleTablePristineMemo.get(key);
  if (cached !== undefined) return cached;
  const resolvesToTable = (candidate: Node | undefined): boolean =>
    !!candidate &&
    requestExpressionResolvesToReviewedDrizzleTable(candidate, table.declaration, new Set());

  let pristine = true;
  for (const sourceFile of table.declaration.getSourceFile().getProject().getSourceFiles()) {
    for (const access of [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression),
    ]) {
      const member = Node.isPropertyAccessExpression(access)
        ? staticMemberName(access.getNameNode())
        : staticMemberName(access.getArgumentExpression());
      if (
        member &&
        resolvesToTable(access.getExpression()) &&
        requestReviewedDrizzleTableHasColumn(table, member) &&
        !requestDrizzleColumnAccessIsExactReferenceCallback(access) &&
        !requestNodeIsReviewedDrizzleDataArgument(access, callable) &&
        !requestNodeIsReviewedDrizzleDataArgumentInDeclaredRoot(access, context.provenance)
      ) {
        pristine = false;
        break;
      }
    }
    if (!pristine) break;
    for (const reference of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (
        resolvesToTable(reference) &&
        !requestReviewedDrizzleTableReferenceIsClosed(reference, callable, context.provenance)
      ) {
        pristine = false;
        break;
      }
    }
    if (!pristine) break;
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const operator = assignment.getOperatorToken().getKind();
      if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
      const target = unwrapStaticExpression(assignment.getLeft());
      if (
        (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) &&
        resolvesToTable(target.getExpression())
      ) {
        pristine = false;
        break;
      }
    }
    if (!pristine) break;
    for (const deletion of sourceFile.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
      const target = unwrapStaticExpression(deletion.getExpression());
      if (
        (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) &&
        resolvesToTable(target.getExpression())
      ) {
        pristine = false;
        break;
      }
    }
    if (!pristine) break;
    for (const update of [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
    ]) {
      const target = unwrapStaticExpression(update.getOperand());
      if (
        (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) &&
        resolvesToTable(target.getExpression())
      ) {
        pristine = false;
        break;
      }
    }
    if (!pristine) break;
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = unwrapStaticExpression(call.getExpression());
      const receiver = requestCallReceiver(callee);
      const member = requestStaticCallMember(callee);
      if (receiver && resolvesToTable(receiver)) {
        pristine = false;
        break;
      }
      if (!call.getArguments().some(resolvesToTable)) continue;
      const objectGlobal =
        !!receiver && expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0);
      const reflectGlobal =
        !!receiver && expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0);
      if (
        (objectGlobal &&
          member !== undefined &&
          ['assign', 'defineProperties', 'defineProperty', 'setPrototypeOf'].includes(member)) ||
        (reflectGlobal &&
          member !== undefined &&
          ['defineProperty', 'deleteProperty', 'set', 'setPrototypeOf'].includes(member)) ||
        (!requestCallIsReviewedPureDrizzleExpression(call) &&
          !requestCallIsReviewedDrizzleDbDataCall(call, callable) &&
          !requestCallIsReviewedDrizzleDbDataCallInDeclaredRoot(call, context.provenance))
      ) {
        pristine = false;
        break;
      }
    }
    if (!pristine) break;
    for (const construct of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      if (construct.getArguments().some(resolvesToTable)) {
        pristine = false;
        break;
      }
    }
    if (!pristine) break;
  }
  context.provenance.drizzleTablePristineMemo.set(key, pristine);
  return pristine;
}

function requestDrizzleColumnAccessIsExactReferenceCallback(access: Node): boolean {
  const callableOwner = access.getFirstAncestor(
    (ancestor) =>
      Node.isArrowFunction(ancestor) ||
      Node.isFunctionExpression(ancestor) ||
      Node.isFunctionDeclaration(ancestor),
  );
  if (!callableOwner) return false;
  const parent = callableOwner.getParent();
  if (
    !Node.isCallExpression(parent) ||
    !parent.getArguments().some((arg) => requestNodesAreSame(arg, callableOwner))
  ) {
    return false;
  }
  const callee = unwrapStaticExpression(parent.getExpression());
  return (
    requestStaticCallMember(callee) === 'references' &&
    requestDrizzleReferenceCallbackIsClosed(callableOwner)
  );
}

function requestReviewedDrizzleTableReferenceIsClosed(
  reference: import('ts-morph').Identifier,
  callable: RequestCallable,
  session: RequestProvenanceSession,
): boolean {
  let current: Node = reference;
  while (true) {
    const parent = current.getParent();
    if (
      !parent ||
      !(
        Node.isParenthesizedExpression(parent) ||
        Node.isAsExpression(parent) ||
        Node.isSatisfiesExpression(parent) ||
        Node.isTypeAssertion(parent) ||
        Node.isNonNullExpression(parent)
      )
    ) {
      break;
    }
    current = parent;
  }
  const parent = current.getParent();
  if (!parent) return false;
  if (
    Node.isImportSpecifier(parent) ||
    Node.isExportSpecifier(parent) ||
    Node.isNamespaceImport(parent)
  ) {
    return true;
  }
  if (Node.isVariableDeclaration(parent) && requestNodesAreSame(parent.getNameNode(), current)) {
    return true;
  }
  if (
    (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) &&
    requestNodesAreSame(parent.getExpression(), current)
  ) {
    return true;
  }
  if (
    Node.isVariableDeclaration(parent) &&
    parent.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const &&
    Node.isIdentifier(parent.getNameNode()) &&
    !!parent.getInitializer() &&
    requestNodesAreSame(
      unwrapStaticExpression(parent.getInitializer()!),
      unwrapStaticExpression(current),
    )
  ) {
    return true;
  }
  if (
    Node.isCallExpression(parent) &&
    parent.getArguments().some((argument) => requestNodesAreSame(argument, current))
  ) {
    return (
      requestCallIsReviewedPureDrizzleExpression(parent) ||
      requestCallIsReviewedDrizzleDbDataCall(parent, callable) ||
      requestCallIsReviewedDrizzleDbDataCallInDeclaredRoot(parent, session)
    );
  }
  return false;
}

function requestCallIsReviewedDrizzleDbDataCallInDeclaredRoot(
  call: import('ts-morph').CallExpression,
  session: RequestProvenanceSession,
): boolean {
  const owner = call.getFirstAncestor(
    (ancestor) =>
      Node.isArrowFunction(ancestor) ||
      Node.isFunctionExpression(ancestor) ||
      Node.isMethodDeclaration(ancestor),
  );
  if (!owner) return false;
  const direct = requestCallableForFunctionNode(owner);
  if (!direct) return false;

  let property:
    | import('ts-morph').MethodDeclaration
    | import('ts-morph').PropertyAssignment
    | undefined;
  let definition: Node | undefined;
  if (Node.isMethodDeclaration(owner)) {
    property = owner;
    definition = owner.getParent();
  } else {
    const parent = owner.getParent();
    if (Node.isPropertyAssignment(parent)) {
      property = parent;
      definition = parent.getParent();
    }
  }
  if (!property || !Node.isObjectLiteralExpression(definition)) return false;
  const callback = staticMemberName(requestObjectLiteralElementNameNode(property));
  const declarationCall = definition.getParentIfKind(SyntaxKind.CallExpression);
  if (!callback || !declarationCall) return false;

  for (const invocation of requestHandlerFactoryInvocationsForCall(declarationCall, session)) {
    const spec = (invocation.factory.callbacks as readonly RequestRootCallbackSpec[]).find(
      (candidate) => candidate.property === callback,
    );
    if (!spec) continue;
    const rootCallable: RequestCallable = {
      ...direct,
      rootCallback: callback,
      rootFactory: invocation.factory.exportName,
      ...(spec.roles ? { rootParameterRoles: spec.roles } : {}),
    };
    return requestCallIsReviewedDrizzleDbDataCall(call, rootCallable);
  }
  return false;
}

function requestCallIsReviewedDrizzleDbReadChainInDeclaredRoot(
  call: import('ts-morph').CallExpression,
  session: RequestProvenanceSession,
): boolean {
  let current: import('ts-morph').CallExpression | undefined = call;
  while (current) {
    const callee = unwrapStaticExpression(current.getExpression());
    if (!Node.isPropertyAccessExpression(callee)) return false;
    const receiver = requestCallReceiver(callee);
    const member = requestStaticCallMember(callee);
    if (
      !receiver ||
      !member ||
      !requestCallIsReviewedDrizzleDbDataCallInDeclaredRoot(current, session)
    ) {
      return false;
    }
    if (REQUEST_REVIEWED_DRIZZLE_DB_READ_ROOT_METHODS.has(member)) {
      return !Node.isCallExpression(unwrapStaticExpression(receiver));
    }
    if (!REQUEST_REVIEWED_DRIZZLE_DB_READ_SUFFIX_METHODS.has(member)) return false;
    const receiverNode = unwrapStaticExpression(receiver);
    current = Node.isCallExpression(receiverNode) ? receiverNode : undefined;
  }
  return false;
}

function requestExpressionResolvesToReviewedDrizzleTable(
  expression: Node,
  target: import('ts-morph').VariableDeclaration,
  seen: Set<string>,
): boolean {
  const node = unwrapStaticExpression(expression);
  if (!Node.isIdentifier(node)) return false;
  const direct = requestReviewedDrizzleTableForDirectReference(node);
  if (direct && requestNodesAreSame(direct.declaration, target)) return true;
  const shorthand = node.getParentIfKind(SyntaxKind.ShorthandPropertyAssignment);
  const symbol = shorthand?.getValueSymbol() ?? node.getSymbol();
  if (!symbol) return false;
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return false;
  seen.add(key);
  const symbols = [symbol];
  const visited = new Set<string>();
  while (symbols.length > 0) {
    const candidate = symbols.pop()!;
    const candidateKey = requestSymbolKey(candidate);
    if (visited.has(candidateKey)) continue;
    visited.add(candidateKey);
    try {
      const aliased = candidate.getAliasedSymbol();
      if (aliased && aliased !== candidate) symbols.push(aliased);
    } catch {
      // Unresolved imports remain closed.
    }
    for (const declaration of candidate.getDeclarations()) {
      if (requestNodesAreSame(declaration, target)) return true;
      if (
        Node.isVariableDeclaration(declaration) &&
        declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const
      ) {
        const initializer = declaration.getInitializer();
        if (
          initializer &&
          requestExpressionResolvesToReviewedDrizzleTable(initializer, target, new Set(seen))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function requestCallIsExactTrustedOutput(call: Node): boolean {
  if (!Node.isCallExpression(call)) return false;
  const identity = requestImportedModuleExportForExpression(
    call.getExpression(),
    (specifier) => specifier === '@kovojs/browser' || specifier === '@kovojs/server',
    new Set(),
    0,
  );
  return !!identity && ['safeRichHtml', 'trustedHtml', 'trustedUrl'].includes(identity.exportName);
}

function requestCallIsPublicStyleCreate(call: Node): boolean {
  const node = unwrapStaticExpression(call);
  if (!Node.isCallExpression(node)) return false;
  if (!requestSourceImportsExactExport(node, '@kovojs/style', 'create')) return false;
  const imported = requestImportedModuleExportForExpression(
    node.getExpression(),
    (specifier) => specifier === '@kovojs/style',
    new Set(),
    0,
  );
  return imported?.module === '@kovojs/style' && imported.exportName === 'create';
}

const REQUEST_STYLE_CREATE_CALL_MEMO = new WeakMap<
  object,
  import('ts-morph').CallExpression | false
>();
const REQUEST_STYLE_CREATE_PRISTINE_MEMO = new WeakMap<object, boolean>();

function requestStyleCreateCallForExpression(
  expression: Node,
  seen: Set<string>,
): import('ts-morph').CallExpression | undefined {
  const node = unwrapStaticExpression(expression);
  const memoized = REQUEST_STYLE_CREATE_CALL_MEMO.get(node);
  if (memoized !== undefined) return memoized || undefined;
  const key = requestNodeIdentity(node);
  if (seen.has(key)) return undefined;
  seen.add(key);
  if (Node.isCallExpression(node)) {
    const result = requestCallIsPublicStyleCreate(node) ? node : undefined;
    REQUEST_STYLE_CREATE_CALL_MEMO.set(node, result ?? false);
    return result;
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const result = requestStyleCreateCallForExpression(node.getExpression(), new Set(seen));
    REQUEST_STYLE_CREATE_CALL_MEMO.set(node, result ?? false);
    return result;
  }
  if (!Node.isIdentifier(node)) {
    REQUEST_STYLE_CREATE_CALL_MEMO.set(node, false);
    return undefined;
  }
  const symbol = requestIdentifierValueSymbol(node);
  if (!symbol) {
    REQUEST_STYLE_CREATE_CALL_MEMO.set(node, false);
    return undefined;
  }
  for (const declaration of symbol.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (!initializer) continue;
    const result = requestStyleCreateCallForExpression(initializer, new Set(seen));
    if (result) {
      REQUEST_STYLE_CREATE_CALL_MEMO.set(node, result);
      return result;
    }
  }
  REQUEST_STYLE_CREATE_CALL_MEMO.set(node, false);
  return undefined;
}

function requestStyleCreateResultIsPristine(create: import('ts-morph').CallExpression): boolean {
  const memoized = REQUEST_STYLE_CREATE_PRISTINE_MEMO.get(create);
  if (memoized !== undefined) return memoized;
  const referencesCreate = (expression: Node | undefined): boolean => {
    if (!expression) return false;
    const candidates = [
      expression,
      ...expression
        .getDescendants()
        .filter(
          (candidate) =>
            Node.isIdentifier(candidate) ||
            Node.isPropertyAccessExpression(candidate) ||
            Node.isElementAccessExpression(candidate),
        ),
    ];
    return candidates.some(
      (candidate) => requestStyleCreateCallForExpression(candidate, new Set()) === create,
    );
  };
  for (const sourceFile of create.getProject().getSourceFiles()) {
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const operator = assignment.getOperatorToken().getKind();
      if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
      if (referencesCreate(assignment.getLeft())) {
        REQUEST_STYLE_CREATE_PRISTINE_MEMO.set(create, false);
        return false;
      }
    }
    for (const deletion of sourceFile.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
      if (referencesCreate(deletion.getExpression())) {
        REQUEST_STYLE_CREATE_PRISTINE_MEMO.set(create, false);
        return false;
      }
    }
    for (const mutation of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const target = unwrapStaticExpression(mutation.getExpression());
      const receiver = requestCallReceiver(target);
      const member = requestStaticCallMember(target);
      const [object] = mutation.getArguments();
      if (!receiver || !member || !referencesCreate(object)) continue;
      if (
        (expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
          ['assign', 'defineProperties', 'defineProperty', 'setPrototypeOf'].includes(member)) ||
        (expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0) &&
          ['defineProperty', 'deleteProperty', 'set', 'setPrototypeOf'].includes(member))
      ) {
        REQUEST_STYLE_CREATE_PRISTINE_MEMO.set(create, false);
        return false;
      }
    }
  }
  REQUEST_STYLE_CREATE_PRISTINE_MEMO.set(create, true);
  return true;
}

function requestExpressionIsReviewedFrozenStyleValue(expression: Node): boolean {
  const create = requestStyleCreateCallForExpression(expression, new Set());
  return !!create && requestStyleCreateResultIsPristine(create);
}

function requestCallIsPublicStyleAttrs(call: Node): boolean {
  const node = unwrapStaticExpression(call);
  if (!Node.isCallExpression(node)) return false;
  if (!requestSourceImportsExactExport(node, '@kovojs/style', 'attrs')) return false;
  const imported = requestImportedModuleExportForExpression(
    node.getExpression(),
    (specifier) => specifier === '@kovojs/style',
    new Set(),
    0,
  );
  return imported?.module === '@kovojs/style' && imported.exportName === 'attrs';
}

function requestCallIsPublicMutationFormAttributes(call: Node): boolean {
  const node = unwrapStaticExpression(call);
  if (!Node.isCallExpression(node)) return false;
  if (
    !requestSourceImportsExactExport(node, '@kovojs/server', 'mutationFormAttributes') &&
    !requestSourceImportsExactExport(node, '@kovojs/server/api/data', 'mutationFormAttributes')
  ) {
    return false;
  }
  const imported = requestImportedModuleExportForExpression(
    node.getExpression(),
    (specifier) => specifier === '@kovojs/server' || specifier === '@kovojs/server/api/data',
    new Set(),
    0,
  );
  return !!(
    imported &&
    (imported.module === '@kovojs/server' || imported.module === '@kovojs/server/api/data') &&
    imported.exportName === 'mutationFormAttributes'
  );
}

function requestCallIsReviewedPublicJsxAttributeHelper(call: Node): boolean {
  return requestCallIsPublicStyleAttrs(call) || requestCallIsPublicMutationFormAttributes(call);
}

function requestSourceImportsExactExport(node: Node, module: string, exportName: string): boolean {
  return node
    .getSourceFile()
    .getImportDeclarations()
    .some((declaration) => {
      if (declaration.getModuleSpecifierValue() !== module) return false;
      if (declaration.getNamespaceImport()) return true;
      return declaration.getNamedImports().some((named) => named.getName() === exportName);
    });
}

function requestCallIsExactJsxSpreadExpression(call: Node): boolean {
  let node = unwrapStaticExpression(call);
  while (
    Node.isParenthesizedExpression(node.getParent()) ||
    Node.isAsExpression(node.getParent()) ||
    Node.isSatisfiesExpression(node.getParent())
  ) {
    node = node.getParent()!;
  }
  const parent = node.getParent();
  return !!(Node.isJsxSpreadAttribute(parent) && requestNodesAreSame(parent.getExpression(), node));
}

const REQUEST_COMPONENT_DESCRIPTOR_CALL_MEMO = new WeakMap<
  object,
  import('ts-morph').CallExpression | false
>();
const REQUEST_SOURCE_HAS_COMPONENT_IMPORT = new WeakMap<object, boolean>();

function requestSourceHasComponentImport(node: Node): boolean {
  const sourceFile = node.getSourceFile();
  const memoized = REQUEST_SOURCE_HAS_COMPONENT_IMPORT.get(sourceFile);
  if (memoized !== undefined) return memoized;
  const found = sourceFile
    .getImportDeclarations()
    .some((declaration) => declaration.getModuleSpecifierValue() === '@kovojs/core');
  REQUEST_SOURCE_HAS_COMPONENT_IMPORT.set(sourceFile, found);
  return found;
}

function requestComponentDescriptorCallForExpression(
  expression: Node,
  seen: Set<string>,
): import('ts-morph').CallExpression | undefined {
  const node = unwrapStaticExpression(expression);
  const memoized = REQUEST_COMPONENT_DESCRIPTOR_CALL_MEMO.get(node);
  if (memoized !== undefined) return memoized || undefined;
  const key = requestNodeIdentity(node);
  if (seen.has(key)) return undefined;
  seen.add(key);
  if (Node.isCallExpression(node)) {
    if (!requestSourceHasComponentImport(node)) {
      REQUEST_COMPONENT_DESCRIPTOR_CALL_MEMO.set(node, false);
      return undefined;
    }
    const imported = requestImportedModuleExportForExpression(
      node.getExpression(),
      (specifier) => specifier === '@kovojs/core',
      new Set(),
      0,
    );
    const result =
      imported?.module === '@kovojs/core' && imported.exportName === 'component' ? node : undefined;
    REQUEST_COMPONENT_DESCRIPTOR_CALL_MEMO.set(node, result ?? false);
    return result;
  }
  if (!Node.isIdentifier(node)) {
    REQUEST_COMPONENT_DESCRIPTOR_CALL_MEMO.set(node, false);
    return undefined;
  }
  const symbol = requestIdentifierValueSymbol(node);
  if (!symbol) {
    REQUEST_COMPONENT_DESCRIPTOR_CALL_MEMO.set(node, false);
    return undefined;
  }
  for (const declaration of symbol.getDeclarations()) {
    const initializer = valueDeclarationInitializer(declaration);
    if (!initializer) continue;
    const descriptor = requestComponentDescriptorCallForExpression(initializer, new Set(seen));
    if (descriptor) {
      REQUEST_COMPONENT_DESCRIPTOR_CALL_MEMO.set(node, descriptor);
      return descriptor;
    }
  }
  REQUEST_COMPONENT_DESCRIPTOR_CALL_MEMO.set(node, false);
  return undefined;
}

const REQUEST_COMPONENT_DESCRIPTOR_PRISTINE_MEMO = new WeakMap<object, boolean>();

function requestComponentDescriptorIsPristine(
  descriptor: import('ts-morph').CallExpression,
): boolean {
  const memoized = REQUEST_COMPONENT_DESCRIPTOR_PRISTINE_MEMO.get(descriptor);
  if (memoized !== undefined) return memoized;
  const sameDescriptorIn = (expression: Node | undefined): boolean => {
    if (!expression) return false;
    const identifiers = [
      ...(Node.isIdentifier(expression) ? [expression] : []),
      ...expression.getDescendantsOfKind(SyntaxKind.Identifier),
    ];
    return identifiers.some(
      (identifier) =>
        requestComponentDescriptorCallForExpression(identifier, new Set()) === descriptor,
    );
  };
  for (const sourceFile of descriptor.getProject().getSourceFiles()) {
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const operator = assignment.getOperatorToken().getKind();
      if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
      if (sameDescriptorIn(assignment.getLeft())) {
        REQUEST_COMPONENT_DESCRIPTOR_PRISTINE_MEMO.set(descriptor, false);
        return false;
      }
    }
    for (const deletion of sourceFile.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
      if (sameDescriptorIn(deletion.getExpression())) {
        REQUEST_COMPONENT_DESCRIPTOR_PRISTINE_MEMO.set(descriptor, false);
        return false;
      }
    }
    for (const mutation of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const target = unwrapStaticExpression(mutation.getExpression());
      const receiver = requestCallReceiver(target);
      const member = requestStaticCallMember(target);
      const [object] = mutation.getArguments();
      if (!receiver || !member || !sameDescriptorIn(object)) continue;
      if (
        (expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
          ['assign', 'defineProperties', 'defineProperty', 'setPrototypeOf'].includes(member)) ||
        (expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0) &&
          ['defineProperty', 'deleteProperty', 'set', 'setPrototypeOf'].includes(member))
      ) {
        REQUEST_COMPONENT_DESCRIPTOR_PRISTINE_MEMO.set(descriptor, false);
        return false;
      }
    }
  }
  REQUEST_COMPONENT_DESCRIPTOR_PRISTINE_MEMO.set(descriptor, true);
  return true;
}

interface RequestReviewedPublicUiComponent {
  readonly exportName: 'Badge' | 'Button' | 'Card';
  readonly module: '@kovojs/ui/badge' | '@kovojs/ui/button' | '@kovojs/ui/card';
}

const REQUEST_REVIEWED_PUBLIC_UI_COMPONENTS = new Map<
  RequestReviewedPublicUiComponent['module'],
  RequestReviewedPublicUiComponent['exportName']
>([
  ['@kovojs/ui/badge', 'Badge'],
  ['@kovojs/ui/button', 'Button'],
  ['@kovojs/ui/card', 'Card'],
]);

/**
 * SPEC §13.1: recognize only the starter's reviewed public UI descriptor entrypoint. The package
 * namespace and arbitrary descriptor members are deliberately not capabilities.
 */
function requestReviewedPublicUiComponentForExpression(
  expression: Node,
): RequestReviewedPublicUiComponent | undefined {
  if (
    ![...REQUEST_REVIEWED_PUBLIC_UI_COMPONENTS].some(([module, exportName]) =>
      requestSourceImportsExactExport(expression, module, exportName),
    )
  ) {
    return undefined;
  }
  const imported = requestImportedModuleExportForExpression(
    expression,
    (specifier) =>
      REQUEST_REVIEWED_PUBLIC_UI_COMPONENTS.has(
        specifier as RequestReviewedPublicUiComponent['module'],
      ),
    new Set(),
    0,
  );
  if (!imported) return undefined;
  const expected = REQUEST_REVIEWED_PUBLIC_UI_COMPONENTS.get(
    imported.module as RequestReviewedPublicUiComponent['module'],
  );
  return expected === imported.exportName
    ? {
        exportName: expected,
        module: imported.module as RequestReviewedPublicUiComponent['module'],
      }
    : undefined;
}

function requestCallIsReviewedPublicUiRender(call: import('ts-morph').CallExpression): boolean {
  const callee = unwrapStaticExpression(call.getExpression());
  if (!Node.isPropertyAccessExpression(callee) && !Node.isElementAccessExpression(callee)) {
    return false;
  }
  if (requestStaticCallMember(callee) !== 'render') return false;
  const definition = unwrapStaticExpression(callee.getExpression());
  if (
    (!Node.isPropertyAccessExpression(definition) && !Node.isElementAccessExpression(definition)) ||
    (Node.isPropertyAccessExpression(definition)
      ? definition.getName()
      : staticMemberName(definition.getArgumentExpression())) !== 'definition'
  ) {
    return false;
  }
  const component = unwrapStaticExpression(definition.getExpression());
  const identity = requestReviewedPublicUiComponentForExpression(component);
  return !!identity && requestReviewedPublicUiComponentIsPristine(call, identity);
}

function requestPropertyAccessBelongsToReviewedPublicUiRenderCall(access: Node): boolean {
  let candidate = access;
  while (true) {
    const parent = candidate.getParent();
    if (
      (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) &&
      requestNodesAreSame(parent.getExpression(), candidate)
    ) {
      candidate = parent;
      continue;
    }
    if (Node.isCallExpression(parent) && requestNodesAreSame(parent.getExpression(), candidate)) {
      return requestCallIsReviewedPublicUiRender(parent);
    }
    return false;
  }
}

function requestReviewedPublicUiComponentIsPristine(
  call: import('ts-morph').CallExpression,
  identity: RequestReviewedPublicUiComponent,
): boolean {
  const expressionContainsIdentity = (expression: Node | undefined): boolean => {
    if (!expression) return false;
    const identifiers = [
      ...(Node.isIdentifier(expression) ? [expression] : []),
      ...expression.getDescendantsOfKind(SyntaxKind.Identifier),
    ];
    return identifiers.some((identifier) => {
      const imported = requestReviewedPublicUiComponentForExpression(identifier);
      return imported?.module === identity.module && imported.exportName === identity.exportName;
    });
  };

  // Scan the complete authoritative project, not merely the call's source file: a sibling module
  // can import the same descriptor and install a getter or replacement before this request runs.
  for (const sourceFile of call.getProject().getSourceFiles()) {
    for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const operator = assignment.getOperatorToken().getKind();
      if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
      if (expressionContainsIdentity(assignment.getLeft())) return false;
    }
    for (const deletion of sourceFile.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
      if (expressionContainsIdentity(deletion.getExpression())) return false;
    }
    for (const mutation of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const target = unwrapStaticExpression(mutation.getExpression());
      const receiver = requestCallReceiver(target);
      const member = requestStaticCallMember(target);
      const [object] = mutation.getArguments();
      if (!receiver || !member || !expressionContainsIdentity(object)) continue;
      const objectMutation =
        expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
        ['assign', 'defineProperties', 'defineProperty', 'setPrototypeOf'].includes(member);
      const reflectMutation =
        expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0) &&
        ['defineProperty', 'deleteProperty', 'set', 'setPrototypeOf'].includes(member);
      if (objectMutation || reflectMutation) return false;
    }
  }
  return true;
}

function requestExpressionContainsClosedAuthority(
  expression: Node,
  seen: Set<string>,
  depth: number,
): boolean {
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
  const resolution = resolveRequestCallable(callee, new Set(), 0, context.provenance);
  if (resolution.callables.length > 0) {
    for (const nested of resolution.callables) scanRequestCallable(nested, context);
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
  const declarations = requestClassDeclarationsForExpression(callee, new Set());
  if (declarations.length === 0) return false;
  let closed = true;
  for (const declaration of declarations) {
    if (declaration.getDescendantsOfKind(SyntaxKind.Decorator).length > 0) {
      appendRequestProtocolFact(context, callee, 'decorated-class', declaration);
      closed = false;
    }
    const heritage = declaration.getExtends();
    if (
      heritage &&
      requestClassDeclarationsForExpression(heritage.getExpression(), new Set()).length === 0
    ) {
      appendRequestProtocolFact(context, callee, 'unresolved-superclass', heritage);
      closed = false;
    }
    for (const property of declaration.getProperties()) {
      if (property.isStatic()) continue;
      const name = property.getNameNode();
      if (Node.isComputedPropertyName(name)) {
        scanRequestCallable({ body: name.getExpression(), declaration: property }, context);
      }
      const initializer = property.getInitializer();
      if (initializer) {
        scanRequestCallable({ body: initializer, declaration: property }, context);
      }
    }
    for (const constructor of declaration.getConstructors()) {
      const body = constructor.getBody();
      if (body) scanRequestCallable({ body, declaration: constructor }, context);
    }
    for (const getter of declaration.getGetAccessors()) {
      const body = getter.getBody();
      if (body) scanRequestCallable({ body, declaration: getter }, context);
    }
  }
  return closed;
}

function scanRequestFunctionArguments(
  expression: import('ts-morph').CallExpression | import('ts-morph').NewExpression,
  context: RequestProcessScanContext,
): void {
  for (const argument of expression.getArguments()) {
    const resolution = resolveRequestCallable(argument, new Set(), 0, context.provenance);
    for (const nested of resolution.callables) scanRequestCallable(nested, context);
  }
}

function requestKnownCallbacksAreClosed(
  expression: import('ts-morph').CallExpression | import('ts-morph').NewExpression,
  member: string | undefined,
  context: RequestProcessScanContext,
): boolean {
  if (!member) return true;
  const indexes = requestCallbackArgumentIndexes(expression, member);
  if (!indexes) return true;
  const args = expression.getArguments();
  for (const index of indexes) {
    const callback = args[index];
    if (!callback) continue;
    const resolution = resolveRequestCallable(callback, new Set(), 0, context.provenance);
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
    if (requestExpressionIsProvablyNonCallable(callback)) continue;
    return false;
  }
  return true;
}

function requestExpressionIsProvablyNonCallable(expression: Node): boolean {
  const node = unwrapStaticExpression(expression);
  return (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isTemplateExpression(node) ||
    Node.isNumericLiteral(node) ||
    Node.isBigIntLiteral(node) ||
    Node.isTrueLiteral(node) ||
    Node.isFalseLiteral(node) ||
    Node.isRegularExpressionLiteral(node) ||
    Node.isArrayLiteralExpression(node) ||
    Node.isObjectLiteralExpression(node) ||
    node.getKind() === SyntaxKind.NullKeyword ||
    (Node.isIdentifier(node) && unshadowedGlobalIdentifier(node, 'undefined'))
  );
}

function requestCallbackArgumentIndexes(
  expression: import('ts-morph').CallExpression | import('ts-morph').NewExpression,
  member: string,
): readonly number[] | undefined {
  if (Node.isCallExpression(expression)) {
    const receiver = requestCallReceiver(unwrapStaticExpression(expression.getExpression()));
    if (receiver) {
      if (
        expressionResolvesToGlobalNamespace(receiver, 'Array', new Set(), 0) &&
        (member === 'from' || member === 'fromAsync')
      ) {
        return [1];
      }
      if (
        expressionResolvesToGlobalNamespace(receiver, 'JSON', new Set(), 0) &&
        (member === 'parse' || member === 'stringify')
      ) {
        return [1];
      }
      if (
        expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) &&
        member === 'groupBy'
      ) {
        return [1];
      }
      if (
        expressionResolvesToGlobalNamespace(receiver, 'Promise', new Set(), 0) &&
        member === 'try'
      ) {
        return [0];
      }
    }
  }
  return REQUEST_CALLBACK_ARGUMENTS.get(member);
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
  if (!callable.rootFactory && !callable.rootParameterRoles) return undefined;
  const node = unwrapStaticExpression(expression);
  if (Node.isAwaitExpression(node)) {
    return requestExpressionRootParameterRole(node.getExpression(), callable, seen, depth + 1);
  }
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return requestExpressionRootParameterRole(node.getExpression(), callable, seen, depth + 1);
  }
  if (Node.isCallExpression(node)) {
    const receiver = requestCallReceiver(unwrapStaticExpression(node.getExpression()));
    if (receiver) {
      return requestExpressionRootParameterRole(receiver, callable, seen, depth + 1);
    }

    // Preserve a root role only through an inspectable local helper whose every return carries
    // the same role. This admits generated guards such as `requireDb(context)` without treating an
    // arbitrary package call or a helper with a mixed app-owned result as a capability mint.
    const invocation = requestNormalizedCall(node);
    const key = `root-role-call:${requestNodeIdentity(node)}`;
    if (seen.has(key) || depth > 64) return undefined;
    seen.add(key);
    const resolvedOutputs = resolveRequestCallable(
      invocation.target,
      new Set(),
      0,
    ).callables.flatMap((nested) => {
      const invoked = requestCallableWithInvocationRoles(
        nested,
        invocation.args ?? node.getArguments(),
        callable,
      );
      return requestWireOutputExpressions(invoked).map((output) => ({
        invoked,
        output,
        role: requestExpressionRootParameterRole(output, invoked, new Set(seen), depth + 1),
      }));
    });
    const [first] = resolvedOutputs;
    return first?.role !== undefined &&
      resolvedOutputs.length > 0 &&
      resolvedOutputs.every(
        (candidate) =>
          candidate.role === first.role &&
          requestHelperRoleOutputIsPristine(candidate.output, candidate.invoked),
      )
      ? first.role
      : undefined;
  }
  if (!Node.isIdentifier(node)) return undefined;

  const wireCarrier = requestWireCarrierForExpression(node, {
    bindingKey: 'root',
    bindings: new Map(),
    rootCallable: callable,
    session: createRequestProvenanceSession(),
    scopeCallable: callable,
  });
  if (wireCarrier === 'context') return 'capability';
  if (wireCarrier === 'verification') return 'input';
  if (wireCarrier) return 'request';

  const parameters = requestCallableParameters(callable.declaration);
  for (const [index, parameter] of parameters.entries()) {
    const name = parameter.getNameNode();
    if (requestBindingNameContainsIdentifier(name, node)) {
      return callable.rootParameterRoles?.[index] ?? 'capability';
    }
  }

  const declarationSymbol = node.getSymbol();
  if (declarationSymbol) {
    const declarations = declarationSymbol.getDeclarations();
    if (
      requestAssignedBindingProjections(declarationSymbol).length > 0 ||
      declarations.some((candidate) => {
        if (Node.isVariableDeclaration(candidate)) {
          return (
            candidate.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
          );
        }
        if (Node.isBindingElement(candidate)) {
          const variable = candidate.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
          return (
            !variable ||
            variable.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
          );
        }
        return false;
      })
    ) {
      return undefined;
    }
  }
  const declaration =
    declarationSymbol
      ?.getDeclarations()
      .find((candidate) => valueDeclarationInitializer(candidate) !== undefined) ??
    localValueDeclaration(node);
  const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
  if (!initializer) return undefined;
  if (declarationSymbol) {
    const key = requestSymbolKey(declarationSymbol);
    if (seen.has(key)) return undefined;
    seen.add(key);
  }
  return requestExpressionRootParameterRole(initializer, callable, seen, depth + 1);
}

function requestBindingNameContainsIdentifier(name: Node, target: Node): boolean {
  if (!Node.isIdentifier(target)) return false;
  if (Node.isIdentifier(name)) {
    const targetSymbol = target.getSymbol();
    const nameSymbol = name.getSymbol();
    return targetSymbol && nameSymbol
      ? targetSymbol === nameSymbol
      : name.getText() === target.getText();
  }
  if (!Node.isObjectBindingPattern(name) && !Node.isArrayBindingPattern(name)) return false;
  return name
    .getElements()
    .some(
      (element) =>
        !Node.isOmittedExpression(element) &&
        requestBindingNameContainsIdentifier(element.getNameNode(), target),
    );
}

function requestHelperRoleOutputIsPristine(output: Node, callable: RequestCallable): boolean {
  const targetKey = requestRootCapabilityKey(output, callable, new Set());
  if (!targetKey) return false;
  const related = (candidate: Node | undefined): boolean => {
    if (!candidate) return false;
    const candidateKey = requestRootCapabilityKey(candidate, callable, new Set());
    if (!candidateKey) return false;
    const target = targetKey.split('.');
    const value = candidateKey.split('.');
    const prefix = (left: readonly string[], right: readonly string[]): boolean =>
      left.length <= right.length &&
      left.every((part, index) => part === '*' || right[index] === '*' || part === right[index]);
    return prefix(target, value) || prefix(value, target);
  };
  const containsRelated = (candidate: Node | undefined): boolean =>
    requestExpressionContainsIdentityCarrier(candidate, related, new Set());
  const belongs = (candidate: Node): boolean => nodeBelongsToRequestCallable(candidate, callable);

  for (const assignment of callable.body
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .filter(belongs)) {
    const operator = assignment.getOperatorToken().getKind();
    if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
    if (containsRelated(assignment.getLeft()) || containsRelated(assignment.getRight())) {
      return false;
    }
  }
  for (const deletion of callable.body
    .getDescendantsOfKind(SyntaxKind.DeleteExpression)
    .filter(belongs)) {
    if (containsRelated(deletion.getExpression())) return false;
  }
  for (const update of [
    ...callable.body.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
    ...callable.body.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
  ].filter(belongs)) {
    if (containsRelated(update.getOperand())) return false;
  }
  for (const declaration of callable.body
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter(belongs)) {
    const initializer = declaration.getInitializer();
    if (!initializer || !containsRelated(initializer)) continue;
    if (
      declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const &&
      Node.isIdentifier(declaration.getNameNode()) &&
      related(initializer)
    ) {
      continue;
    }
    return false;
  }
  for (const call of callable.body
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(belongs)) {
    if (call.getArguments().some(containsRelated)) return false;
    const callee = unwrapStaticExpression(call.getExpression());
    const receiver = requestCallReceiver(callee);
    if (receiver && related(receiver)) {
      const member = requestStaticCallMember(callee);
      if (!member || !REQUEST_REVIEWED_DRIZZLE_DB_DATA_METHODS.has(member)) return false;
    }
  }
  for (const construct of callable.body
    .getDescendantsOfKind(SyntaxKind.NewExpression)
    .filter(belongs)) {
    if (construct.getArguments().some(containsRelated)) return false;
  }
  return true;
}

function requestRootRoleIncludesCapability(role: RequestRootParameterRole | undefined): boolean {
  return role === 'capability' || role === 'hybrid';
}

function requestRootRoleIncludesInput(role: RequestRootParameterRole | undefined): boolean {
  return role === 'input' || role === 'hybrid';
}

function requestCallableParameters(declaration: Node) {
  if (
    Node.isArrowFunction(declaration) ||
    Node.isFunctionExpression(declaration) ||
    Node.isFunctionDeclaration(declaration) ||
    Node.isMethodDeclaration(declaration) ||
    Node.isConstructorDeclaration(declaration) ||
    Node.isGetAccessorDeclaration(declaration) ||
    Node.isSetAccessorDeclaration(declaration)
  ) {
    return declaration.getParameters();
  }
  return [];
}

function requestExpressionIsSafeBuiltinCapability(
  expression: Node,
  seen: Set<string>,
  depth: number,
): boolean {
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
  return !!(
    Node.isIdentifier(node) &&
    REQUEST_SAFE_GLOBAL_NAMESPACES.has(node.getText()) &&
    unshadowedGlobalIdentifier(node, node.getText()) &&
    !requestGlobalIntrinsicBindingIsMutated(node.getText(), node.getSourceFile())
  );
}

function requestGlobalNamespaceMemberIsReviewed(receiver: Node, member: string): boolean {
  const namespace = requestGlobalNamespaceName(receiver);
  return !!namespace && !!REQUEST_REVIEWED_GLOBAL_NAMESPACE_MEMBERS.get(namespace)?.has(member);
}

function requestGlobalNamespaceName(receiver: Node): string | undefined {
  const node = unwrapStaticExpression(receiver);
  if (!Node.isIdentifier(node) || !unshadowedGlobalIdentifier(node, node.getText())) {
    return undefined;
  }
  const namespace = node.getText();
  return REQUEST_SAFE_GLOBAL_NAMESPACES.has(namespace) &&
    !requestGlobalIntrinsicBindingIsMutated(namespace, node.getSourceFile())
    ? namespace
    : undefined;
}

function requestExpressionIsIntrinsicValue(
  expression: Node,
  callable: RequestCallable,
  seen: Set<string>,
  depth: number,
): boolean {
  const node = unwrapStaticExpression(expression);
  if (
    Node.isArrayLiteralExpression(node) ||
    Node.isObjectLiteralExpression(node) ||
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isTemplateExpression(node) ||
    Node.isNumericLiteral(node) ||
    Node.isBigIntLiteral(node) ||
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
  if (
    requestRootRoleIncludesInput(
      requestExpressionRootParameterRole(node, callable, new Set(), depth + 1),
    )
  ) {
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

function appendRequestProvenanceBudgetFact(
  context: RequestProcessScanContext,
  siteNode: Node,
): void {
  const site = projectSiteFor(context.filesByPath, siteNode);
  if (
    context.facts.some(
      (fact) => fact.sink === 'request-handler.provenance-budget' && fact.site === site,
    )
  ) {
    return;
  }
  context.facts.push({
    safePath:
      'simplify the request-reachable provenance graph so the compiler can prove it within the bounded security-analysis budget',
    sink: 'request-handler.provenance-budget',
    site,
    source: shortSource(siteNode),
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
  if (!expression) return undefined;
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
  session: RequestProvenanceSession = createRequestProvenanceSession(),
): RequestCallableResolution {
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  const memoized = session.callableMemo.get(key);
  if (memoized) return memoized;
  if (session.callableActive.has(key) || !requestProvenanceStep(session, node)) {
    return { callables: [] };
  }
  session.callableActive.add(key);

  const moduleAlias = requestModuleConstAliasChain(node);
  if (moduleAlias) {
    let withinBudget = true;
    for (const alias of moduleAlias.nodes.slice(1)) {
      if (!requestProvenanceStep(session, alias)) {
        withinBudget = false;
        break;
      }
    }
    const resolved =
      withinBudget && moduleAlias.terminal
        ? resolveRequestCallable(moduleAlias.terminal, seen, depth + 1, session)
        : { callables: [] };
    for (const alias of moduleAlias.nodes) {
      session.callableMemo.set(requestNodeIdentity(alias), resolved);
    }
    session.callableActive.delete(key);
    return resolved;
  }

  const resolved = resolveRequestCallableUncached(node, seen, depth, session);
  session.callableActive.delete(key);
  session.callableMemo.set(key, resolved);
  return resolved;
}

function resolveRequestCallableUncached(
  node: Node,
  seen: Set<string>,
  depth: number,
  session: RequestProvenanceSession,
): RequestCallableResolution {
  const direct = requestCallableForFunctionNode(node);
  if (direct) return { callables: [direct] };
  const nodeKey = `node:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey)) return { callables: [] };
  seen.add(nodeKey);

  if (Node.isConditionalExpression(node)) {
    return mergeRequestCallableResolutions([
      resolveRequestCallable(node.getWhenTrue(), new Set(seen), depth + 1, session),
      resolveRequestCallable(node.getWhenFalse(), new Set(seen), depth + 1, session),
    ]);
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    if (operator === SyntaxKind.CommaToken) {
      return resolveRequestCallable(node.getRight(), new Set(seen), depth + 1, session);
    }
    if (
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return mergeRequestCallableResolutions([
        resolveRequestCallable(node.getLeft(), new Set(seen), depth + 1, session),
        resolveRequestCallable(node.getRight(), new Set(seen), depth + 1, session),
      ]);
    }
  }

  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (
      Node.isPropertyAccessExpression(callee) &&
      (callee.getName() === 'bind' || callee.getName() === 'call' || callee.getName() === 'apply')
    ) {
      return resolveRequestCallable(callee.getExpression(), seen, depth + 1, session);
    }

    const componentIdentity = requestImportedModuleExportForExpression(
      callee,
      (specifier) => specifier === '@kovojs/core',
      new Set(),
      0,
    );
    if (
      componentIdentity?.module === '@kovojs/core' &&
      componentIdentity.exportName === 'component'
    ) {
      if (!requestComponentDescriptorIsPristine(node)) return { callables: [] };
      const definition = resolveStaticObjectLiteral(node.getArguments()[0], new Set(), depth + 1);
      const render = definition ? requestStaticObjectProperty(definition, 'render') : undefined;
      if (render) {
        const expression = requestHandlerPropertyExpression(render);
        if (expression) {
          const resolved = resolveRequestCallable(expression, new Set(seen), depth + 1, session);
          return {
            ...resolved,
            callables: resolved.callables.map((callable) => ({
              ...callable,
              compilerOwnedJsxEventHandlers: true,
            })),
          };
        }
        const directRender = requestCallableForFunctionNode(render);
        if (directRender) {
          return {
            callables: [{ ...directRender, compilerOwnedJsxEventHandlers: true }],
          };
        }
      }
      return { callables: [] };
    }

    const factory = resolveRequestCallable(callee, new Set(seen), depth + 1, session);
    const returned: RequestCallable[] = [];
    let opaqueModule = factory.opaqueModule;
    for (const callable of factory.callables) {
      const direct = requestCallableForFunctionNode(callable.body);
      if (direct) returned.push(direct);
      for (const statement of callable.body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
        const expression = statement.getExpression();
        if (!expression) continue;
        const resolution = resolveRequestCallable(expression, new Set(seen), depth + 1, session);
        returned.push(...resolution.callables);
        opaqueModule ??= resolution.opaqueModule;
      }
    }
    if (returned.length > 0 || opaqueModule !== undefined) {
      return { callables: returned, ...optionalOpaqueModule(opaqueModule) };
    }
  }

  const symbol = node.getSymbol();
  const fromSymbol = resolveRequestCallableSymbol(symbol, seen, depth + 1, session);
  if (fromSymbol.callables.length > 0 || fromSymbol.opaqueModule !== undefined) return fromSymbol;

  // A bound identifier's symbol walk above already visited every declaration, initializer,
  // authored reassignment, and aliased import. Re-running the context-free bare-module search at
  // every link in a long local alias chain is both redundant and quadratic. Unbound member/call
  // expressions still take the conservative bare-package fallback below.
  if (Node.isIdentifier(node) && symbol) return { callables: [] };

  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    if (declaration) {
      const fromDeclaration = resolveRequestCallableDeclaration(
        declaration,
        seen,
        depth + 1,
        session,
      );
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
  session: RequestProvenanceSession,
): RequestCallableResolution {
  if (!symbol) return { callables: [] };
  const key = requestSymbolKey(symbol);
  const memoized = session.callableSymbolMemo.get(key);
  if (memoized) return memoized;
  if (session.callableSymbolActive.has(key)) return { callables: [] };
  if (seen.has(key)) return { callables: [] };
  seen.add(key);
  session.callableSymbolActive.add(key);

  const resolutions: RequestCallableResolution[] = [];
  try {
    const aliased = symbol.getAliasedSymbol();
    if (aliased && aliased !== symbol) {
      resolutions.push(resolveRequestCallableSymbol(aliased, seen, depth + 1, session));
    }
  } catch {
    // An unresolved alias is handled from its import declaration below and fails closed for a
    // bare package instead of being treated as safe.
  }

  for (const declaration of symbol.getDeclarations()) {
    resolutions.push(
      resolveRequestCallableDeclaration(declaration, new Set(seen), depth + 1, session),
    );
  }
  // Mutable callback bindings are a union of every authored value, not merely a fallback when the
  // initializer is absent. Otherwise `let handler = safe; handler = unsafe` launders the later
  // request-reachable body through the first declaration.
  for (const assigned of requestCallableAssignmentExpressions(symbol, session)) {
    resolutions.push(resolveRequestCallable(assigned, new Set(seen), depth + 1, session));
  }
  const resolved = mergeRequestCallableResolutions(resolutions);
  session.callableSymbolActive.delete(key);
  session.callableSymbolMemo.set(key, resolved);
  return resolved;
}

function resolveRequestCallableDeclaration(
  declaration: Node,
  seen: Set<string>,
  depth: number,
  session: RequestProvenanceSession,
): RequestCallableResolution {
  const direct = requestCallableForFunctionNode(declaration);
  if (direct) return { callables: [direct] };

  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer
      ? resolveRequestCallable(initializer, seen, depth + 1, session)
      : { callables: [] };
  }
  if (Node.isPropertyAssignment(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer
      ? resolveRequestCallable(initializer, seen, depth + 1, session)
      : { callables: [] };
  }
  if (Node.isShorthandPropertyAssignment(declaration)) {
    return resolveRequestCallable(declaration.getNameNode(), seen, depth + 1, session);
  }
  if (Node.isBindingElement(declaration)) {
    const initializer = bindingElementSourceExpression(declaration);
    return initializer
      ? resolveRequestCallable(initializer, seen, depth + 1, session)
      : { callables: [] };
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

function mergeRequestCallableResolutions(
  resolutions: readonly RequestCallableResolution[],
): RequestCallableResolution {
  const callables = new Map<string, RequestCallable>();
  let opaqueModule: string | undefined;
  for (const resolution of resolutions) {
    opaqueModule ??= resolution.opaqueModule;
    for (const callable of resolution.callables) {
      callables.set(requestNodeIdentity(callable.declaration), callable);
    }
  }
  return { callables: [...callables.values()], ...optionalOpaqueModule(opaqueModule) };
}

interface RequestAssignedBindingProjection {
  readonly expression: Node;
  readonly path: readonly string[];
}

interface RequestAssignmentTargetProjection {
  readonly path: readonly string[];
  readonly target: string;
}

const REQUEST_ASSIGNED_BINDING_INDEX = new WeakMap<
  object,
  ReadonlyMap<string, readonly RequestAssignedBindingProjection[]>
>();

function requestAssignedBindingProjections(
  symbol: NonNullable<ReturnType<Node['getSymbol']>>,
  session?: RequestProvenanceSession,
): RequestAssignedBindingProjection[] {
  const target = requestSymbolKey(symbol);
  const memoized = session?.assignedBindingMemo.get(target);
  if (memoized) return [...memoized];
  const sourceFiles = new Set(
    symbol.getDeclarations().map((declaration) => declaration.getSourceFile()),
  );
  const projections: RequestAssignedBindingProjection[] = [];
  for (const sourceFile of sourceFiles) {
    projections.push(...(requestAssignedBindingIndex(sourceFile).get(target) ?? []));
  }
  const result = [
    ...new Map(
      projections.map((projection) => [
        `${requestNodeIdentity(projection.expression)}:${projection.path.join('.')}`,
        projection,
      ]),
    ).values(),
  ];
  session?.assignedBindingMemo.set(target, result);
  return result;
}

function requestAssignedBindingIndex(
  sourceFile: SourceFile,
): ReadonlyMap<string, readonly RequestAssignedBindingProjection[]> {
  const memoized = REQUEST_ASSIGNED_BINDING_INDEX.get(sourceFile);
  if (memoized) return memoized;

  const mutable = new Map<string, RequestAssignedBindingProjection[]>();
  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = assignment.getOperatorToken().getKind();
    if (
      operator !== SyntaxKind.EqualsToken &&
      operator !== SyntaxKind.BarBarEqualsToken &&
      operator !== SyntaxKind.AmpersandAmpersandEqualsToken &&
      operator !== SyntaxKind.QuestionQuestionEqualsToken
    ) {
      continue;
    }
    for (const projection of requestAssignmentTargetProjections(assignment.getLeft(), [])) {
      const values = mutable.get(projection.target) ?? [];
      values.push({ expression: assignment.getRight(), path: projection.path });
      mutable.set(projection.target, values);
    }
  }
  REQUEST_ASSIGNED_BINDING_INDEX.set(sourceFile, mutable);
  return mutable;
}

function requestAssignmentTargetProjections(
  expression: Node,
  path: readonly string[],
): readonly RequestAssignmentTargetProjection[] {
  const node = unwrapStaticExpression(expression);
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol();
    return symbol ? [{ path, target: requestSymbolKey(symbol) }] : [];
  }
  if (
    Node.isBinaryExpression(node) &&
    node.getOperatorToken().getKind() === SyntaxKind.EqualsToken
  ) {
    return requestAssignmentTargetProjections(node.getLeft(), path);
  }
  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().flatMap((property) => {
      if (Node.isSpreadAssignment(property)) {
        return requestAssignmentTargetProjections(property.getExpression(), path);
      }
      if (Node.isShorthandPropertyAssignment(property)) {
        return requestAssignmentTargetProjections(property.getNameNode(), [
          ...path,
          property.getName(),
        ]);
      }
      if (!Node.isPropertyAssignment(property)) return [];
      const member = staticMemberName(property.getNameNode());
      const initializer = property.getInitializer();
      return member && initializer
        ? requestAssignmentTargetProjections(initializer, [...path, member])
        : [];
    });
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().flatMap((element, index) => {
      if (Node.isOmittedExpression(element)) return [];
      if (Node.isSpreadElement(element)) {
        return requestAssignmentTargetProjections(element.getExpression(), path);
      }
      return requestAssignmentTargetProjections(element, [...path, String(index)]);
    });
  }
  if (Node.isObjectBindingPattern(node) || Node.isArrayBindingPattern(node)) {
    return node.getElements().flatMap((element, index) => {
      if (Node.isOmittedExpression(element)) return [];
      const rest = element.getDotDotDotToken() !== undefined;
      const member = Node.isObjectBindingPattern(node)
        ? staticMemberName(element.getPropertyNameNode() ?? element.getNameNode())
        : String(index);
      return requestAssignmentTargetProjections(
        element.getNameNode(),
        rest || !member ? path : [...path, member],
      );
    });
  }
  return [];
}

function requestCallableAssignmentExpressions(
  symbol: NonNullable<ReturnType<Node['getSymbol']>>,
  session?: RequestProvenanceSession,
): Node[] {
  return requestAssignedBindingProjections(symbol, session)
    .filter((projection) => projection.path.length === 0)
    .map((projection) => projection.expression);
}

function requestCallableForFunctionNode(node: Node): RequestCallable | undefined {
  if (
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
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
  session: RequestProvenanceSession,
): string | undefined {
  return requestModuleMethodForExpression(
    expression,
    isProcessModule,
    REQUEST_PROCESS_METHODS,
    seen,
    depth,
    'process',
    session,
  );
}

function requestVmMethodForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
  session: RequestProvenanceSession,
): string | undefined {
  return requestModuleMethodForExpression(
    expression,
    isVmModule,
    REQUEST_VM_METHODS,
    seen,
    depth,
    'vm',
    session,
  );
}

function requestFilesystemMethodForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
  session: RequestProvenanceSession,
): string | undefined {
  return requestModuleMethodForExpression(
    expression,
    isFilesystemModule,
    REQUEST_FILESYSTEM_METHODS,
    seen,
    depth,
    'filesystem',
    session,
  );
}

function requestPathMethodForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
  session: RequestProvenanceSession,
): string | undefined {
  return requestModuleMethodForExpression(
    expression,
    isPathModule,
    REQUEST_PATH_METHODS,
    seen,
    depth,
    'path',
    session,
  );
}

function requestWorkerMethodForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
  session: RequestProvenanceSession,
): string | undefined {
  return requestModuleMethodForExpression(
    expression,
    isWorkerModule,
    REQUEST_WORKER_METHODS,
    seen,
    depth,
    'worker',
    session,
  );
}

function requestClusterMethodForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
  session: RequestProvenanceSession,
): string | undefined {
  return requestModuleMethodForExpression(
    expression,
    isClusterModule,
    REQUEST_CLUSTER_METHODS,
    seen,
    depth,
    'cluster',
    session,
  );
}

type RequestEnvironmentNamespace = 'Bun' | 'Deno' | 'import.meta' | 'node:process';

interface RequestEnvironmentCarrier {
  readonly kind: 'env' | 'owner' | 'value';
  readonly namespace: RequestEnvironmentNamespace;
}

const REQUEST_ENVIRONMENT_PROJECT_SIGNAL = new WeakMap<object, boolean>();

function requestProjectHasEnvironmentSignal(node: Node): boolean {
  const project = node.getProject();
  const cached = REQUEST_ENVIRONMENT_PROJECT_SIGNAL.get(project);
  if (cached !== undefined) return cached;
  const signal = project
    .getSourceFiles()
    .some((sourceFile) =>
      /\b(?:Bun|Deno|process)\b|\bimport\s*\.\s*meta\b/u.test(sourceFile.getFullText()),
    );
  REQUEST_ENVIRONMENT_PROJECT_SIGNAL.set(project, signal);
  return signal;
}

function requestEnvironmentCarrierForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
): RequestEnvironmentCarrier | undefined {
  const node = unwrapStaticExpression(expression);
  if (!requestProjectHasEnvironmentSignal(node)) return undefined;
  const nodeKey = `environment-carrier:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey)) return undefined;
  seen.add(nodeKey);

  if (requestExpressionIsImportMeta(node)) return { kind: 'owner', namespace: 'import.meta' };
  if (
    expressionResolvesToGlobalNamespace(node, 'process', new Set(), 0) ||
    expressionResolvesToModuleNamespace(node, isNodeProcessModule, new Set(), 0)
  ) {
    return { kind: 'owner', namespace: 'node:process' };
  }
  if (expressionResolvesToGlobalNamespace(node, 'Bun', new Set(), 0)) {
    return { kind: 'owner', namespace: 'Bun' };
  }
  if (expressionResolvesToGlobalNamespace(node, 'Deno', new Set(), 0)) {
    return { kind: 'owner', namespace: 'Deno' };
  }

  const reflective = requestReflectivePropertyRead(node, new Set());
  if (reflective?.member !== undefined) {
    const carrier = requestEnvironmentCarrierForProjectedExpression(
      reflective.owner,
      [reflective.member],
      new Set(seen),
      depth + 1,
    );
    if (carrier) return carrier;
  }

  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    if (member !== undefined) {
      const receiver = node.getExpression();
      const receiverCarrier = requestEnvironmentCarrierForExpression(
        receiver,
        new Set(seen),
        depth + 1,
      );
      const memberCarrier = receiverCarrier
        ? requestEnvironmentCarrierForMember(receiverCarrier, member)
        : undefined;
      if (memberCarrier) return memberCarrier;

      const projected = requestWireProjectedExpression(receiver, [member], new Set(), 0);
      if (projected) {
        const carrier = requestEnvironmentCarrierForExpression(projected, new Set(seen), depth + 1);
        if (carrier) return carrier;
      }
      for (const assigned of requestAssignedMemberExpressions(receiver, member)) {
        const carrier = requestEnvironmentCarrierForExpression(assigned, new Set(seen), depth + 1);
        if (carrier) return carrier;
      }
      for (const output of requestGetterOutputExpressions(receiver, member, new Set())) {
        const carrier = requestEnvironmentCarrierForExpression(output, new Set(seen), depth + 1);
        if (carrier) return carrier;
      }
    }
  }

  if (Node.isConditionalExpression(node)) {
    for (const branch of [node.getWhenTrue(), node.getWhenFalse()]) {
      const carrier = requestEnvironmentCarrierForExpression(branch, new Set(seen), depth + 1);
      if (carrier) return carrier;
    }
  }
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getKind();
    const branches =
      operator === SyntaxKind.CommaToken
        ? [node.getRight()]
        : operator === SyntaxKind.BarBarToken ||
            operator === SyntaxKind.AmpersandAmpersandToken ||
            operator === SyntaxKind.QuestionQuestionToken ||
            operator === SyntaxKind.EqualsToken
          ? [node.getLeft(), node.getRight()]
          : [];
    for (const branch of branches) {
      const carrier = requestEnvironmentCarrierForExpression(branch, new Set(seen), depth + 1);
      if (carrier) return carrier;
    }
  }

  if (!Node.isIdentifier(node)) return undefined;
  const symbol = node.getSymbol();
  if (!symbol) return undefined;
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return undefined;
  seen.add(symbolKey);
  for (const declaration of symbol.getDeclarations()) {
    if (Node.isBindingElement(declaration)) {
      const projection = requestBindingElementProjection(declaration);
      if (projection) {
        const carrier = requestEnvironmentCarrierForProjectedExpression(
          projection.expression,
          projection.path,
          new Set(seen),
          depth + 1,
        );
        if (carrier) return carrier;
      }
      const fallback = declaration.getInitializer();
      if (fallback) {
        const carrier = requestEnvironmentCarrierForExpression(fallback, new Set(seen), depth + 1);
        if (carrier) return carrier;
      }
      continue;
    }
    const initializer = valueDeclarationInitializer(declaration);
    if (!initializer) continue;
    const carrier = requestEnvironmentCarrierForExpression(initializer, new Set(seen), depth + 1);
    if (carrier) return carrier;
  }
  for (const projection of requestAssignedBindingProjections(symbol)) {
    const carrier = requestEnvironmentCarrierForProjectedExpression(
      projection.expression,
      projection.path,
      new Set(seen),
      depth + 1,
    );
    if (carrier) return carrier;
  }
  return undefined;
}

function requestEnvironmentCarrierForProjectedExpression(
  expression: Node,
  path: readonly string[],
  seen: Set<string>,
  depth: number,
): RequestEnvironmentCarrier | undefined {
  if (path.length === 0) {
    return requestEnvironmentCarrierForExpression(expression, seen, depth + 1);
  }
  const sourceCarrier = requestEnvironmentCarrierForExpression(
    expression,
    new Set(seen),
    depth + 1,
  );
  if (sourceCarrier) {
    let carrier: RequestEnvironmentCarrier | undefined = sourceCarrier;
    for (const member of path) {
      carrier = carrier ? requestEnvironmentCarrierForMember(carrier, member) : undefined;
    }
    if (carrier) return carrier;
  }
  const [member, ...rest] = path;
  const projected = requestWireProjectedExpression(expression, [member!], new Set(), 0);
  return projected
    ? requestEnvironmentCarrierForProjectedExpression(projected, rest, new Set(seen), depth + 1)
    : undefined;
}

function requestEnvironmentCarrierForMember(
  carrier: RequestEnvironmentCarrier,
  member: string,
): RequestEnvironmentCarrier | undefined {
  if (carrier.kind === 'owner') {
    return member === 'env' ? { kind: 'env', namespace: carrier.namespace } : undefined;
  }
  return { kind: 'value', namespace: carrier.namespace };
}

function requestEnvironmentAuthorityForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
): RequestRawAuthority | undefined {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `node:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey)) return undefined;
  seen.add(nodeKey);

  const environmentCarrier = requestEnvironmentCarrierForExpression(node, new Set(), depth);
  if (environmentCarrier && environmentCarrier.kind !== 'owner') {
    return {
      sink: `${environmentCarrier.namespace}.env`,
      safePath: REQUEST_ENVIRONMENT_SAFE_PATH,
    };
  }

  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    const receiver = unwrapStaticExpression(node.getExpression());
    if (
      member === 'env' &&
      (requestExpressionIsImportMeta(receiver) ||
        expressionResolvesToGlobalNamespace(receiver, 'process', new Set(), 0) ||
        expressionResolvesToModuleNamespace(receiver, isNodeProcessModule, new Set(), 0) ||
        expressionResolvesToGlobalNamespace(receiver, 'Bun', new Set(), 0) ||
        expressionResolvesToGlobalNamespace(receiver, 'Deno', new Set(), 0))
    ) {
      const namespace = requestExpressionIsImportMeta(receiver)
        ? 'import.meta'
        : expressionResolvesToGlobalNamespace(receiver, 'process', new Set(), 0) ||
            expressionResolvesToModuleNamespace(receiver, isNodeProcessModule, new Set(), 0)
          ? 'node:process'
          : expressionResolvesToGlobalNamespace(receiver, 'Bun', new Set(), 0)
            ? 'Bun'
            : 'Deno';
      return { sink: `${namespace}.env`, safePath: REQUEST_ENVIRONMENT_SAFE_PATH };
    }

    if (member) {
      for (const output of requestGetterOutputExpressions(receiver, member, new Set())) {
        const getterAuthority = requestEnvironmentAuthorityForExpression(
          output,
          new Set(seen),
          depth + 1,
        );
        if (getterAuthority) return getterAuthority;
      }
    }

    if (member) {
      const projected = requestWireProjectedExpression(receiver, [member], new Set(), 0);
      if (projected) {
        return requestEnvironmentAuthorityForExpression(projected, seen, depth + 1);
      }
    }

    if (member && Node.isIdentifier(receiver)) {
      const imported = requestEnvironmentAuthorityForImportedIdentifier(
        receiver,
        member,
        seen,
        depth + 1,
      );
      if (imported !== undefined) return imported ?? undefined;
    }

    const nested = requestEnvironmentAuthorityForExpression(receiver, seen, depth + 1);
    if (nested) return nested;
  }

  if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
    if (Node.isCallExpression(node)) {
      if (
        requestCallIsPublicMutationFormAttributes(node) &&
        requestCallIsExactJsxSpreadExpression(node)
      ) {
        return undefined;
      }
      const componentDescriptor = requestComponentDescriptorCallForExpression(node, new Set());
      if (componentDescriptor && requestComponentDescriptorIsPristine(componentDescriptor)) {
        // `component({...})` returns a frozen descriptor; its render callback is scanned when the
        // exact descriptor is invoked. Configuration values are not themselves descriptor output.
        return undefined;
      }
      const reflective = requestReflectiveEnvironmentAuthority(node);
      if (reflective) return reflective;
      const resolution = resolveRequestCallable(node.getExpression(), new Set(), 0);
      for (const callable of resolution.callables) {
        for (const output of requestWireOutputExpressions(callable)) {
          const returned = requestEnvironmentAuthorityForExpression(
            output,
            new Set(seen),
            depth + 1,
          );
          if (returned) return returned;
        }
      }
    }
    if (Node.isNewExpression(node)) {
      for (const output of requestGetterOutputExpressions(node, undefined, new Set())) {
        const getterAuthority = requestEnvironmentAuthorityForExpression(
          output,
          new Set(seen),
          depth + 1,
        );
        if (getterAuthority) return getterAuthority;
      }
    }
    for (const argument of node.getArguments()) {
      const nested = requestEnvironmentAuthorityForExpression(argument, seen, depth + 1);
      if (nested) return nested;
    }
  }
  if (Node.isObjectLiteralExpression(node)) {
    for (const property of node.getProperties()) {
      const value = Node.isPropertyAssignment(property)
        ? property.getInitializer()
        : Node.isShorthandPropertyAssignment(property)
          ? property.getNameNode()
          : Node.isSpreadAssignment(property)
            ? property.getExpression()
            : undefined;
      if (value) {
        const nested = requestEnvironmentAuthorityForExpression(value, seen, depth + 1);
        if (nested) return nested;
      }
      if (Node.isGetAccessorDeclaration(property) || Node.isMethodDeclaration(property)) {
        const body = property.getBody();
        if (!body) continue;
        for (const output of requestWireOutputExpressions({ body, declaration: property })) {
          const nested = requestEnvironmentAuthorityForExpression(output, seen, depth + 1);
          if (nested) return nested;
        }
      }
    }
  }
  if (Node.isArrayLiteralExpression(node)) {
    for (const element of node.getElements()) {
      const nested = requestEnvironmentAuthorityForExpression(element, seen, depth + 1);
      if (nested) return nested;
    }
  }
  if (Node.isSpreadElement(node)) {
    return requestEnvironmentAuthorityForExpression(node.getExpression(), seen, depth + 1);
  }
  if (Node.isYieldExpression(node)) {
    const yielded = node.getExpression();
    return yielded ? requestEnvironmentAuthorityForExpression(yielded, seen, depth + 1) : undefined;
  }
  if (Node.isConditionalExpression(node)) {
    for (const branch of [node.getCondition(), node.getWhenTrue(), node.getWhenFalse()]) {
      const nested = requestEnvironmentAuthorityForExpression(branch, seen, depth + 1);
      if (nested) return nested;
    }
  }
  if (Node.isBinaryExpression(node)) {
    return (
      requestEnvironmentAuthorityForExpression(node.getLeft(), seen, depth + 1) ??
      requestEnvironmentAuthorityForExpression(node.getRight(), seen, depth + 1)
    );
  }
  if (Node.isTemplateExpression(node)) {
    for (const span of node.getTemplateSpans()) {
      const nested = requestEnvironmentAuthorityForExpression(
        span.getExpression(),
        seen,
        depth + 1,
      );
      if (nested) return nested;
    }
  }

  const symbol = node.getSymbol();
  if (symbol) {
    const key = requestSymbolKey(symbol);
    if (seen.has(key)) return undefined;
    seen.add(key);
    try {
      const aliased = symbol.getAliasedSymbol();
      if (aliased && aliased !== symbol) {
        const aliasKey = requestSymbolKey(aliased);
        if (!seen.has(aliasKey)) {
          seen.add(aliasKey);
          for (const declaration of aliased.getDeclarations()) {
            const initializer = valueDeclarationInitializer(declaration);
            if (!initializer) continue;
            const nested = requestEnvironmentAuthorityForExpression(initializer, seen, depth + 1);
            if (nested) return nested;
          }
        }
      }
    } catch {
      // Relative import declarations are resolved explicitly below when the checker has no alias.
    }
    for (const declaration of symbol.getDeclarations()) {
      if (Node.isImportSpecifier(declaration)) {
        const moduleSource = declaration.getImportDeclaration().getModuleSpecifierSourceFile();
        for (const exported of moduleSource?.getExportedDeclarations().get(declaration.getName()) ??
          []) {
          const initializer = valueDeclarationInitializer(exported);
          if (!initializer) continue;
          const nested = requestEnvironmentAuthorityForExpression(initializer, seen, depth + 1);
          if (nested) return nested;
        }
      }
      if (Node.isImportClause(declaration)) {
        const moduleSource = declaration
          .getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
          ?.getModuleSpecifierSourceFile();
        for (const exported of moduleSource?.getExportedDeclarations().get('default') ?? []) {
          const initializer = valueDeclarationInitializer(exported);
          if (!initializer) continue;
          const nested = requestEnvironmentAuthorityForExpression(initializer, seen, depth + 1);
          if (nested) return nested;
        }
      }
      const initializer = valueDeclarationInitializer(declaration);
      if (!initializer) continue;
      const nested = requestEnvironmentAuthorityForExpression(initializer, seen, depth + 1);
      if (nested) return nested;
    }
  }
  if (Node.isIdentifier(node)) {
    const imported = requestEnvironmentAuthorityForImportedIdentifier(
      node,
      undefined,
      seen,
      depth + 1,
    );
    if (imported !== undefined) return imported ?? undefined;
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      return requestEnvironmentAuthorityForExpression(initializer, seen, depth + 1);
    }
  }
  return undefined;
}

function requestReflectiveEnvironmentAuthority(
  call: import('ts-morph').CallExpression,
): RequestRawAuthority | undefined {
  const callee = unwrapStaticExpression(call.getExpression());
  const receiver = requestCallReceiver(callee);
  const member = requestStaticCallMember(callee);
  if (!receiver || !member || !requestExpressionIsSafeGlobalNamespace(receiver)) return undefined;
  const [target, property] = call.getArguments();
  if (!target || staticMemberName(property) !== 'env') return undefined;
  if (
    !(
      (member === 'get' &&
        expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0)) ||
      (member === 'getOwnPropertyDescriptor' &&
        (expressionResolvesToGlobalNamespace(receiver, 'Object', new Set(), 0) ||
          expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), 0)))
    )
  ) {
    return undefined;
  }
  const namespace = requestEnvironmentOwnerNamespace(target);
  return namespace
    ? { sink: `${namespace}.env`, safePath: REQUEST_ENVIRONMENT_SAFE_PATH }
    : undefined;
}

function requestEnvironmentOwnerNamespace(expression: Node): string | undefined {
  const carrier = requestEnvironmentCarrierForExpression(expression, new Set(), 0);
  return carrier?.kind === 'owner' ? carrier.namespace : undefined;
}

function requestEnvironmentAuthorityForImportedIdentifier(
  identifier: import('ts-morph').Identifier,
  namespaceMember: string | undefined,
  seen: Set<string>,
  depth: number,
): RequestRawAuthority | null | undefined {
  const local = identifier.getText();
  for (const declaration of identifier.getSourceFile().getImportDeclarations()) {
    const moduleSource = declaration.getModuleSpecifierSourceFile();
    if (!moduleSource) continue;
    let exportName: string | undefined;
    let projection: readonly string[] = [];
    if (namespaceMember && declaration.getNamespaceImport()?.getText() === local) {
      exportName = namespaceMember;
    } else if (declaration.getDefaultImport()?.getText() === local) {
      exportName = 'default';
      if (namespaceMember) projection = [namespaceMember];
    } else {
      const named = declaration
        .getNamedImports()
        .find((entry) => (entry.getAliasNode()?.getText() ?? entry.getName()) === local);
      exportName = named?.getName();
      if (namespaceMember) projection = [namespaceMember];
    }
    if (!exportName) continue;
    for (const exported of moduleSource.getExportedDeclarations().get(exportName) ?? []) {
      const initializer = valueDeclarationInitializer(exported);
      if (!initializer) continue;
      const value =
        projection.length > 0
          ? requestWireProjectedExpression(initializer, projection, new Set(), 0)
          : initializer;
      if (!value) continue;
      const authority = requestEnvironmentAuthorityForExpression(value, seen, depth + 1);
      if (authority) return authority;
      return null;
    }
  }
  return undefined;
}

function requestExpressionIsImportMeta(expression: Node): boolean {
  const node = unwrapStaticExpression(expression);
  if (node.getKind() !== SyntaxKind.MetaProperty) return false;
  const compilerNode = node.compilerNode as ts.MetaProperty;
  return (
    compilerNode.keywordToken === ts.SyntaxKind.ImportKeyword && compilerNode.name.text === 'meta'
  );
}

function requestRawAuthorityForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
  session: RequestProvenanceSession = createRequestProvenanceSession(),
): RequestRawAuthority | undefined {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `raw:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey)) return undefined;
  seen.add(nodeKey);
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    if (member) {
      for (const assigned of requestAssignedMemberExpressions(node.getExpression(), member)) {
        const authority = requestRawAuthorityForExpression(
          assigned,
          new Set(seen),
          depth + 1,
          session,
        );
        if (authority) return authority;
      }
    }
  }
  // Exact reviewed module families are both cheaper and more precise than the generic global
  // callable checks. Resolve child_process first so a long immutable alias chain never enters the
  // TypeScript checker's recursive global-name path before its authority is already known.
  const processMethod = requestProcessMethodForExpression(
    expression,
    new Set(seen),
    depth,
    session,
  );
  if (processMethod) {
    return { sink: `child_process.${processMethod}`, safePath: REQUEST_PROCESS_SAFE_PATH };
  }
  const environment = requestEnvironmentAuthorityForExpression(expression, new Set(seen), depth);
  if (environment) return environment;
  if (expressionResolvesToGlobalCallable(expression, 'eval', new Set(seen), depth)) {
    return { sink: 'eval', safePath: REQUEST_DYNAMIC_CODE_SAFE_PATH };
  }
  if (expressionResolvesToGlobalCallable(expression, 'Function', new Set(seen), depth)) {
    return { sink: 'Function', safePath: REQUEST_DYNAMIC_CODE_SAFE_PATH };
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
  const filesystemMethod = requestFilesystemMethodForExpression(
    expression,
    new Set(seen),
    depth,
    session,
  );
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
  const pathMethod = requestPathMethodForExpression(expression, new Set(seen), depth, session);
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
  const vmMethod = requestVmMethodForExpression(expression, new Set(seen), depth, session);
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
  const workerMethod = requestWorkerMethodForExpression(expression, new Set(seen), depth, session);
  if (workerMethod) {
    return {
      sink: `node:worker_threads.${workerMethod}`,
      safePath: REQUEST_DYNAMIC_CODE_SAFE_PATH,
    };
  }
  const clusterMethod = requestClusterMethodForExpression(
    expression,
    new Set(seen),
    depth,
    session,
  );
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
  allowGlobalObjectAlias = true,
): boolean {
  const node = unwrapStaticExpression(expression);
  if (unshadowedGlobalIdentifier(node, globalName)) {
    return (
      allowGlobalObjectAlias ||
      !requestGlobalIntrinsicBindingIsMutated(globalName, node.getSourceFile())
    );
  }
  if (
    allowGlobalObjectAlias &&
    (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node))
  ) {
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
        allowGlobalObjectAlias,
      );
    }
  }
  if (
    Node.isBinaryExpression(node) &&
    node.getOperatorToken().getKind() === SyntaxKind.CommaToken
  ) {
    return expressionResolvesToGlobalCallable(
      node.getRight(),
      globalName,
      seen,
      depth + 1,
      allowGlobalObjectAlias,
    );
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
        expressionResolvesToGlobalCallable(
          initializer,
          globalName,
          seen,
          depth + 1,
          allowGlobalObjectAlias,
        )
      ) {
        return true;
      }
    }
  }
  if (Node.isIdentifier(node)) {
    const declaration = localValueDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (initializer) {
      return expressionResolvesToGlobalCallable(
        initializer,
        globalName,
        seen,
        depth + 1,
        allowGlobalObjectAlias,
      );
    }
  }
  return false;
}

function requestFrameworkAuthorityForExpression(
  expression: Node,
  seen: Set<string> = new Set(),
): RequestRawAuthority | undefined {
  const node = unwrapStaticExpression(expression);
  const key = requestNodeIdentity(node);
  if (seen.has(key)) return undefined;
  seen.add(key);
  let identity = canonicalFrameworkExportForExpression(node);
  if (
    !identity &&
    (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node))
  ) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    const projected = member
      ? requestWireProjectedExpression(node.getExpression(), [member], new Set(), 0)
      : undefined;
    if (projected) identity = canonicalFrameworkExportForExpression(projected);
    if (!identity && member) {
      for (const assigned of requestAssignedMemberExpressions(node.getExpression(), member)) {
        const authority = requestFrameworkAuthorityForExpression(assigned, new Set(seen));
        if (authority) return authority;
      }
    }
  }
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
  const node = unwrapStaticExpression(expression);

  const moduleAlias = requestModuleConstAliasChain(node);
  if (moduleAlias) {
    return moduleAlias.terminal
      ? requestGlobalNamespaceMethodForExpression(
          moduleAlias.terminal,
          namespace,
          methods,
          seen,
          depth + 1,
        )
      : undefined;
  }

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
    return requestGlobalNamespaceMethodForExpression(callee, namespace, methods, seen, depth + 1);
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
  if (Node.isCallExpression(node)) {
    const callee = unwrapStaticExpression(node.getExpression());
    const receiver = requestCallReceiver(callee);
    const [target, property] = node.getArguments();
    if (
      receiver &&
      requestStaticCallMember(callee) === 'get' &&
      expressionResolvesToGlobalNamespace(receiver, 'Reflect', new Set(), depth + 1) &&
      target &&
      (unshadowedGlobalIdentifier(target, 'globalThis') ||
        unshadowedGlobalIdentifier(target, 'global')) &&
      staticMemberName(property) === namespace
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
  cacheKind = 'module',
  session: RequestProvenanceSession = createRequestProvenanceSession(),
): string | undefined {
  const root = unwrapStaticExpression(expression);
  const rootKey = `${cacheKind}:${requestNodeIdentity(root)}`;
  const cached = session.moduleMethodMemo.get(rootKey);
  if (cached !== undefined) return cached ?? undefined;

  const nodes: Node[] = [root];
  const symbols: NonNullable<ReturnType<Node['getSymbol']>>[] = [];
  const visitedNodes = new Set(seen);
  const visitedSymbols = new Set<string>();
  const memoKeys: string[] = [];
  let resolved: string | undefined;

  while ((nodes.length > 0 || symbols.length > 0) && resolved === undefined) {
    if (nodes.length > 0) {
      const node = unwrapStaticExpression(nodes.pop()!);
      const key = `node:${requestNodeIdentity(node)}`;
      if (visitedNodes.has(key)) continue;
      visitedNodes.add(key);
      memoKeys.push(`${cacheKind}:${requestNodeIdentity(node)}`);
      const memoized = session.moduleMethodMemo.get(`${cacheKind}:${requestNodeIdentity(node)}`);
      if (memoized !== undefined) {
        if (memoized) resolved = memoized;
        continue;
      }
      if (!requestProvenanceStep(session, node)) break;

      if (Node.isCallExpression(node)) {
        const callee = unwrapStaticExpression(node.getExpression());
        const receiver = requestCallReceiver(callee);
        if (receiver && requestStaticCallMember(callee) === 'bind') {
          nodes.push(receiver);
        } else {
          nodes.push(callee);
        }
      }
      if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
        const member = Node.isPropertyAccessExpression(node)
          ? staticMemberName(node.getNameNode())
          : staticMemberName(node.getArgumentExpression());
        if (
          member &&
          methods.has(member) &&
          expressionResolvesToModuleNamespace(
            node.getExpression(),
            moduleMatches,
            new Set(),
            depth + 1,
          )
        ) {
          resolved = member;
          break;
        }
      }
      if (Node.isIdentifier(node)) {
        const declaration = requestUnshadowedModuleConstDeclaration(node);
        const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
        if (initializer) {
          nodes.push(initializer);
          continue;
        }
      }
      const symbol = node.getSymbol();
      if (symbol) symbols.push(symbol);
      if (Node.isIdentifier(node) && !symbol) {
        const declaration = localValueDeclaration(node);
        const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
        if (initializer) nodes.push(initializer);
      }
      continue;
    }

    const symbol = symbols.pop()!;
    const key = requestSymbolKey(symbol);
    if (visitedSymbols.has(key)) continue;
    visitedSymbols.add(key);
    try {
      const aliased = symbol.getAliasedSymbol();
      if (aliased && aliased !== symbol) symbols.push(aliased);
    } catch {
      // The exact import declaration below remains authoritative for unresolved aliases.
    }
    for (const declaration of symbol.getDeclarations()) {
      if (Node.isImportSpecifier(declaration)) {
        const module = declaration.getImportDeclaration().getModuleSpecifierValue();
        const imported = declaration.getName();
        if (moduleMatches(module) && methods.has(imported)) {
          resolved = imported;
          break;
        }
      }
      if (Node.isExportSpecifier(declaration)) {
        const exportDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ExportDeclaration);
        const module = exportDeclaration?.getModuleSpecifierValue();
        const imported = declaration.getName();
        if (module && moduleMatches(module) && methods.has(imported)) {
          resolved = imported;
          break;
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
          resolved = member;
          break;
        }
      }
      const initializer = valueDeclarationInitializer(declaration);
      if (initializer) nodes.push(initializer);
    }
  }

  for (const key of memoKeys) session.moduleMethodMemo.set(key, resolved ?? null);
  session.moduleMethodMemo.set(rootKey, resolved ?? null);
  return resolved;
}

function expressionResolvesToModuleNamespace(
  expression: Node,
  moduleMatches: (specifier: string | undefined) => boolean,
  seen: Set<string>,
  depth: number,
): boolean {
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

const REQUEST_LOCAL_VALUE_DECLARATION_INDEX = new WeakMap<object, ReadonlyMap<string, Node>>();

interface RequestModuleConstIndex {
  readonly blocked: ReadonlySet<string>;
  readonly declarations: ReadonlyMap<string, Node>;
}

const REQUEST_MODULE_CONST_INDEX = new WeakMap<object, RequestModuleConstIndex>();

function requestUnshadowedModuleConstDeclaration(identifier: Node): Node | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;
  const sourceFile = identifier.getSourceFile();
  let index = REQUEST_MODULE_CONST_INDEX.get(sourceFile);
  if (!index) {
    const blocked = new Set<string>();
    const declarations = new Map<string, Node>();
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const names = requestBindingIdentifierNames(declaration.getNameNode());
      const statement = declaration.getVariableStatement();
      const isModuleConst =
        Node.isIdentifier(declaration.getNameNode()) &&
        statement?.getParent().getKind() === SyntaxKind.SourceFile &&
        statement.getDeclarationKind() === VariableDeclarationKind.Const;
      for (const name of names) {
        if (!isModuleConst || declarations.has(name)) {
          blocked.add(name);
          continue;
        }
        declarations.set(name, declaration);
      }
    }
    for (const parameter of sourceFile.getDescendantsOfKind(SyntaxKind.Parameter)) {
      for (const name of requestBindingIdentifierNames(parameter.getNameNode())) blocked.add(name);
    }
    for (const declaration of [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.EnumDeclaration),
    ]) {
      if (declaration.getParent().getKind() === SyntaxKind.SourceFile) continue;
      const name = declaration.getName();
      if (name) blocked.add(name);
    }
    index = { blocked, declarations };
    REQUEST_MODULE_CONST_INDEX.set(sourceFile, index);
  }
  const name = identifier.getText();
  return index.blocked.has(name) ? undefined : index.declarations.get(name);
}

interface RequestModuleConstAliasChain {
  readonly nodes: readonly Node[];
  readonly terminal?: Node;
}

function requestModuleConstAliasChain(expression: Node): RequestModuleConstAliasChain | undefined {
  let node = unwrapStaticExpression(expression);
  const nodes: Node[] = [];
  const seen = new Set<string>();
  while (Node.isIdentifier(node)) {
    const declaration = requestUnshadowedModuleConstDeclaration(node);
    const initializer = declaration ? valueDeclarationInitializer(declaration) : undefined;
    if (!initializer) break;
    const key = requestNodeIdentity(node);
    if (seen.has(key)) return { nodes };
    seen.add(key);
    nodes.push(node);
    node = unwrapStaticExpression(initializer);
  }
  return nodes.length > 0 ? { nodes, terminal: node } : undefined;
}

function localValueDeclaration(identifier: Node): Node | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;
  const name = identifier.getText();
  const sourceFile = identifier.getSourceFile();
  let index = REQUEST_LOCAL_VALUE_DECLARATION_INDEX.get(sourceFile);
  if (!index) {
    const declarations = new Map<string, Node>();
    for (const declaration of sourceFile.getFunctions()) {
      const declarationName = declaration.getName();
      if (declarationName && !declarations.has(declarationName)) {
        declarations.set(declarationName, declaration);
      }
    }
    for (const declaration of sourceFile.getVariableDeclarations()) {
      for (const declarationName of requestBindingIdentifierNames(declaration.getNameNode())) {
        if (!declarations.has(declarationName)) declarations.set(declarationName, declaration);
      }
    }
    index = declarations;
    REQUEST_LOCAL_VALUE_DECLARATION_INDEX.set(sourceFile, index);
  }
  return index.get(name);
}

function requestIdentifierValueSymbol(
  identifier: Node,
): NonNullable<ReturnType<Node['getSymbol']>> | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;
  const shorthand = identifier.getParentIfKind(SyntaxKind.ShorthandPropertyAssignment);
  const symbol = shorthand?.getValueSymbol() ?? identifier.getSymbol();
  if (!symbol) return undefined;
  try {
    // Source snapshots form a closed in-memory module graph. Resolve a relative import's value
    // declaration before classifying local containers/protocols; retaining only the
    // ImportSpecifier would make ordinary `.js`-spelled TS/TSX imports look opaque while bare
    // packages (which have no source declaration in this graph) still fail closed.
    const aliased = symbol.getAliasedSymbol();
    if (aliased && aliased !== symbol) return aliased;
  } catch {
    // Unresolved/bare aliases remain represented by the import symbol and therefore fail closed.
  }
  return symbol;
}

function requestIdentifierIsImportedMutableContainer(identifier: Node): boolean {
  if (!Node.isIdentifier(identifier)) return false;
  const importSymbol = identifier.getSymbol();
  if (!importSymbol) return false;
  const relativeImport = importSymbol.getDeclarations().some((declaration) => {
    const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    return importDeclaration?.getModuleSpecifierValue().startsWith('.') === true;
  });
  if (!relativeImport) return false;

  const valueSymbol = requestIdentifierValueSymbol(identifier);
  if (!valueSymbol) return true;
  const initializers = valueSymbol
    .getDeclarations()
    .map(valueDeclarationInitializer)
    .filter((initializer): initializer is Node => initializer !== undefined);
  if (initializers.length === 0) return true;
  return initializers.some((initializer) => {
    const node = unwrapStaticExpression(initializer);
    return !(
      Node.isStringLiteral(node) ||
      Node.isNoSubstitutionTemplateLiteral(node) ||
      Node.isNumericLiteral(node) ||
      Node.isBigIntLiteral(node) ||
      Node.isTrueLiteral(node) ||
      Node.isFalseLiteral(node) ||
      node.getKind() === SyntaxKind.NullKeyword
    );
  });
}

function requestBindingIdentifierNames(name: Node): string[] {
  if (Node.isIdentifier(name)) return [name.getText()];
  if (!Node.isObjectBindingPattern(name) && !Node.isArrayBindingPattern(name)) return [];
  return name
    .getElements()
    .flatMap((element) =>
      Node.isOmittedExpression(element) ? [] : requestBindingIdentifierNames(element.getNameNode()),
    );
}

function valueDeclarationInitializer(declaration: Node): Node | undefined {
  if (
    Node.isVariableDeclaration(declaration) ||
    Node.isPropertyAssignment(declaration) ||
    Node.isParameterDeclaration(declaration)
  ) {
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

function requestBindingElementProjection(
  binding: Node,
): RequestAssignedBindingProjection | undefined {
  if (!Node.isBindingElement(binding)) return undefined;
  const path: string[] = [];
  let element: import('ts-morph').BindingElement = binding;
  while (true) {
    const pattern = element.getParent();
    if (!Node.isObjectBindingPattern(pattern) && !Node.isArrayBindingPattern(pattern)) {
      return undefined;
    }
    if (element.getDotDotDotToken() === undefined) {
      const member = Node.isObjectBindingPattern(pattern)
        ? staticMemberName(element.getPropertyNameNode() ?? element.getNameNode())
        : String(pattern.getElements().indexOf(element));
      if (!member || member === '-1') return undefined;
      path.unshift(member);
    }
    const owner = pattern.getParent();
    if (Node.isVariableDeclaration(owner) || Node.isParameterDeclaration(owner)) {
      const expression = owner.getInitializer();
      return expression ? { expression, path } : undefined;
    }
    if (!Node.isBindingElement(owner)) return undefined;
    element = owner;
  }
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

const REQUEST_SAFE_BUILTIN_MODULES = new Set<string>();

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
  if (!expression) return undefined;
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
  if (Node.isIdentifier(node)) {
    const parent = node.getParent();
    return parent &&
      ((Node.isElementAccessExpression(parent) && parent.getArgumentExpression() === node) ||
        (Node.isComputedPropertyName(parent) && parent.getExpression() === node))
      ? undefined
      : node.compilerNode.text;
  }
  if (Node.isNumericLiteral(node)) return node.getText();
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isComputedPropertyName(node)) {
    const expression = unwrapStaticExpression(node.getExpression());
    if (Node.isNumericLiteral(expression)) return expression.getText();
    if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.getLiteralText();
    }
    return requestStaticStringExpressionValue(expression);
  }
  return requestStaticStringExpressionValue(node);
}

function requestCallableMemberName(node: Node | undefined): string | undefined {
  const staticName = staticMemberName(node);
  if (staticName !== undefined) return staticName;
  const candidate = node && Node.isComputedPropertyName(node) ? node.getExpression() : node;
  const expression = candidate ? unwrapStaticExpression(candidate) : undefined;
  if (!expression) return undefined;
  if (!Node.isPropertyAccessExpression(expression) && !Node.isElementAccessExpression(expression)) {
    return undefined;
  }
  const member = Node.isPropertyAccessExpression(expression)
    ? staticMemberName(expression.getNameNode())
    : staticMemberName(expression.getArgumentExpression());
  return member &&
    expressionResolvesToGlobalNamespace(expression.getExpression(), 'Symbol', new Set(), 0)
    ? `@@${member}`
    : undefined;
}

function requestStaticStringExpressionValue(expression: Node): string | undefined {
  const node = unwrapStaticExpression(expression);
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
    const left = requestStaticStringExpressionValue(node.getLeft());
    const right = requestStaticStringExpressionValue(node.getRight());
    return left === undefined || right === undefined ? undefined : `${left}${right}`;
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
  return `${symbol.getName()}:${symbol
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
