import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import * as ts from 'typescript';

import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import {
  expressionResolvesToRenderedHtmlRawSink,
  expressionResolvesToTrustedHtmlPureBrand,
  expressionResolvesToTrustedUrlPureBrand,
} from '../output-context-facts.js';
import type { ComponentModuleModel } from '../scan/parse.js';

/**
 * SPEC §9.1 (sink renderer) / §5.2 #10 (output safety) / §4.8 (trustedHtml/trustedUrl escape
 * hatch), KV426 (KV236/KV426 family): `trustedHtml(x)` / `trustedUrl(x)` are PURE brands that
 * perform no sanitization, and `renderedHtml(x)` is the server-internal raw-HTML minting sink.
 * Branding or minting REQUEST-/QUERY-derived data is therefore a by-construction XSS / unsafe URL
 * sink. This gate ERRORS when the value is request/query-derived OR when the source cannot be
 * proven clean at this local AST layer.
 *
 * Provenance is decided by AST symbol-identity over the request/query source set (SPEC §6.6(1):
 * "classification is carried by AST symbol-identity provenance … never [a] text heuristic"; §5.2
 * rule 9: post-parse phases decide from typed facts, never raw source strings), modeled on the
 * KV438 mass-assignment write-provenance gate (SPEC §10.3/§11.1) and on KV437's client-capture gate
 * (its `publishToClient(value, { reason })` audited-escape shape is mirrored here).
 *
 * Bounded blast radius (technical-preview bias: the gate is unconditional, the escape is explicit
 * + audited). The gate flags:
 *   - a request root: the conventional mutation/form `input` identifier, or a `req`/`request`
 *     accessor chain only when that root is not shadowed by a local binding
 *     (`req.search`/`req.params`/`req.body`/`req.headers`/`req.cookies`/…);
 *   - a query root: a render binding destructured from the component's `queries` result;
 *   - those reached directly, via a field access (`question.body`), via taint-preserving local
 *     composition (`question.body ?? ''`, `` `${question.body}` ``), or via a same-scope
 *     alias/destructure/derive (`const { body } = question; trustedHtml(body)`).
 * Function calls, spreads, unbound identifiers, and unhandled expression forms are unprovable, not
 * clean. They fail closed unless the public trustedHtml/trustedUrl call carries an audited reason.
 *
 * Author escapes (audit-visible in `kovo explain --trust`, consistent with KV438's
 * serverValue/adminAssign):
 *   - render user/CMS content through `safeRichHtml(value)` — the sanitizing rich-HTML floor; it is
 *     a different callee, so it is never flagged here;
 *   - for a value the author asserts is safe, take the audited escape `trustedHtml(value,
 *     "<justification>")` / `trustedUrl(value, "<justification>")` (a non-empty static reason),
 *     which discharges the public trust-brand gate but stays recorded.
 */
