import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import * as ts from 'typescript';

import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import { expressionResolvesToTrustedHtmlPureBrand } from '../output-context-facts.js';
import type { ComponentModuleModel } from '../scan/parse.js';

/**
 * SPEC §9.1 (sink renderer) / §5.2 #10 (output safety) / §4.8 (trustedHtml escape hatch), KV426
 * (KV236/KV426 family): `trustedHtml(x)` is a PURE brand that performs no sanitization — it brands
 * `x` so a raw-HTML sink emits it verbatim. Branding provably REQUEST- or QUERY-derived data is
 * therefore a by-construction XSS sink (`trustedHtml(renderMarkdown(userBody))` is stored XSS), and
 * the brand currently suppresses KV236 silently. This gate ERRORS when the branded value is provably
 * request/query-derived.
 *
 * Provenance is decided by AST symbol-identity over the request/query source set (SPEC §6.6(1):
 * "classification is carried by AST symbol-identity provenance … never [a] text heuristic"; §5.2
 * rule 9: post-parse phases decide from typed facts, never raw source strings), modeled on the
 * KV438 mass-assignment write-provenance gate (SPEC §10.3/§11.1) and on KV437's client-capture gate
 * (its `publishToClient(value, { reason })` audited-escape shape is mirrored here).
 *
 * Bounded blast radius (technical-preview bias: the gate is unconditional, the escape is
 * explicit + audited). The gate flags only PROVABLY-tainted argument expressions:
 *   - a request root: the conventional mutation/form `input` identifier, or a `req`/`request`
 *     accessor chain (`req.search`/`req.params`/`req.body`/`req.headers`/`req.cookies`/…);
 *   - a query root: a render binding destructured from the component's `queries` result;
 *   - those reached directly, via a field access (`question.body`), via taint-preserving local
 *     composition (`question.body ?? ''`, `` `${question.body}` ``), or via a same-scope
 *     alias/destructure/derive (`const { body } = question; trustedHtml(body)`).
 * It deliberately does NOT flag a function-call result (`trustedHtml(renderUserCard(q.name))`):
 * the compiler has no inter-procedural return provenance here (cf. KV437's callee-position reasoning
 * and KV438's `kovoAnalyzerSummary` requirement), so a call result is treated as opaque/clean. That
 * keeps framework-internal/server-derived `trustedHtml(...)` usage clean instead of cascading a
 * blanket "justify every call" rule across the codebase. The residue — `trustedHtml(f(tainted))`
 * where `f` re-emits the taint as raw HTML — is documented, not silently swallowed.
 *
 * Author escapes (audit-visible in `kovo explain --trust`, consistent with KV438's
 * serverValue/adminAssign):
 *   - render user/CMS content through `safeRichHtml(value)` — the sanitizing rich-HTML floor; it is
 *     a different callee, so it is never flagged here;
 *   - for a value the author asserts is safe, take the audited escape `trustedHtml(value,
 *     "<justification>")` (a non-empty static reason), which discharges the gate but stays recorded.
 */
