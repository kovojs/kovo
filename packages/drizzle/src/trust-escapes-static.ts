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
import type {
  CapabilityExplain,
  CookieDowngradeExplain,
  TrustEscapeExplain,
  UnregisteredSinkFact,
} from '@kovojs/core/internal/graph';
import {
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
      allowJs: false,
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
      for (const sourceFile of sourceFiles) project.removeSourceFile(sourceFile);
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
    return facts.sort(
      (left, right) => left.site.localeCompare(right.site) || left.sink.localeCompare(right.sink),
    );
  } finally {
    dispose();
  }
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
    if (name === 'eval') {
      const [arg] = call.getArguments();
      return { sink: 'eval', safePath: 'remove dynamic code evaluation', ...sourceField(arg) };
    }
    if (name === 'setTimeout' || name === 'setInterval') {
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