export function validateTrustedHtmlProvenance(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const sourceFile = model.sourceFile;
  const bindingsByRender = renderProvenanceBindings(sourceFile);

  const found: CompilerDiagnostic[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const sink = rawTrustSinkForCall(sourceFile, node);
      const value = node.arguments[0];
      if (
        sink !== null &&
        value !== undefined &&
        !(sink.auditedReasonAllowed && hasAuditedReason(node))
      ) {
        const provenance = classifyExpression(value, {
          ...enclosingRenderProvenanceBindings(node, bindingsByRender),
          depth: 0,
          visited: new Set<ts.Node>(),
        });
        if (provenance !== null) {
          found.push(rawTrustProvenanceDiagnostic(diagnostics, value, provenance, sink));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

type Provenance = 'query' | 'request' | 'unprovable';

interface RawTrustSink {
  readonly auditedReasonAllowed: boolean;
  readonly label: 'renderedHtml' | 'trustedHtml' | 'trustedUrl';
  readonly rawSink: 'raw HTML' | 'trusted URL';
}

interface ClassifyContext {
  readonly queryBindings: ReadonlySet<string>;
  readonly queryDataRoots: ReadonlyMap<string, ReadonlySet<string>>;
  readonly requestBindings: ReadonlySet<string>;
  readonly requestSlotRoots: ReadonlySet<string>;
  readonly depth: number;
  readonly visited: Set<ts.Node>;
}

interface RenderProvenanceBindings {
  readonly queryBindings: ReadonlySet<string>;
  readonly queryDataRoots: ReadonlyMap<string, ReadonlySet<string>>;
  readonly requestBindings: ReadonlySet<string>;
  readonly requestSlotRoots: ReadonlySet<string>;
}

const MAX_ALIAS_DEPTH = 6;

/** Conventional request-derived root identifier (the mutation/form input object; KV438 source set). */
const REQUEST_INPUT_IDENTIFIER = 'input';
const AUDITED_REASON_PROPERTY = 'reason';
const COMPONENT_FACTORY_NAME = 'component';
const CORE_MODULE_SPECIFIER = '@kovojs/core';
const QUERIES_PROPERTY = 'queries';
const RENDER_PROPERTY = 'render';

function rawTrustSinkForCall(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): RawTrustSink | null {
  const direct = rawTrustSinkForExpression(sourceFile, call.expression);
  if (direct !== null) return direct;
  return wrapperHelperRawTrustSink(sourceFile, call);
}

function rawTrustSinkForExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): RawTrustSink | null {
  if (expressionResolvesToTrustedHtmlPureBrand(sourceFile, expression)) {
    return { auditedReasonAllowed: true, label: 'trustedHtml', rawSink: 'raw HTML' };
  }
  if (expressionResolvesToTrustedUrlPureBrand(sourceFile, expression)) {
    return { auditedReasonAllowed: true, label: 'trustedUrl', rawSink: 'trusted URL' };
  }
  if (expressionResolvesToRenderedHtmlRawSink(sourceFile, expression)) {
    return { auditedReasonAllowed: false, label: 'renderedHtml', rawSink: 'raw HTML' };
  }
  return null;
}

/**
 * Same-file wrapper-helper recognition for KV426's pure brand sink. This is intentionally narrower
 * than TypeScript type inference: it follows AST symbol identity to a local helper whose body
 * directly calls the real `trustedHtml(param)` / `trustedUrl(param)` pure brand or internal
 * `renderedHtml(param)` sink. The call-site argument still owns
 * request/query provenance per SPEC §6.6; the helper return type or brand annotation is not proof.
 */
function wrapperHelperRawTrustSink(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): RawTrustSink | null {
  const callee = unwrap(call.expression);
  if (!ts.isIdentifier(callee)) return null;
  const declaration = localCallableDeclaration(callee, callee.text);
  if (declaration === undefined) return null;

  const body =
    ts.isVariableDeclaration(declaration) && declaration.initializer
      ? callableBody(declaration.initializer)
      : ts.isFunctionDeclaration(declaration)
        ? declaration.body
        : undefined;
  if (body === undefined) return null;

  const parameterName = callableFirstParameterName(declaration);
  if (parameterName === undefined) return null;

  const trustedCall = directReturnExpression(body);
  if (trustedCall === undefined || !ts.isCallExpression(trustedCall)) return null;
  const sink = rawTrustSinkForExpression(sourceFile, trustedCall.expression);
  if (sink === null) return null;

  const brandedValue = trustedCall.arguments[0];
  if (brandedValue === undefined || ts.isSpreadElement(brandedValue)) return null;
  const unwrappedValue = unwrap(brandedValue);
  return ts.isIdentifier(unwrappedValue) && unwrappedValue.text === parameterName ? sink : null;
}

/**
 * Classify an expression's data provenance from typed AST facts. Returns `'request'`/`'query'` when
 * the value is request/query-derived, `'unprovable'` when this local analysis cannot prove the value
 * clean, or `null` only for values proven local/static-clean.
 */
function classifyExpression(
  node: ts.Expression | ts.SpreadElement,
  ctx: ClassifyContext,
): Provenance | null {
  if (ts.isSpreadElement(node)) return classifyExpression(node.expression, ctx) ?? 'unprovable';
  const expr = unwrap(node);

  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
    return classifyMemberRoot(expr, ctx);
  }
  if (ts.isIdentifier(expr)) {
    return classifyIdentifier(expr, ctx);
  }
  if (ts.isConditionalExpression(expr)) {
    return firstProvenance([
      classifyExpression(expr.condition, { ...ctx, visited: new Set(ctx.visited) }),
      classifyExpression(expr.whenTrue, { ...ctx, visited: new Set(ctx.visited) }),
      classifyExpression(expr.whenFalse, { ...ctx, visited: new Set(ctx.visited) }),
    ]);
  }
  if (ts.isBinaryExpression(expr)) {
    return firstProvenance([
      classifyExpression(expr.left, { ...ctx, visited: new Set(ctx.visited) }),
      classifyExpression(expr.right, { ...ctx, visited: new Set(ctx.visited) }),
    ]);
  }
  if (ts.isTemplateExpression(expr)) {
    return firstProvenance(
      expr.templateSpans.map((span) =>
        classifyExpression(span.expression, { ...ctx, visited: new Set(ctx.visited) }),
      ),
    );
  }
  if (ts.isCallExpression(expr) || ts.isNewExpression(expr)) {
    const argumentProvenance = firstProvenance(
      [...(expr.arguments ?? [])].map((arg) =>
        classifyExpression(arg, { ...ctx, visited: new Set(ctx.visited) }),
      ),
    );
    const calleeProvenance = classifyExpression(expr.expression, {
      ...ctx,
      visited: new Set(ctx.visited),
    });
    return firstProvenance([argumentProvenance, calleeProvenance]) ?? 'unprovable';
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return firstProvenance(
      expr.elements.map((element) =>
        classifyExpression(element, { ...ctx, visited: new Set(ctx.visited) }),
      ),
    );
  }
  if (ts.isObjectLiteralExpression(expr)) {
    return firstProvenance(
      expr.properties.map((property) => classifyObjectLiteralProperty(property, ctx)),
    );
  }
  if (ts.isPrefixUnaryExpression(expr) || ts.isPostfixUnaryExpression(expr)) {
    return classifyExpression(expr.operand, ctx);
  }
  if (ts.isNoSubstitutionTemplateLiteral(expr) || isStaticLiteral(expr)) return null;
  if (expr.kind === ts.SyntaxKind.NullKeyword || expr.kind === ts.SyntaxKind.UndefinedKeyword) {
    return null;
  }
  return 'unprovable';
}

function classifyObjectLiteralProperty(
  property: ts.ObjectLiteralElementLike,
  ctx: ClassifyContext,
): Provenance | null {
  if (ts.isSpreadAssignment(property)) {
    return (
      classifyExpression(property.expression, { ...ctx, visited: new Set(ctx.visited) }) ??
      'unprovable'
    );
  }
  if (ts.isPropertyAssignment(property)) {
    return classifyExpression(property.initializer, { ...ctx, visited: new Set(ctx.visited) });
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    return classifyIdentifier(property.name, { ...ctx, visited: new Set(ctx.visited) });
  }
  return 'unprovable';
}

function firstProvenance(values: readonly (Provenance | null)[]): Provenance | null {
  let unprovable = false;
  for (const value of values) {
    if (value === 'query' || value === 'request') return value;
    if (value === 'unprovable') unprovable = true;
  }
  return unprovable ? 'unprovable' : null;
}

function isStaticLiteral(expr: ts.Expression): boolean {
  return (
    ts.isStringLiteralLike(expr) ||
    ts.isNumericLiteral(expr) ||
    expr.kind === ts.SyntaxKind.BigIntLiteral ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.TrueKeyword
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
    // The component render request reaches authored code only as the `request` slot on the third
    // render parameter. Track that parameter by position, then require its `request` property by
    // symbol/AST shape; a random in-scope value named `request` is not proof of request provenance.
    if (ctx.requestBindings.has(cursor.text)) return 'request';
    if (ctx.requestSlotRoots.has(cursor.text) && firstMember === 'request') {
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
  if (id.text === 'undefined' || id.text === 'NaN' || id.text === 'Infinity') return null;
  return hasLocalBinding(id, id.text) ? 'unprovable' : 'unprovable';
}

/**
 * The initializer of the nearest enclosing `const <name> = <init>` or
 * `const { <name> } = <init>` visible at `node`, if any.
 */
function localConstInitializer(node: ts.Node, name: string): ts.Expression | undefined {
  return localBinding(node, name)?.initializer;
}

function hasLocalBinding(node: ts.Node, name: string): boolean {
  return localBinding(node, name) !== undefined;
}

function localBinding(
  node: ts.Node,
  name: string,
): { readonly initializer?: ts.Expression } | undefined {
  const sourceFile = node.getSourceFile();
  const position = node.getStart(sourceFile);
  let cursor: ts.Node | undefined = node.parent;
  while (cursor) {
    if (isFunctionLikeWithParameters(cursor) && cursor.getStart(sourceFile) < position) {
      if (cursor.parameters.some((parameter) => bindingNameBinds(parameter.name, name))) {
        return {};
      }
    }
    if (ts.isBlock(cursor) || ts.isSourceFile(cursor)) {
      for (const statement of cursor.statements) {
        if (statement.getStart(sourceFile) >= position) continue;
        if (!ts.isVariableStatement(statement)) {
          if (statementBindsName(statement, name)) return {};
          continue;
        }
        for (const declaration of statement.declarationList.declarations) {
          if (declaration.getStart(sourceFile) >= position) continue;
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === name &&
            declaration.initializer &&
            isConstVariableDeclaration(declaration)
          ) {
            return { initializer: declaration.initializer };
          }
          if (
            ts.isObjectBindingPattern(declaration.name) &&
            declaration.initializer &&
            objectBindingPatternBindsName(declaration.name, name) &&
            isConstVariableDeclaration(declaration)
          ) {
            return { initializer: declaration.initializer };
          }
          if (bindingNameBinds(declaration.name, name)) return {};
        }
      }
    }
    cursor = cursor.parent;
  }
  return undefined;
}

function statementBindsName(statement: ts.Statement, name: string): boolean {
  if (ts.isImportDeclaration(statement)) return importDeclarationBindsName(statement, name);
  if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return true;
  if (ts.isClassDeclaration(statement) && statement.name?.text === name) return true;
  return false;
}

function importDeclarationBindsName(statement: ts.ImportDeclaration, name: string): boolean {
  const clause = statement.importClause;
  if (!clause) return false;
  if (clause.name?.text === name) return true;
  const bindings = clause.namedBindings;
  if (!bindings) return false;
  if (ts.isNamespaceImport(bindings)) return bindings.name.text === name;
  if (!ts.isNamedImports(bindings)) return false;
  return bindings.elements.some((element) => element.name.text === name);
}

function isConstVariableDeclaration(node: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableDeclarationList(node.parent) &&
    (node.parent.flags & ts.NodeFlags.Const) === ts.NodeFlags.Const
  );
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
    if (
      (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) &&
      bindingNameBinds(element.name, name)
    ) {
      return true;
    }
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
  const requestSlotRoots = new Set<string>();

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

  collectRenderRequestBindings(render.parameters[2], requestBindings, requestSlotRoots);

  if (
    bindings.size > 0 ||
    queryDataRoots.size > 0 ||
    requestBindings.size > 0 ||
    requestSlotRoots.size > 0
  ) {
    byRender.set(render, {
      queryBindings: bindings,
      queryDataRoots,
      requestBindings,
      requestSlotRoots,
    });
  }
}

function collectRenderRequestBindings(
  slotsParam: ts.ParameterDeclaration | undefined,
  bindings: Set<string>,
  slotRoots: Set<string>,
): void {
  if (slotsParam === undefined) return;
  if (ts.isIdentifier(slotsParam.name)) {
    slotRoots.add(slotsParam.name.text);
    return;
  }
  if (!ts.isObjectBindingPattern(slotsParam.name)) return;

  for (const element of slotsParam.name.elements) {
    const sourceName =
      element.propertyName !== undefined
        ? propertyNameText(element.propertyName)
        : ts.isIdentifier(element.name)
          ? identifierName(element.name)
          : null;
    if (sourceName !== 'request') continue;

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
  requestSlotRoots: EMPTY_BINDINGS,
};

function rawTrustProvenanceDiagnostic(
  diagnostics: DiagnosticFactory,
  value: ts.Expression | ts.SpreadElement,
  provenance: Provenance,
  sink: RawTrustSink,
): CompilerDiagnostic {
  const source =
    provenance === 'unprovable'
      ? 'data whose provenance cannot be proven locally'
      : `${provenance}-derived data`;
  const detail =
    `${sink.label}() sends ${source} to a ${sink.rawSink} sink without sanitization or an audited ` +
    'justification.';
  const publicFix = sink.auditedReasonAllowed
    ? `or, for a value you assert is not request/query data, use the audited escape ${sink.label}(value, "<justification>") so it is surfaced in kovo explain --trust.`
    : 'or route the value through a public trustedHtml()/safeRichHtml() boundary with an audited reason before it reaches the internal renderedHtml sink.';
  return {
    ...diagnostics.at('KV426', { start: value.getStart(), length: value.getWidth() }, detail),
    help: [
      `Blocked reason: ${sink.label}() is a pure ${sink.rawSink} escape that performs NO sanitization ` +
        '(SPEC §4.8); sending request/query-derived or unprovable data to it can emit ' +
        'attacker-controlled bytes verbatim.',
      'Fixes: render user/CMS content through safeRichHtml(value) (the sanitizing rich-HTML floor, ' +
        `exported from @kovojs/browser and @kovojs/server); pass a server-computed safe value; ${publicFix}`,
      `SPEC §9.1 (sink renderer), §5.2 #10 (output safety), §4.8 (${sink.label}); KV236/KV426 family. ` +
        'Provenance is decided by AST symbol-identity over the request/query source set, modeled on ' +
        'KV438 (SPEC §11.1).',
      diagnosticDefinitions.KV426.help,
    ].join('\n'),
  };
}