export function validateTrustedHtmlProvenance(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const sourceFile = model.sourceFile;
  const bindingsByRender = renderProvenanceBindings(sourceFile);

  const found: CompilerDiagnostic[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && callResolvesToTrustedHtmlPureBrand(sourceFile, node)) {
      const value = node.arguments[0];
      if (value !== undefined && !ts.isSpreadElement(value) && !hasAuditedReason(node)) {
        const provenance = classifyExpression(value, {
          ...enclosingRenderProvenanceBindings(node, bindingsByRender),
          depth: 0,
          visited: new Set<ts.Node>(),
        });
        if (provenance !== null) {
          found.push(trustedHtmlProvenanceDiagnostic(diagnostics, value, provenance));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

type Provenance = 'request' | 'query';

interface ClassifyContext {
  readonly queryBindings: ReadonlySet<string>;
  readonly queryDataRoots: ReadonlyMap<string, ReadonlySet<string>>;
  readonly requestBindings: ReadonlySet<string>;
  readonly depth: number;
  readonly visited: Set<ts.Node>;
}

interface RenderProvenanceBindings {
  readonly queryBindings: ReadonlySet<string>;
  readonly queryDataRoots: ReadonlyMap<string, ReadonlySet<string>>;
  readonly requestBindings: ReadonlySet<string>;
}

const MAX_ALIAS_DEPTH = 6;

/** Conventional request-derived root identifier (the mutation/form input object; KV438 source set). */
const REQUEST_INPUT_IDENTIFIER = 'input';
/** Request accessor roots and their first-segment members (SPEC §11.1 request-derived source set). */
const REQUEST_ACCESSOR_ROOTS = new Set(['req', 'request']);
const REQUEST_ACCESSORS = new Set([
  'body',
  'cookies',
  'formData',
  'headers',
  'json',
  'params',
  'query',
  'search',
  'text',
  'url',
]);
const AUDITED_REASON_PROPERTY = 'reason';
const COMPONENT_FACTORY_NAME = 'component';
const CORE_MODULE_SPECIFIER = '@kovojs/core';
const QUERIES_PROPERTY = 'queries';
const RENDER_PROPERTY = 'render';

function callResolvesToTrustedHtmlPureBrand(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): boolean {
  if (expressionResolvesToTrustedHtmlPureBrand(sourceFile, call.expression)) return true;
  return wrapperHelperResolvesToTrustedHtmlPureBrand(sourceFile, call);
}

/**
 * Same-file wrapper-helper recognition for KV426's pure brand sink. This is intentionally narrower
 * than TypeScript type inference: it follows AST symbol identity to a local helper whose body
 * directly calls the real `trustedHtml(param)` pure brand. The call-site argument still owns
 * request/query provenance per SPEC §6.6; the helper return type or brand annotation is not proof.
 */
function wrapperHelperResolvesToTrustedHtmlPureBrand(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): boolean {
  const callee = unwrap(call.expression);
  if (!ts.isIdentifier(callee)) return false;
  const declaration = localCallableDeclaration(callee, callee.text);
  if (declaration === undefined) return false;

  const body =
    ts.isVariableDeclaration(declaration) && declaration.initializer
      ? callableBody(declaration.initializer)
      : ts.isFunctionDeclaration(declaration)
        ? declaration.body
        : undefined;
  if (body === undefined) return false;

  const parameterName = callableFirstParameterName(declaration);
  if (parameterName === undefined) return false;

  const trustedCall = directReturnExpression(body);
  if (trustedCall === undefined || !ts.isCallExpression(trustedCall)) return false;
  if (!expressionResolvesToTrustedHtmlPureBrand(sourceFile, trustedCall.expression)) return false;

  const brandedValue = trustedCall.arguments[0];
  if (brandedValue === undefined) return false;
  const unwrappedValue = unwrap(brandedValue);
  return ts.isIdentifier(unwrappedValue) && unwrappedValue.text === parameterName;
}

/**
 * Classify an expression's data provenance from typed AST facts. Returns `'request'`/`'query'` when
 * the value is PROVABLY request/query-derived, or `null` (opaque/clean) otherwise — fail-open only
 * for the inter-procedural residue the gate intentionally does not model (function-call results).
 */
function classifyExpression(node: ts.Expression, ctx: ClassifyContext): Provenance | null {
  const expr = unwrap(node);

  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
    return classifyMemberRoot(expr, ctx);
  }
  if (ts.isIdentifier(expr)) {
    return classifyIdentifier(expr, ctx);
  }
  if (ts.isConditionalExpression(expr)) {
    const whenTrue = classifyExpression(expr.whenTrue, ctx);
    if (whenTrue !== null) return whenTrue;
    return classifyExpression(expr.whenFalse, { ...ctx, visited: new Set(ctx.visited) });
  }
  if (ts.isBinaryExpression(expr) && binaryOperatorMayPropagateTaint(expr.operatorToken.kind)) {
    const left = classifyExpression(expr.left, ctx);
    if (left !== null) return left;
    return classifyExpression(expr.right, { ...ctx, visited: new Set(ctx.visited) });
  }
  if (ts.isTemplateExpression(expr)) {
    for (const span of expr.templateSpans) {
      const provenance = classifyExpression(span.expression, {
        ...ctx,
        visited: new Set(ctx.visited),
      });
      if (provenance !== null) return provenance;
    }
  }
  // Function-call results and literals are opaque: the gate does not invent inter-procedural taint
  // (documented residue), while taint-preserving local composition is handled above.
  return null;
}

function binaryOperatorMayPropagateTaint(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.PlusToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken ||
    kind === ts.SyntaxKind.CommaToken
  );
}

/** Classify a member-access chain (`a.b.c`, `req.params.id`) by its leftmost root and first member. */
function classifyMemberRoot(
  expr: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  ctx: ClassifyContext,
): Provenance | null {
  let cursor: ts.Expression = expr;
  let firstMember: string | undefined;
  while (
    ts.isPropertyAccessExpression(cursor) ||
    ts.isElementAccessExpression(cursor) ||
    ts.isNonNullExpression(cursor) ||
    ts.isParenthesizedExpression(cursor)
  ) {
    if (ts.isPropertyAccessExpression(cursor)) {
      firstMember = cursor.name.text;
      cursor = cursor.expression;
    } else if (ts.isElementAccessExpression(cursor)) {
      const member = elementAccessName(cursor.argumentExpression);
      if (member !== null) firstMember = member;
      cursor = cursor.expression;
    } else {
      cursor = cursor.expression;
    }
  }

  if (ts.isIdentifier(cursor)) {
    // `req.params.id` / `request.body.html`: request-derived when the root is an unshadowed request
    // accessor and the first member is a request channel.
    if (
      (ctx.requestBindings.has(cursor.text) || REQUEST_ACCESSOR_ROOTS.has(cursor.text)) &&
      firstMember !== undefined &&
      REQUEST_ACCESSORS.has(firstMember) &&
      localConstInitializer(cursor, cursor.text) === undefined
    ) {
      return 'request';
    }
    const queryRootKeys = ctx.queryDataRoots.get(cursor.text);
    if (
      queryRootKeys !== undefined &&
      firstMember !== undefined &&
      queryRootKeys.has(firstMember)
    ) {
      return 'query';
    }
    return classifyIdentifier(cursor, ctx);
  }
  return classifyExpression(cursor, ctx);
}

/** Classify a bare identifier: same-scope alias/derive first (it shadows), then query/request roots. */
function classifyIdentifier(id: ts.Identifier, ctx: ClassifyContext): Provenance | null {
  // A same-scope `const name = <expr>` shadows any param/query binding: follow the alias/derive.
  const init = localConstInitializer(id, id.text);
  if (init !== undefined && ctx.depth < MAX_ALIAS_DEPTH && !ctx.visited.has(init)) {
    ctx.visited.add(init);
    return classifyExpression(init, { ...ctx, depth: ctx.depth + 1 });
  }

  if (ctx.queryBindings.has(id.text)) return 'query';
  if (ctx.queryDataRoots.has(id.text)) return 'query';
  if (ctx.requestBindings.has(id.text)) return 'request';
  if (id.text === REQUEST_INPUT_IDENTIFIER) return 'request';
  return null;
}

/**
 * The initializer of the nearest enclosing `const <name> = <init>` or
 * `const { <name> } = <init>` visible at `node`, if any.
 */
function localConstInitializer(node: ts.Node, name: string): ts.Expression | undefined {
  let cursor: ts.Node | undefined = node.parent;
  while (cursor) {
    if (ts.isBlock(cursor) || ts.isSourceFile(cursor)) {
      for (const statement of cursor.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === name &&
            declaration.initializer
          ) {
            return declaration.initializer;
          }
          if (
            ts.isObjectBindingPattern(declaration.name) &&
            declaration.initializer &&
            objectBindingPatternBindsName(declaration.name, name)
          ) {
            return declaration.initializer;
          }
        }
      }
    }
    cursor = cursor.parent;
  }
  return undefined;
}

