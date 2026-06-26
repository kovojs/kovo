import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import * as ts from 'typescript';

import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
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
 *   - those reached directly, via a field access (`question.body`), or via a same-scope
 *     alias/derive (`const body = question.body; trustedHtml(body)`).
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
  const trustedHtmlNames = trustedHtmlPureBrandLocalNames(model);
  if (trustedHtmlNames.size === 0) return [];

  const sourceFile = model.sourceFile;
  const queryBindingsByRender = renderQueryBindings(sourceFile);

  const found: CompilerDiagnostic[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      trustedHtmlNames.has(node.expression.text) &&
      node.arguments.length > 0
    ) {
      const value = node.arguments[0];
      if (value !== undefined && !ts.isSpreadElement(value) && !hasAuditedReason(node)) {
        const provenance = classifyExpression(value, {
          queryBindings: enclosingRenderQueryBindings(node, queryBindingsByRender),
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

/**
 * Local names bound to the REAL `trustedHtml` export of `@kovojs/browser` — resolved by import
 * symbol identity, NOT by source-text name (SPEC §6.6(1) / §5.2 rule 9). `safeRichHtml` is the
 * sanitizing primitive and is intentionally excluded: it is safe on tainted input, so it must stay
 * clean. A shadowing local `const trustedHtml = …` or a same-named import from another module is
 * therefore not a brand here (fail-closed); an aliased import (`import { trustedHtml as th }`) is.
 */
function trustedHtmlPureBrandLocalNames(model: ComponentModuleModel): ReadonlySet<string> {
  const names = new Set<string>();
  for (const imported of model.namedImports) {
    if (imported.moduleSpecifier === '@kovojs/browser' && imported.importedName === 'trustedHtml') {
      names.add(imported.localName);
    }
  }
  return names;
}

type Provenance = 'request' | 'query';

interface ClassifyContext {
  readonly queryBindings: ReadonlySet<string>;
  readonly depth: number;
  readonly visited: Set<ts.Node>;
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
  // Function-call results, literals, binary/template concatenations, etc. are opaque: the gate does
  // not invent inter-procedural taint (documented residue), and a literal/concatenation carries no
  // proven request/query root.
  return null;
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
      cursor = cursor.expression;
    } else {
      cursor = cursor.expression;
    }
  }

  if (ts.isIdentifier(cursor)) {
    // `req.params.id` / `request.body.html`: request-derived when the root is an unshadowed request
    // accessor and the first member is a request channel.
    if (
      REQUEST_ACCESSOR_ROOTS.has(cursor.text) &&
      firstMember !== undefined &&
      REQUEST_ACCESSORS.has(firstMember) &&
      localConstInitializer(cursor, cursor.text) === undefined
    ) {
      return 'request';
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
  if (id.text === REQUEST_INPUT_IDENTIFIER) return 'request';
  return null;
}

/** The initializer of the nearest enclosing `const <name> = <init>` visible at `node`, if any. */
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
        }
      }
    }
    cursor = cursor.parent;
  }
  return undefined;
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
        property.name.text === 'reason' &&
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
function renderQueryBindings(sourceFile: ts.SourceFile): Map<ts.Node, ReadonlySet<string>> {
  const byRender = new Map<ts.Node, ReadonlySet<string>>();
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
      collectRenderQueryBindings(node.arguments[0] as ts.ObjectLiteralExpression, byRender);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return byRender;
}

function collectRenderQueryBindings(
  options: ts.ObjectLiteralExpression,
  byRender: Map<ts.Node, ReadonlySet<string>>,
): void {
  const queryKeys = new Set<string>();
  let render: ts.FunctionExpression | ts.ArrowFunction | undefined;

  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
    if (property.name.text === 'queries' && ts.isObjectLiteralExpression(property.initializer)) {
      for (const entry of property.initializer.properties) {
        const key = entry.name;
        if (key && (ts.isIdentifier(key) || ts.isStringLiteralLike(key))) queryKeys.add(key.text);
      }
    }
    if (
      property.name.text === 'render' &&
      (ts.isArrowFunction(property.initializer) || ts.isFunctionExpression(property.initializer))
    ) {
      render = property.initializer;
    }
  }

  if (render === undefined || queryKeys.size === 0) return;
  const dataParam = render.parameters[0];
  if (dataParam === undefined || !ts.isObjectBindingPattern(dataParam.name)) {
    // Non-destructured render data param: query-binding detection is residue (documented).
    return;
  }

  const bindings = new Set<string>();
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
  if (bindings.size > 0) byRender.set(render, bindings);
}

/**
 * Local names bound to the `component` factory. The Kovo authoring DSL identifies a component by the
 * `component(...)` call name (the scanner builds `model.components` from bare `component(...)`
 * without requiring an import; SPEC §4.1/§5.2), so the canonical name is always recognized; any
 * `@kovojs/core` alias (`import { component as c }`) is additionally resolved by symbol identity.
 */
function componentFactoryLocalNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>(['component']);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== '@kovojs/core') continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if ((element.propertyName?.text ?? element.name.text) === 'component') {
          names.add(element.name.text);
        }
      }
    }
  }
  return names;
}

function enclosingRenderQueryBindings(
  node: ts.Node,
  byRender: ReadonlyMap<ts.Node, ReadonlySet<string>>,
): ReadonlySet<string> {
  let cursor: ts.Node | undefined = node;
  while (cursor) {
    const bindings = byRender.get(cursor);
    if (bindings !== undefined) return bindings;
    cursor = cursor.parent;
  }
  return EMPTY_BINDINGS;
}

const EMPTY_BINDINGS: ReadonlySet<string> = new Set<string>();

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
