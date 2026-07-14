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
  if (!staticBuildTrustAnalysisRequired(options.files)) {
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
    '\\bimport\\s*\\.\\s*meta\\s*(?:\\.\\s*env\\b|\\[\\s*[\'"]env[\'"]\\s*\\])',
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
    if (staticBuildTrustImportMetaEnvironment(node)) {
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

function staticBuildTrustImportMetaEnvironment(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return (
      staticBuildTrustIdentifierText(node.name) === 'env' &&
      isStaticBuildImportMeta(node.expression)
    );
  }
  if (ts.isElementAccessExpression(node)) {
    return (
      staticBuildTrustStaticString(node.argumentExpression) === 'env' &&
      isStaticBuildImportMeta(node.expression)
    );
  }
  return false;
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

function staticBuildTrustIdentifierText(identifier: ts.MemberName): string | undefined {
  return ts.isIdentifier(identifier) ? identifier.text : undefined;
}

function staticBuildTrustStaticString(expression: ts.Expression | undefined): string | undefined {
  if (!expression) return undefined;
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isParenthesizedExpression(expression)) {
    return staticBuildTrustStaticString(expression.expression);
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticBuildTrustStaticString(expression.left);
    const right = staticBuildTrustStaticString(expression.right);
    return left === undefined || right === undefined ? undefined : `${left}${right}`;
  }
  return undefined;
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
  readonly roles?: readonly RequestRootParameterRole[];
  readonly staticValue?: 'access' | 'redirect' | 'scalar';
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
        publicWire: true,
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
      { carriers: [{ carrier: 'request', index: 0 }], property: 'guard', roles: ['request'] },
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
      { carriers: [{ carrier: 'request', index: 0 }], property: 'guard', roles: ['request'] },
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
      { carriers: [{ carrier: 'request', index: 0 }], property: 'guard', roles: ['request'] },
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
      { carriers: [{ carrier: 'request', index: 0 }], property: 'guard', roles: ['request'] },
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
  readonly declaration: Node;
  readonly publicWire?: boolean;
  readonly publicWireMethods?: readonly string[];
  readonly rootCallback?: string;
  readonly rootCarriers?: readonly RequestRootCarrier[];
  readonly rootFactory?: RequestHandlerFactoryName;
  readonly rootParameterRoles?: readonly RequestRootParameterRole[];
}

interface RequestCallableResolution {
  readonly callables: readonly RequestCallable[];
  readonly opaqueModule?: string;
}

interface RequestProcessScanContext {
  readonly facts: UnregisteredSinkFact[];
  readonly filesByPath: ReadonlyMap<string, TrustEscapeSourceFileInput>;
  readonly provenance: RequestProvenanceSession;
  readonly scanned: Set<string>;
}

const REQUEST_PROVENANCE_BUDGET = 250_000;

interface RequestProvenanceSession {
  readonly callableActive: Set<string>;
  readonly callableMemo: Map<string, RequestCallableResolution>;
  readonly callableSymbolActive: Set<string>;
  readonly callableSymbolMemo: Map<string, RequestCallableResolution>;
  readonly carrierActive: Set<string>;
  readonly carrierMemo: Map<string, RequestWireCarrier | null>;
  exhaustedAt?: Node;
  readonly factoryActive: Set<string>;
  readonly factoryMemo: Map<string, readonly RequestHandlerFactoryName[]>;
  readonly factorySymbolActive: Set<string>;
  readonly factorySymbolMemo: Map<string, readonly RequestHandlerFactoryName[]>;
  remaining: number;
  readonly wireActive: Set<string>;
  readonly wireMemo: Map<string, readonly RequestWireAuthority[]>;
  readonly writeActive: Set<string>;
  readonly writeMemo: Map<string, readonly RequestWireAuthority[]>;
}

function createRequestProvenanceSession(): RequestProvenanceSession {
  return {
    callableActive: new Set(),
    callableMemo: new Map(),
    callableSymbolActive: new Set(),
    callableSymbolMemo: new Map(),
    carrierActive: new Set(),
    carrierMemo: new Map(),
    factoryActive: new Set(),
    factoryMemo: new Map(),
    factorySymbolActive: new Set(),
    factorySymbolMemo: new Map(),
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
    scanned: new Set(),
  };

  // Only supplied app snapshots may establish request roots. Resolved local helpers can then be
  // followed transitively, but a package import absent from this project is a closed verdict.
  for (const sourceFile of sourceFiles) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      for (const invocation of requestHandlerFactoryInvocationsForCall(call, context.provenance)) {
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
            appendOpaqueRequestHandlerFact(
              context,
              candidate,
              opaqueBareModuleForExpression(candidate, new Set(), 0) ?? '<dynamic-config>',
            );
          }
          continue;
        }
        scanRequestRootCallbacks(definition, factory, context, args[args.length - 1]!);
      }
    }
  }

  if (context.provenance.exhaustedAt) {
    appendRequestProvenanceBudgetFact(context, context.provenance.exhaustedAt);
  }

  return context.facts;
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

  if (
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

function requestStaticArgumentList(
  expression: Node | undefined,
  seen = new Set<string>(),
): readonly Node[] | undefined {
  const node = expression ? unwrapStaticExpression(expression) : undefined;
  if (!node) return undefined;
  if (Node.isArrayLiteralExpression(node)) return node.getElements();
  if (!Node.isIdentifier(node)) return undefined;
  const symbol = node.getSymbol();
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

  const resolved = new Set<RequestHandlerFactoryName>();
  const appAuthoringFactory = requestAppAuthoringFactoryForExpression(node, session);
  if (appAuthoringFactory) resolved.add(appAuthoringFactory);
  if (
    Node.isElementAccessExpression(node) &&
    staticMemberName(node.getArgumentExpression()) === undefined &&
    requestExpressionIsCreateAppAuthoringContext(node.getExpression(), new Set(), session)
  ) {
    for (const factory of REQUEST_APP_AUTHORING_FACTORIES) resolved.add(factory);
  }
  for (const { exportName } of REQUEST_HANDLER_FACTORIES) {
    if (
      expressionResolvesToFrameworkExport(node, frameworkExport('@kovojs/server', exportName), {
        legacyGlobals: [frameworkExport('@kovojs/server', exportName)],
      })
    ) {
      resolved.add(exportName);
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
      const projected = requestWireProjectedExpression(
        node.getExpression(),
        [member],
        new Set(),
        0,
      );
      if (projected) {
        for (const name of requestFrameworkFactoriesForExpression(projected, session)) {
          resolved.add(name);
        }
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
  }

  const symbol = node.getSymbol();
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
    const declaration = localValueDeclaration(node);
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
    }
    const initializer = valueDeclarationInitializer(declaration);
    if (!initializer) continue;
    for (const name of requestFrameworkFactoriesForExpression(initializer, session)) {
      resolved.add(name);
    }
  }
  for (const assigned of requestCallableAssignmentExpressions(symbol)) {
    for (const name of requestFrameworkFactoriesForExpression(assigned, session)) {
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
): void {
  for (const spec of factory.callbacks as readonly RequestRootCallbackSpec[]) {
    for (const property of requestRootPropertyCandidates(
      definitionSource,
      definition,
      spec.property.split('.'),
      context,
    )) {
      scanRequestRootCallbackProperty(property, factory, spec, context);
    }
  }

  scanRequestNestedDeclarations(definitionSource, definition, factory.exportName, context);
  scanRequestStaticPublicWire(definitionSource, definition, factory.exportName, context);

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
      candidates.push(...requestAssignedObjectPropertyExpressions(current.source, name, context));
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
): Node[] {
  const node = unwrapStaticExpression(owner);
  if (!Node.isIdentifier(node) || !node.getSymbol()) return [];
  const target = requestSymbolKey(node.getSymbol()!);
  const expressions: Node[] = [];
  const sourceFile = node.getSourceFile();
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
    if (!assigned || !requestWireExpressionResolvesToSymbol(assigned, target, new Set(), 0)) {
      continue;
    }
    for (const source of sources) {
      const object = resolveStaticObjectLiteral(source, new Set(), 0);
      const property = object ? requestStaticObjectProperty(object, name) : undefined;
      if (property) expressions.push(property);
      if (!object) appendOpaqueRequestHandlerFact(context, source, '<dynamic-config-mutation>');
    }
  }
  return dedupeRequestNodes(expressions);
}

function requestAssignedMemberExpressions(owner: Node, name: string): Node[] {
  const node = unwrapStaticExpression(owner);
  if (!Node.isIdentifier(node) || !node.getSymbol()) return [];
  const target = requestSymbolKey(node.getSymbol()!);
  const expressions: Node[] = [];
  const sourceFile = node.getSourceFile();
  for (const assignment of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (
      assignment.getOperatorToken().getKind() < SyntaxKind.FirstAssignment ||
      assignment.getOperatorToken().getKind() > SyntaxKind.LastAssignment
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
    if (!assigned || !requestWireExpressionResolvesToSymbol(assigned, target, new Set(), 0)) {
      continue;
    }
    for (const source of sources) {
      const object = resolveStaticObjectLiteral(source, new Set(), 0);
      const property = object ? requestStaticObjectProperty(object, name) : undefined;
      const expression = property ? requestHandlerPropertyExpression(property) : undefined;
      if (expression) expressions.push(expression);
    }
  }
  return dedupeRequestNodes(expressions);
}

function dedupeRequestNodes(nodes: readonly Node[]): Node[] {
  return [...new Map(nodes.map((node) => [requestNodeIdentity(node), node])).values()];
}

const REQUEST_CREATE_APP_DECLARATION_COLLECTIONS = [
  ['endpoints', 'endpoint'],
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
): void {
  if (factory === 'createApp') {
    for (const [property, nestedFactory] of REQUEST_CREATE_APP_DECLARATION_COLLECTIONS) {
      for (const candidate of requestRootPropertyCandidates(
        definitionSource,
        definition,
        [property],
        context,
      )) {
        const expression = requestHandlerPropertyExpression(candidate) ?? candidate;
        for (const nested of requestDeclarationDefinitions(
          expression,
          nestedFactory,
          context,
          new Set(),
        )) {
          const spec = REQUEST_HANDLER_FACTORIES.find(
            (entry) => entry.exportName === nestedFactory,
          );
          if (spec) scanRequestRootCallbacks(nested.definition, spec, context, nested.source);
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
          new Set(),
        )) {
          const spec = REQUEST_HANDLER_FACTORIES.find((item) => item.exportName === 'query');
          if (spec) scanRequestRootCallbacks(nested.definition, spec, context, nested.source);
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
  )) {
    const expression = requestHandlerPropertyExpression(candidate) ?? candidate;
    for (const nested of requestDeclarationDefinitions(expression, 'layout', context, new Set())) {
      const spec = REQUEST_HANDLER_FACTORIES.find((entry) => entry.exportName === 'layout');
      if (spec) scanRequestRootCallbacks(nested.definition, spec, context, nested.source);
    }
  }
}

interface RequestDeclarationDefinition {
  readonly definition: import('ts-morph').ObjectLiteralExpression;
  readonly source: Node;
}

function requestDeclarationDefinitions(
  expression: Node,
  factory: RequestHandlerFactoryName,
  context: RequestProcessScanContext,
  seen: Set<string>,
): RequestDeclarationDefinition[] {
  const node = unwrapStaticExpression(expression);
  const key = `node:${requestNodeIdentity(node)}:${factory}`;
  if (seen.has(key) || !requestProvenanceStep(context.provenance, node)) return [];
  seen.add(key);
  const object = resolveStaticObjectLiteral(node, new Set(), 0);
  if (object) return [{ definition: object, source: node }];
  if (Node.isArrayLiteralExpression(node)) {
    return node
      .getElements()
      .flatMap((element) =>
        requestDeclarationDefinitions(
          Node.isSpreadElement(element) ? element.getExpression() : element,
          factory,
          context,
          new Set(seen),
        ),
      );
  }
  if (Node.isConditionalExpression(node)) {
    return [node.getWhenTrue(), node.getWhenFalse()].flatMap((branch) =>
      requestDeclarationDefinitions(branch, factory, context, new Set(seen)),
    );
  }
  if (Node.isCallExpression(node)) {
    const invocations = requestHandlerFactoryInvocationsForCall(node, context.provenance).filter(
      (invocation) => invocation.factory.exportName === factory,
    );
    const direct = invocations.flatMap((invocation) => {
      const candidate = invocation.args?.[invocation.args.length - 1];
      const definition = candidate
        ? resolveStaticObjectLiteral(candidate, new Set(), 0)
        : undefined;
      return definition && candidate ? [{ definition, source: candidate }] : [];
    });
    if (direct.length > 0) return direct;
    return resolveRequestCallable(
      node.getExpression(),
      new Set(),
      0,
      context.provenance,
    ).callables.flatMap((callable) =>
      requestWireOutputExpressions(callable).flatMap((output) =>
        requestDeclarationDefinitions(output, factory, context, new Set(seen)),
      ),
    );
  }
  if (
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isFunctionDeclaration(node)
  ) {
    const callable = requestCallableForFunctionNode(node);
    return callable
      ? requestWireOutputExpressions(callable).flatMap((output) =>
          requestDeclarationDefinitions(output, factory, context, new Set(seen)),
        )
      : [];
  }
  if (!Node.isIdentifier(node)) return [];
  const callableOutputs = resolveRequestCallable(
    node,
    new Set(),
    0,
    context.provenance,
  ).callables.flatMap((callable) =>
    requestWireOutputExpressions(callable).flatMap((output) =>
      requestDeclarationDefinitions(output, factory, context, new Set(seen)),
    ),
  );
  if (callableOutputs.length > 0) return callableOutputs;
  const symbol = node.getSymbol();
  if (!symbol) return [];
  const symbolKey = requestSymbolKey(symbol);
  if (seen.has(symbolKey)) return [];
  seen.add(symbolKey);
  return symbol.getDeclarations().flatMap((declaration) => {
    const initializer = valueDeclarationInitializer(declaration);
    return initializer
      ? requestDeclarationDefinitions(initializer, factory, context, new Set(seen))
      : [];
  });
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
): void {
  for (const property of REQUEST_STATIC_PUBLIC_WIRE_PROPERTIES.get(factory) ?? []) {
    for (const candidate of requestRootPropertyCandidates(
      definitionSource,
      definition,
      [property],
      context,
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
    const raw = requestRawAuthorityForExpression(candidate, new Set(), 0);
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
  if (elements) {
    for (const element of elements) {
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
  if (kind === 'scalar' && Node.isNumericLiteral(node)) return true;
  if (kind === 'access' && Node.isCallExpression(node)) {
    return ['publicAccess', 'verifiedMachineAccess'].some(
      (name) =>
        expressionResolvesToFrameworkExport(
          node.getExpression(),
          frameworkExport('@kovojs/server', name),
        ) ||
        expressionResolvesToFrameworkExport(
          node.getExpression(),
          frameworkExport('@kovojs/core', name),
        ),
    );
  }
  if (Node.isConditionalExpression(node)) {
    return (
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
  const key = `${callable.declaration.getSourceFile().getFilePath()}:${callable.declaration.getStart()}:${callable.rootFactory ?? 'nested'}:${callable.rootCallback ?? 'helper'}`;
  if (context.scanned.has(key)) return;
  context.scanned.add(key);

  scanRequestWireConfidentiality(callable, context);
  const executionRoots: readonly Node[] = [
    callable.body,
    ...requestCallableParameters(callable.declaration),
  ];

  for (const output of requestWireOutputExpressions(callable)) {
    for (const accessor of requestAccessorCallablesForExpression(output, undefined, new Set())) {
      scanRequestCallable(accessor, context);
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
      scanRequestCallable(accessor, context);
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
    if (body) scanRequestCallable({ body, declaration: getter }, context);
  }

  const calls = executionRoots
    .flatMap((root) => [
      ...(Node.isCallExpression(root) ? [root] : []),
      ...root.getDescendantsOfKind(SyntaxKind.CallExpression),
    ])
    .filter((candidate) => nodeBelongsToRequestCallable(candidate, callable));
  for (const call of calls) {
    for (const argument of call.getArguments()) {
      for (const accessor of requestAccessorCallablesForExpression(
        argument,
        undefined,
        new Set(),
      )) {
        scanRequestCallable(accessor, context);
      }
    }
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

    const fetchInvocation = requestGovernedFetchInvocation(call);
    if (fetchInvocation) {
      scanOutboundFetchConfidentiality(call, fetchInvocation.args, callable, context);
      continue;
    }
    if (requestCallIsReviewedPureDrizzleExpression(call)) continue;

    // Exact framework authority minters were classified above. Other package calls terminate at
    // their imported implementation, while local same-named wrappers remain traversable. There is
    // deliberately no blanket "framework-owned means safe" exemption.
    const resolution = resolveRequestCallable(
      call.getExpression(),
      new Set(),
      0,
      context.provenance,
    );
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
  if (!callable.publicWire && !callable.publicWireMethods?.length) return;
  const state: RequestWireAnalysisState = {
    bindingKey: 'root',
    bindings: new Map(),
    rootCallable: callable,
    session: context.provenance,
    scopeCallable: callable,
  };
  const wireExpressions = callable.publicWire ? requestWireOutputExpressions(callable) : [];
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
  for (const output of wireExpressions) {
    const authorities = requestWireAuthoritiesForExpression(output, state);
    for (const authority of authorities) {
      appendRequestAuthorityFact(context, output, authority, authority.source);
    }
  }
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
): RequestWireAuthority[] {
  const node = unwrapStaticExpression(expression);
  const nodeKey = requestWireStateKey('wire', node, state);
  const memoized = state.session.wireMemo.get(nodeKey);
  if (memoized) return [...memoized];
  if (state.session.wireActive.has(nodeKey)) return [];
  if (!requestProvenanceStep(state.session, node)) {
    return [requestProvenanceBudgetAuthority(node)];
  }
  state.session.wireActive.add(nodeKey);
  const authorities = requestWireAuthoritiesForExpressionUncached(node, state);
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
): RequestWireAuthority[] {
  if (Node.isAwaitExpression(node)) {
    return requestWireAuthoritiesForExpression(node.getExpression(), state);
  }

  if (Node.isCallExpression(node)) {
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
          authorities.push(...requestWireAuthoritiesForExpression(output, nestedState));
        }
      }
      if (invocation.args === undefined) {
        authorities.push(...requestWireAuthoritiesForExpressions(node.getArguments(), state));
      }
      return dedupeRequestWireAuthorities(authorities);
    }

    return dedupeRequestWireAuthorities([
      ...(receiver ? requestWireAuthoritiesForExpression(receiver, state) : []),
      ...requestWireAuthoritiesForExpressions(invocation.args ?? node.getArguments(), state),
    ]);
  }

  if (Node.isNewExpression(node)) {
    return dedupeRequestWireAuthorities([
      ...requestWireAuthoritiesForExpressions(node.getArguments(), state),
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
    return requestWireAuthoritiesForExpression(node.getExpression(), state);
  }
  if (Node.isYieldExpression(node)) {
    const yielded = node.getExpression();
    return yielded ? requestWireAuthoritiesForExpression(yielded, state) : [];
  }
  if (Node.isConditionalExpression(node)) {
    return requestWireAuthoritiesForExpressions(
      [node.getCondition(), node.getWhenTrue(), node.getWhenFalse()],
      state,
    );
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
    return requestWireAuthoritiesForExpression(node.getTemplate(), state);
  }
  if (Node.isPrefixUnaryExpression(node) || Node.isPostfixUnaryExpression(node)) {
    return requestWireAuthoritiesForExpression(node.getOperand(), state);
  }

  return [];
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
  const symbol = identifier.getSymbol();
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

  const authorities: RequestWireAuthority[] = [];
  const declarations = symbol?.getDeclarations() ?? [];
  for (const declaration of declarations) {
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
      requestExpressionIsSafeGlobalNamespace(receiver) &&
      call.getArguments()[0] !== undefined &&
      requestWireMutationTargetResolvesToSymbol(call.getArguments()[0]!, symbolKey);
    const globalDefinesOrSets =
      !!member &&
      !!receiver &&
      requestExpressionIsSafeGlobalNamespace(receiver) &&
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

function requestClassDeclarationsForExpression(
  expression: Node,
  seen: Set<string>,
): Array<import('ts-morph').ClassDeclaration | import('ts-morph').ClassExpression> {
  const node = unwrapStaticExpression(expression);
  if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) return [node];
  const symbol = node.getSymbol();
  if (!symbol) return [];
  const key = requestSymbolKey(symbol);
  if (seen.has(key)) return [];
  seen.add(key);
  const classes: Array<import('ts-morph').ClassDeclaration | import('ts-morph').ClassExpression> =
    [];
  for (const declaration of symbol.getDeclarations()) {
    if (Node.isClassDeclaration(declaration) || Node.isClassExpression(declaration)) {
      classes.push(declaration);
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
    const initializer = valueDeclarationInitializer(declaration);
    if (
      initializer &&
      requestWireExpressionResolvesToSymbol(initializer, target, seen, depth + 1)
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
  'Reflect',
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
  if (
    REQUEST_SAFE_FETCH_RESPONSE_METHODS.has(member) &&
    requestExpressionIsFetchResponse(receiver, new Set())
  ) {
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (requestExpressionIsFrameworkCapability(receiver, new Set(), 0)) {
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (requestExpressionIsSafeGlobalNamespace(receiver)) {
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
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (role === 'request' && REQUEST_SAFE_REQUEST_METHODS.has(member)) {
    scanRequestFunctionArguments(call, context);
    return true;
  }
  if (
    (requestRootRoleIncludesInput(role) ||
      (requestExpressionIsIntrinsicValue(receiver, callable, new Set(), 0) &&
        !requestExpressionHasMutableObjectOrigin(receiver, new Set()))) &&
    REQUEST_SAFE_JSON_VALUE_METHODS.has(member)
  ) {
    scanRequestFunctionArguments(call, context);
    return requestKnownCallbacksAreClosed(call, member, context);
  }
  return false;
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
  if (expressionResolvesToGlobalCallable(node, 'fetch', new Set(), 0)) return true;
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
  if (canonicalFrameworkExportForExpression(target)) return true;
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
        (member === undefined || staticMemberName(property.getNameNode()) === member)
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
        staticMemberName(requestObjectLiteralElementNameNode(property)) === member
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
    return requestClassDeclarationsForExpression(node.getExpression(), new Set()).flatMap(
      (declaration) =>
        [
          ...declaration.getGetAccessors(),
          ...declaration.getSetAccessors(),
          ...declaration.getMethods(),
        ]
          .filter((property) => member === undefined || property.getName() === member)
          .flatMap((property) => {
            const callable = requestCallableForFunctionNode(property);
            return callable ? [callable] : [];
          }),
    );
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
  return declarations.flatMap((declaration) => {
    const declaredCallable = requestCallableForFunctionNode(declaration);
    if (declaredCallable && member === undefined) return [declaredCallable];
    const initializer = valueDeclarationInitializer(declaration);
    return initializer
      ? requestAccessorCallablesForExpression(initializer, member, new Set(seen), session)
      : [];
  });
}

function requestJsonSerializationOutputExpressions(
  expression: Node,
  session: RequestProvenanceSession,
): Node[] {
  return requestAccessorCallablesForExpression(expression, 'toJSON', new Set(), session).flatMap(
    (callable) => requestWireOutputExpressions(callable),
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
  return !!imported && REQUEST_REVIEWED_DRIZZLE_EXPRESSIONS.has(imported.exportName);
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
    for (const getter of declaration.getGetAccessors()) {
      const body = getter.getBody();
      if (body) scanRequestCallable({ body, declaration: getter }, context);
    }
  }
  return sawClass;
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
  const indexes = REQUEST_CALLBACK_ARGUMENTS.get(member);
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
  if (!callable.rootFactory) return undefined;
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

function requestExpressionIsFrameworkCapability(
  expression: Node,
  seen: Set<string>,
  depth: number,
): boolean {
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
  for (const assigned of requestCallableAssignmentExpressions(symbol)) {
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

function requestCallableAssignmentExpressions(
  symbol: NonNullable<ReturnType<Node['getSymbol']>>,
): Node[] {
  const key = requestSymbolKey(symbol);
  const sourceFiles = new Set(
    symbol.getDeclarations().map((declaration) => declaration.getSourceFile()),
  );
  const expressions: Node[] = [];
  for (const sourceFile of sourceFiles) {
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
      if (!Node.isIdentifier(target) || !target.getSymbol()) continue;
      if (requestSymbolKey(target.getSymbol()!) === key) expressions.push(assignment.getRight());
    }
  }
  return expressions;
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

function requestEnvironmentAuthorityForExpression(
  expression: Node,
  seen: Set<string>,
  depth: number,
): RequestRawAuthority | undefined {
  const node = unwrapStaticExpression(expression);
  const nodeKey = `node:${requestNodeIdentity(node)}`;
  if (seen.has(nodeKey)) return undefined;
  seen.add(nodeKey);

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
  const node = unwrapStaticExpression(expression);
  if (requestExpressionIsImportMeta(node)) return 'import.meta';
  if (
    expressionResolvesToGlobalNamespace(node, 'process', new Set(), 0) ||
    expressionResolvesToModuleNamespace(node, isNodeProcessModule, new Set(), 0)
  ) {
    return 'node:process';
  }
  if (expressionResolvesToGlobalNamespace(node, 'Bun', new Set(), 0)) return 'Bun';
  if (expressionResolvesToGlobalNamespace(node, 'Deno', new Set(), 0)) return 'Deno';
  return undefined;
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
): RequestRawAuthority | undefined {
  const node = unwrapStaticExpression(expression);
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const member = Node.isPropertyAccessExpression(node)
      ? staticMemberName(node.getNameNode())
      : staticMemberName(node.getArgumentExpression());
    if (member) {
      for (const assigned of requestAssignedMemberExpressions(node.getExpression(), member)) {
        const authority = requestRawAuthorityForExpression(assigned, new Set(seen), depth + 1);
        if (authority) return authority;
      }
    }
  }
  const environment = requestEnvironmentAuthorityForExpression(expression, new Set(seen), depth);
  if (environment) return environment;
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
): string | undefined {
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
  if (!symbol) return undefined;
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