function localCallableDeclaration(
  node: ts.Node,
  name: string,
): ts.VariableDeclaration | ts.FunctionDeclaration | undefined {
  const position = node.getStart();
  let cursor: ts.Node | undefined = node.parent;
  while (cursor) {
    if (isFunctionLikeWithParameters(cursor) && cursor.getStart() < position) {
      if (cursor.parameters.some((parameter) => bindingNameBinds(parameter.name, name))) {
        return undefined;
      }
    }
    if (ts.isBlock(cursor) || ts.isSourceFile(cursor)) {
      for (const statement of cursor.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
          return statement;
        }
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            declaration.getStart() < position &&
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === name
          ) {
            return declaration;
          }
        }
      }
    }
    cursor = cursor.parent;
  }
  return undefined;
}

function callableBody(initializer: ts.Expression): ts.ConciseBody | undefined {
  const value = unwrap(initializer);
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value.body;
  return undefined;
}

function callableFirstParameterName(
  declaration: ts.VariableDeclaration | ts.FunctionDeclaration,
): string | undefined {
  const parameters = ts.isVariableDeclaration(declaration)
    ? callableParameters(declaration.initializer)
    : declaration.parameters;
  const first = parameters?.[0];
  return first !== undefined && ts.isIdentifier(first.name) ? first.name.text : undefined;
}

function callableParameters(
  initializer: ts.Expression | undefined,
): ts.NodeArray<ts.ParameterDeclaration> | undefined {
  if (initializer === undefined) return undefined;
  const value = unwrap(initializer);
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value.parameters;
  return undefined;
}

function directReturnExpression(body: ts.ConciseBody): ts.Expression | undefined {
  if (ts.isExpression(body)) return body;
  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement)) return statement.expression;
  }
  return undefined;
}

function isFunctionLikeWithParameters(
  node: ts.Node,
): node is ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression {
  return (
    ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
  );
}

function bindingNameBinds(name: ts.BindingName, target: string): boolean {
  if (ts.isIdentifier(name)) return name.text === target;
  return name.elements.some(
    (element) => ts.isBindingElement(element) && bindingNameBinds(element.name, target),
  );
}

function objectBindingPatternBindsName(pattern: ts.ObjectBindingPattern, name: string): boolean {
  for (const element of pattern.elements) {
    if (ts.isIdentifier(element.name) && identifierName(element.name) === name) return true;
  }
  return false;
}

function elementAccessName(argument: ts.Expression | undefined): string | null {
  if (argument === undefined) return null;
  const expr = unwrap(argument);
  if (ts.isStringLiteralLike(expr)) return literalText(expr);
  return null;
}

/** Discharge: a non-empty STATIC reason as the second argument (`"…"` or `{ reason: "…" }`). */
function hasAuditedReason(call: ts.CallExpression): boolean {
  const metadata = call.arguments[1];
  if (metadata === undefined) return false;
  if (ts.isStringLiteralLike(metadata)) return metadata.text.trim().length > 0;
  if (ts.isObjectLiteralExpression(metadata)) {
    for (const property of metadata.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        identifierName(property.name) === AUDITED_REASON_PROPERTY &&
        ts.isStringLiteralLike(property.initializer)
      ) {
        return property.initializer.text.trim().length > 0;
      }
    }
  }
  return false;
}

function unwrap(node: ts.Expression): ts.Expression {
  let expr = node;
  while (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isNonNullExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isAwaitExpression(expr)
  ) {
    expr = expr.expression;
  }
  return expr;
}

/**
 * Map every component `render` function node to the set of its first-parameter bindings that are
 * destructured from the component's `queries` result. `component({ queries: { question, answers },
 * render: ({ question }, …) => … })` makes `question` a query-derived binding inside that render.
 */
function renderProvenanceBindings(
  sourceFile: ts.SourceFile,
): Map<ts.Node, RenderProvenanceBindings> {
  const byRender = new Map<ts.Node, RenderProvenanceBindings>();
  const componentNames = componentFactoryLocalNames(sourceFile);
  if (componentNames.size === 0) return byRender;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      componentNames.has(node.expression.text) &&
      node.arguments.length > 0 &&
      node.arguments[0] !== undefined &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      collectRenderProvenanceBindings(node.arguments[0] as ts.ObjectLiteralExpression, byRender);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return byRender;
}

function collectRenderProvenanceBindings(
  options: ts.ObjectLiteralExpression,
  byRender: Map<ts.Node, RenderProvenanceBindings>,
): void {
  const queryKeys = new Set<string>();
  let render: ts.FunctionExpression | ts.ArrowFunction | undefined;

  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
    if (
      identifierName(property.name) === QUERIES_PROPERTY &&
      ts.isObjectLiteralExpression(property.initializer)
    ) {
      for (const entry of property.initializer.properties) {
        const key = entry.name;
        const name = key === undefined ? null : propertyNameText(key);
        if (name !== null) queryKeys.add(name);
      }
    }
    if (
      identifierName(property.name) === RENDER_PROPERTY &&
      (ts.isArrowFunction(property.initializer) || ts.isFunctionExpression(property.initializer))
    ) {
      render = property.initializer;
    }
  }

  if (render === undefined) return;
  const dataParam = render.parameters[0];
  const bindings = new Set<string>();
  const queryDataRoots = new Map<string, ReadonlySet<string>>();
  const requestBindings = new Set<string>();

  if (dataParam !== undefined && queryKeys.size > 0) {
    if (ts.isObjectBindingPattern(dataParam.name)) {
      for (const element of dataParam.name.elements) {
        const sourceName = element.propertyName ?? element.name;
        if (
          ts.isIdentifier(sourceName) &&
          queryKeys.has(sourceName.text) &&
          ts.isIdentifier(element.name)
        ) {
          bindings.add(element.name.text);
        }
      }
    } else if (ts.isIdentifier(dataParam.name)) {
      queryDataRoots.set(dataParam.name.text, queryKeys);
    }
  }

  collectRenderRequestBindings(render.parameters[2], requestBindings);

  if (bindings.size > 0 || queryDataRoots.size > 0 || requestBindings.size > 0) {
    byRender.set(render, { queryBindings: bindings, queryDataRoots, requestBindings });
  }
}

function collectRenderRequestBindings(
  requestParam: ts.ParameterDeclaration | undefined,
  bindings: Set<string>,
): void {
  if (requestParam === undefined) return;
  if (ts.isIdentifier(requestParam.name)) {
    bindings.add(requestParam.name.text);
    return;
  }
  if (!ts.isObjectBindingPattern(requestParam.name)) return;

  for (const element of requestParam.name.elements) {
    const sourceName = element.propertyName ?? element.name;
    if (!ts.isIdentifier(sourceName)) continue;
    if (identifierName(sourceName) !== 'request') continue;

    if (ts.isIdentifier(element.name)) {
      bindings.add(identifierName(element.name));
    } else if (ts.isObjectBindingPattern(element.name)) {
      for (const nested of element.name.elements) {
        if (ts.isIdentifier(nested.name)) bindings.add(identifierName(nested.name));
      }
    }
  }
}

/**
 * Local names bound to the `component` factory. The Kovo authoring DSL identifies a component by the
 * `component(...)` call name (the scanner builds `model.components` from bare `component(...)`
 * without requiring an import; SPEC §4.1/§5.2), so the canonical name is always recognized; any
 * `@kovojs/core` alias (`import { component as c }`) is additionally resolved by symbol identity.
 */
function componentFactoryLocalNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>([COMPONENT_FACTORY_NAME]);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (literalText(statement.moduleSpecifier) !== CORE_MODULE_SPECIFIER) continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        const importedName = element.propertyName
          ? moduleExportNameText(element.propertyName)
          : identifierName(element.name);
        if (importedName === COMPONENT_FACTORY_NAME) {
          names.add(identifierName(element.name));
        }
      }
    }
  }
  return names;
}

function identifierName(name: ts.Identifier): string {
  return String(name.escapedText);
}

function literalText(node: ts.StringLiteralLike): string {
  return node.text;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return identifierName(name);
  if (ts.isStringLiteralLike(name)) return literalText(name);
  return null;
}

function moduleExportNameText(name: ts.ModuleExportName): string {
  if (ts.isIdentifier(name)) return identifierName(name);
  return literalText(name);
}

function enclosingRenderProvenanceBindings(
  node: ts.Node,
  byRender: ReadonlyMap<ts.Node, RenderProvenanceBindings>,
): RenderProvenanceBindings {
  let cursor: ts.Node | undefined = node;
  while (cursor) {
    const bindings = byRender.get(cursor);
    if (bindings !== undefined) return bindings;
    cursor = cursor.parent;
  }
  return EMPTY_RENDER_BINDINGS;
}

const EMPTY_BINDINGS: ReadonlySet<string> = new Set<string>();
const EMPTY_QUERY_DATA_ROOTS: ReadonlyMap<string, ReadonlySet<string>> = new Map();
const EMPTY_RENDER_BINDINGS: RenderProvenanceBindings = {
  queryBindings: EMPTY_BINDINGS,
  queryDataRoots: EMPTY_QUERY_DATA_ROOTS,
  requestBindings: EMPTY_BINDINGS,
};

function trustedHtmlProvenanceDiagnostic(
  diagnostics: DiagnosticFactory,
  value: ts.Expression,
  provenance: Provenance,
): CompilerDiagnostic {
  const detail =
    `trustedHtml() brands ${provenance === 'request' ? 'request' : 'query'}-derived data without ` +
    'sanitization or an audited justification, so attacker-controlled bytes reach a raw-HTML sink.';
  return {
    ...diagnostics.at('KV426', { start: value.getStart(), length: value.getWidth() }, detail),
    help: [
      'Blocked reason: trustedHtml() is a pure brand that performs NO sanitization (SPEC §4.8); ' +
        'branding provably request- or query-derived data emits attacker-controlled bytes verbatim ' +
        'into a raw-HTML sink (stored/reflected XSS).',
      'Fixes: render user/CMS content through safeRichHtml(value) (the sanitizing rich-HTML floor, ' +
        'exported from @kovojs/browser and @kovojs/server); pass a server-computed safe value; or, ' +
        'for a value you assert is not request/query data, use the audited escape ' +
        'trustedHtml(value, "<justification>") so it is surfaced in kovo explain --trust.',
      'SPEC §9.1 (sink renderer), §5.2 #10 (output safety), §4.8 (trustedHtml); KV236/KV426 family. ' +
        'Provenance is decided by AST symbol-identity over the request/query source set, modeled on ' +
        'KV438 (SPEC §11.1).',
      diagnosticDefinitions.KV426.help,
    ].join('\n'),
  };
}
