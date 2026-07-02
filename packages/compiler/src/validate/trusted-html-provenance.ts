import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import {
  PROVEN_SAFE,
  type ClassifierVerdict,
  provenUnsafe,
  unproven,
} from '@kovojs/core/internal/classifier-verdict';
import { securityClassifier } from '@kovojs/core/internal/security-markers';
import * as ts from 'typescript';

import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import {
  expressionResolvesToTrustedHtmlBrand,
  expressionResolvesToRenderedHtmlRawSink,
  expressionResolvesToTrustedHtmlPureBrand,
  expressionResolvesToTrustedUrlPureBrand,
  isUrlAttribute,
} from '../output-context-facts.js';
import { propertyNameText } from '../scan/ast.js';
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
 *   - a request root: the `request` slot on the third render parameter, resolved by parameter
 *     position and binding shape rather than a fragile local name;
 *   - a query root: a render binding destructured from the component's `queries` result;
 *   - those reached directly, via a field access (`question.body`), via taint-preserving local
 *     composition (`question.body ?? ''`, `` `${question.body}` ``), or via a same-scope
 *     alias/destructure/derive (`const { body } = question; trustedHtml(body)`).
 * Function calls, spreads, unbound identifiers, and unhandled expression forms are unprovable, not
 * clean. They fail closed unless the public trustedHtml/trustedUrl call carries an audited reason.
 * Non-literal namespace calls through Kovo trust modules (`browser[key](value)`) are also treated
 * as unproven trust sinks when the member cannot be resolved to a safe non-sink export.
 *
 * Author escapes (audit-visible in `kovo explain --trust`, consistent with KV438's
 * serverValue/adminAssign):
 *   - render user/CMS content through `safeRichHtml(value)` — the sanitizing rich-HTML floor; it is
 *     a different callee, so it is never flagged here;
 *   - for a value the author asserts is safe, take the audited escape `trustedHtml(value,
 *     "<justification>")` / `trustedUrl(value, "<justification>")` (a non-empty static reason),
 *     which discharges the public trust-brand gate but stays recorded.
 */
export const validateTrustedHtmlProvenance = securityClassifier(
  'compiler.trusted-html.validate-provenance',
  function (diagnostics: DiagnosticFactory, model: ComponentModuleModel): CompilerDiagnostic[] {
    const sourceFile = model.sourceFile;
    const bindingsByRender = renderProvenanceBindings(sourceFile);

    const found: CompilerDiagnostic[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const sink = rawTrustSinkForCall(sourceFile, node);
        const value = node.arguments[0];
        if (sink === null) {
          // Not a raw/trusted sink call; ordinary calls are outside KV426.
        } else if (value !== undefined && !(sink.auditedReasonAllowed && hasAuditedReason(node))) {
          const provenance = classifyExpression(value, {
            ...enclosingRenderProvenanceBindings(node, bindingsByRender),
            depth: 0,
            trustedTypeNames: trustedTypeLocalNames(sourceFile),
            visited: new Set<ts.Node>(),
          });
          if (provenance === null) {
            // Proven local/static-clean value.
          } else {
            found.push(rawTrustProvenanceDiagnostic(diagnostics, value, provenance, sink));
          }
        }
      }
      if (ts.isJsxAttribute(node)) {
        found.push(
          ...validateJsxAttributeTrustedProvenance(diagnostics, sourceFile, node, bindingsByRender),
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
  },
);

type Provenance = 'query' | 'request' | 'unprovable';
type TrustedSinkVerdict = ClassifierVerdict<Provenance>;
type TrustedSinkExpectedBrand = 'trustedHtml' | 'trustedUrl';

interface TrustedTypeLocalNames {
  readonly trustedHtml: ReadonlySet<string>;
  readonly trustedUrl: ReadonlySet<string>;
}

interface RawTrustSink {
  readonly auditedReasonAllowed: boolean;
  readonly expectedBrand: TrustedSinkExpectedBrand;
  readonly label:
    | 'dangerouslySetInnerHTML'
    | 'html'
    | 'innerHTML'
    | 'renderedHtml'
    | 'trustedHtml'
    | 'trustedUrl'
    | 'rawHtml';
  readonly rawSink: 'raw HTML' | 'trusted URL';
  readonly syntax: 'call' | 'value';
}

interface ClassifyContext {
  readonly queryBindings: ReadonlySet<string>;
  readonly queryDataRoots: ReadonlyMap<string, ReadonlySet<string>>;
  readonly render: RenderFunction | undefined;
  readonly requestBindings: ReadonlySet<string>;
  readonly requestSlotRoots: ReadonlySet<string>;
  readonly depth: number;
  readonly trustedTypeNames: TrustedTypeLocalNames;
  readonly visited: Set<ts.Node>;
}

interface RenderProvenanceBindings {
  readonly queryBindings: ReadonlySet<string>;
  readonly queryDataRoots: ReadonlyMap<string, ReadonlySet<string>>;
  readonly render: RenderFunction | undefined;
  readonly requestBindings: ReadonlySet<string>;
  readonly requestSlotRoots: ReadonlySet<string>;
}

type RenderFunction = ts.ArrowFunction | ts.FunctionExpression;

const MAX_ALIAS_DEPTH = 6;

const AUDITED_REASON_PROPERTY = 'reason';
const COMPONENT_FACTORY_NAME = 'component';
const CORE_MODULE_SPECIFIER = '@kovojs/core';
const QUERIES_PROPERTY = 'queries';
const RENDER_PROPERTY = 'render';
const BROWSER_MODULE_SPECIFIER = '@kovojs/browser';
const SERVER_MODULE_SPECIFIER = '@kovojs/server';
const SERVER_INTERNAL_HTML_MODULE_SPECIFIER = '@kovojs/server/internal/html';
const TRUSTED_HTML_TYPE_EXPORT = 'TrustedHtml';
const TRUSTED_URL_TYPE_EXPORT = 'TrustedUrl';

const rawTrustSinkForCall = securityClassifier(
  'compiler.trusted-html.raw-trust-call',
  function (sourceFile: ts.SourceFile, call: ts.CallExpression): RawTrustSink | null {
    const direct = rawTrustSinkForExpression(sourceFile, call.expression);
    if (direct !== null) return direct;
    return wrapperHelperRawTrustSink(sourceFile, call);
  },
);

const rawTrustSinkForExpression = securityClassifier(
  'compiler.trusted-html.raw-trust-expression',
  function (sourceFile: ts.SourceFile, expression: ts.Expression): RawTrustSink | null {
    if (expressionResolvesToTrustedHtmlPureBrand(sourceFile, expression)) {
      return {
        auditedReasonAllowed: true,
        expectedBrand: 'trustedHtml',
        label: 'trustedHtml',
        rawSink: 'raw HTML',
        syntax: 'call',
      };
    }
    if (expressionResolvesToTrustedUrlPureBrand(sourceFile, expression)) {
      return {
        auditedReasonAllowed: true,
        expectedBrand: 'trustedUrl',
        label: 'trustedUrl',
        rawSink: 'trusted URL',
        syntax: 'call',
      };
    }
    if (expressionResolvesToRenderedHtmlRawSink(sourceFile, expression)) {
      return {
        auditedReasonAllowed: false,
        expectedBrand: 'trustedHtml',
        label: 'renderedHtml',
        rawSink: 'raw HTML',
        syntax: 'call',
      };
    }
    return dynamicNamespaceRawTrustSink(sourceFile, expression);
  },
);

function validateJsxAttributeTrustedProvenance(
  diagnostics: DiagnosticFactory,
  sourceFile: ts.SourceFile,
  attribute: ts.JsxAttribute,
  bindingsByRender: ReadonlyMap<ts.Node, RenderProvenanceBindings>,
): CompilerDiagnostic[] {
  const target = rawTrustSinkForJsxAttribute(sourceFile, attribute);
  const value = jsxAttributeExpression(attribute);
  if (target === null || value === undefined) return [];

  const bindings = enclosingRenderProvenanceBindings(attribute, bindingsByRender);
  const verdict = classifyTrustedSinkValue(sourceFile, value, target, {
    ...bindings,
    depth: 0,
    trustedTypeNames: trustedTypeLocalNames(sourceFile),
    visited: new Set<ts.Node>(),
  });
  if (verdict.kind === 'proven-safe') return [];
  const provenance = verdict.kind === 'proven-unsafe' ? verdict.detail : 'unprovable';
  return [rawTrustProvenanceDiagnostic(diagnostics, value, provenance, target)];
}

type TrustNamespaceModule =
  | typeof BROWSER_MODULE_SPECIFIER
  | typeof SERVER_MODULE_SPECIFIER
  | typeof SERVER_INTERNAL_HTML_MODULE_SPECIFIER;

function dynamicNamespaceRawTrustSink(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): RawTrustSink | null {
  const expr = unwrap(expression);
  if (!ts.isElementAccessExpression(expr)) return null;
  if (elementAccessName(expr.argumentExpression) !== null) return null;

  const namespace = unwrap(expr.expression);
  if (!ts.isIdentifier(namespace)) return null;
  const moduleSpecifier = trustNamespaceImportModule(sourceFile, namespace);
  if (moduleSpecifier === null) return null;

  const member = staticStringValue(expr.argumentExpression);
  if (member !== null) return trustNamespaceMemberSink(moduleSpecifier, member);
  return unknownTrustNamespaceMemberSink(moduleSpecifier);
}

function trustNamespaceMemberSink(
  moduleSpecifier: TrustNamespaceModule,
  member: string,
): RawTrustSink | null {
  if (
    (moduleSpecifier === BROWSER_MODULE_SPECIFIER || moduleSpecifier === SERVER_MODULE_SPECIFIER) &&
    member === 'trustedHtml'
  ) {
    return {
      auditedReasonAllowed: true,
      expectedBrand: 'trustedHtml',
      label: 'trustedHtml',
      rawSink: 'raw HTML',
      syntax: 'call',
    };
  }
  if (
    (moduleSpecifier === BROWSER_MODULE_SPECIFIER || moduleSpecifier === SERVER_MODULE_SPECIFIER) &&
    member === 'trustedUrl'
  ) {
    return {
      auditedReasonAllowed: true,
      expectedBrand: 'trustedUrl',
      label: 'trustedUrl',
      rawSink: 'trusted URL',
      syntax: 'call',
    };
  }
  if (
    (moduleSpecifier === SERVER_MODULE_SPECIFIER ||
      moduleSpecifier === SERVER_INTERNAL_HTML_MODULE_SPECIFIER) &&
    member === 'renderedHtml'
  ) {
    return {
      auditedReasonAllowed: false,
      expectedBrand: 'trustedHtml',
      label: 'renderedHtml',
      rawSink: 'raw HTML',
      syntax: 'call',
    };
  }
  return null;
}

function unknownTrustNamespaceMemberSink(moduleSpecifier: TrustNamespaceModule): RawTrustSink {
  if (moduleSpecifier === SERVER_INTERNAL_HTML_MODULE_SPECIFIER) {
    return {
      auditedReasonAllowed: false,
      expectedBrand: 'trustedHtml',
      label: 'renderedHtml',
      rawSink: 'raw HTML',
      syntax: 'call',
    };
  }
  return {
    auditedReasonAllowed: true,
    expectedBrand: 'trustedHtml',
    label: 'trustedHtml',
    rawSink: 'raw HTML',
    syntax: 'call',
  };
}

function trustNamespaceImportModule(
  sourceFile: ts.SourceFile,
  namespace: ts.Identifier,
): TrustNamespaceModule | null {
  const name = identifierName(namespace);
  let moduleSpecifier: TrustNamespaceModule | null = null;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const candidate = trustNamespaceModule(literalText(statement.moduleSpecifier));
    if (candidate === null) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings) && bindings.name.text === name) {
      moduleSpecifier = candidate;
    }
  }
  if (moduleSpecifier === null) return null;
  return namespaceImportIsShadowed(namespace, name) ? null : moduleSpecifier;
}

function trustNamespaceModule(specifier: string): TrustNamespaceModule | null {
  if (
    specifier === BROWSER_MODULE_SPECIFIER ||
    specifier === SERVER_MODULE_SPECIFIER ||
    specifier === SERVER_INTERNAL_HTML_MODULE_SPECIFIER
  ) {
    return specifier;
  }
  return null;
}

function namespaceImportIsShadowed(node: ts.Node, name: string): boolean {
  const sourceFile = node.getSourceFile();
  const position = node.getStart(sourceFile);
  let cursor: ts.Node | undefined = node.parent;
  while (cursor) {
    if (isFunctionLikeWithParameters(cursor) && cursor.getStart(sourceFile) < position) {
      if (cursor.parameters.some((parameter) => bindingNameBinds(parameter.name, name))) {
        return true;
      }
    }
    if (ts.isBlock(cursor) || ts.isModuleBlock(cursor) || ts.isSourceFile(cursor)) {
      for (const statement of cursor.statements) {
        if (statement.getStart(sourceFile) >= position) continue;
        if (ts.isImportDeclaration(statement)) continue;
        if (statementBindsName(statement, name)) return true;
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (
              declaration.getStart(sourceFile) < position &&
              bindingNameBinds(declaration.name, name)
            ) {
              return true;
            }
          }
        }
      }
    }
    cursor = cursor.parent;
  }
  return false;
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

function rawTrustSinkForJsxAttribute(
  sourceFile: ts.SourceFile,
  attribute: ts.JsxAttribute,
): RawTrustSink | null {
  const name = jsxAttributeName(attribute);
  if (name === null) return null;
  const value = jsxAttributeExpression(attribute);
  if (value !== undefined) {
    const directCall = unwrap(value);
    if (ts.isCallExpression(directCall) && rawTrustSinkForCall(sourceFile, directCall) !== null) {
      return null;
    }
  }
  if (isRawHtmlAttributeName(name)) {
    return {
      auditedReasonAllowed: true,
      expectedBrand: 'trustedHtml',
      label: name,
      rawSink: 'raw HTML',
      syntax: 'value',
    };
  }
  if (!isUrlAttribute(name)) return null;
  if (value === undefined || !mayBeTrustedUrlSinkValue(sourceFile, value)) return null;
  return {
    auditedReasonAllowed: true,
    expectedBrand: 'trustedUrl',
    label: 'trustedUrl',
    rawSink: 'trusted URL',
    syntax: 'value',
  };
}

function classifyTrustedSinkValue(
  sourceFile: ts.SourceFile,
  node: ts.Expression,
  sink: RawTrustSink,
  ctx: ClassifyContext,
): TrustedSinkVerdict {
  const expr = unwrap(node);
  if (ts.isCallExpression(expr)) {
    const callSink = rawTrustSinkForCall(sourceFile, expr);
    if (callSink !== null && callSink.expectedBrand === sink.expectedBrand) {
      if (callSink.auditedReasonAllowed && hasAuditedReason(expr)) return PROVEN_SAFE;
      const value = expr.arguments[0];
      if (value === undefined) return unproven(`${callSink.label}() has no value argument`);
      const provenance = classifyExpression(value, {
        ...ctx,
        depth: ctx.depth + 1,
        visited: new Set(ctx.visited),
      });
      return provenance === null ? PROVEN_SAFE : provenUnsafe(provenance);
    }
    if (
      sink.expectedBrand === 'trustedHtml' &&
      expressionResolvesToTrustedHtmlBrand(sourceFile, expr.expression)
    ) {
      return PROVEN_SAFE;
    }
    return unproven('trusted sink value is produced by an unresolved call');
  }

  if (ts.isIdentifier(expr)) {
    const local = localBinding(expr, identifierName(expr));
    if (local?.initializer !== undefined && ctx.depth < MAX_ALIAS_DEPTH) {
      return classifyTrustedSinkValue(sourceFile, local.initializer, sink, {
        ...ctx,
        depth: ctx.depth + 1,
        visited: new Set(ctx.visited),
      });
    }
    if (local?.binding !== undefined && bindingHasTrustedType(local.binding, sink, ctx)) {
      return unproven(`untraceable ${sink.expectedBrand} typed value reaches ${sink.label}`);
    }
    if (sink.expectedBrand === 'trustedHtml') {
      return unproven(`untraceable raw HTML value reaches ${sink.label}`);
    }
    return PROVEN_SAFE;
  }

  if (expressionHasTrustedType(node, sink, ctx)) {
    return unproven(`untraceable ${sink.expectedBrand} typed expression reaches ${sink.label}`);
  }
  if (sink.expectedBrand === 'trustedHtml') {
    return unproven(`untraceable raw HTML expression reaches ${sink.label}`);
  }
  return PROVEN_SAFE;
}

function mayBeTrustedUrlSinkValue(
  sourceFile: ts.SourceFile,
  node: ts.Expression,
  visited = new Set<ts.Node>(),
): boolean {
  const expr = unwrap(node);
  if (ts.isCallExpression(expr)) {
    return rawTrustSinkForCall(sourceFile, expr)?.expectedBrand === 'trustedUrl';
  }
  if (expressionHasTrustedUrlType(sourceFile, node)) return true;
  if (!ts.isIdentifier(expr)) return false;
  const local = localBinding(expr, identifierName(expr));
  if (local === undefined) return false;
  if (bindingHasTrustedUrlType(sourceFile, local.binding)) return true;
  if (local.initializer === undefined || visited.has(local.initializer)) return false;
  visited.add(local.initializer);
  return mayBeTrustedUrlSinkValue(sourceFile, local.initializer, visited);
}

/**
 * Classify an expression's data provenance from typed AST facts. Returns `'request'`/`'query'` when
 * the value is request/query-derived, `'unprovable'` when this local analysis cannot prove the value
 * clean, or `null` only for values proven local/static-clean.
 */
const classifyExpression = securityClassifier(
  'compiler.trusted-html.classify-expression',
  function (node: ts.Expression | ts.SpreadElement, ctx: ClassifyContext): Provenance | null {
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
  },
);

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
    const keyProvenance = computedPropertyNameProvenance(property.name, ctx);
    const valueProvenance = classifyExpression(property.initializer, {
      ...ctx,
      visited: new Set(ctx.visited),
    });
    return firstProvenance([keyProvenance, valueProvenance]);
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

function computedPropertyNameProvenance(
  name: ts.PropertyName,
  ctx: ClassifyContext,
): Provenance | null {
  if (!ts.isComputedPropertyName(name)) return null;
  return classifyExpression(name.expression, { ...ctx, visited: new Set(ctx.visited) });
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
    const localRoot = localBinding(cursor, cursor.text);
    if (localRoot !== undefined && !bindingIsRenderParameter(localRoot.binding, ctx.render)) {
      if (localRoot.initializer !== undefined && ctx.depth < MAX_ALIAS_DEPTH) {
        return classifyExpression(localRoot.initializer, { ...ctx, depth: ctx.depth + 1 });
      }
      return 'unprovable';
    }
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
  const local = localBinding(id, id.text);
  if (local !== undefined && !bindingIsRenderParameter(local.binding, ctx.render)) {
    if (
      local.initializer !== undefined &&
      ctx.depth < MAX_ALIAS_DEPTH &&
      !ctx.visited.has(local.initializer)
    ) {
      ctx.visited.add(local.initializer);
      return classifyExpression(local.initializer, { ...ctx, depth: ctx.depth + 1 });
    }
    return 'unprovable';
  }

  if (ctx.queryBindings.has(id.text)) return 'query';
  if (ctx.queryDataRoots.has(id.text)) return 'query';
  if (ctx.requestBindings.has(id.text)) return 'request';
  return 'unprovable';
}

/**
 * The initializer of the nearest enclosing `const <name> = <init>` or
 * `const { <name> } = <init>` visible at `node`, if any.
 */
function localConstInitializer(node: ts.Node, name: string): ts.Expression | undefined {
  return localBinding(node, name)?.initializer;
}

function localBinding(
  node: ts.Node,
  name: string,
): { readonly binding: ts.Node; readonly initializer?: ts.Expression } | undefined {
  const sourceFile = node.getSourceFile();
  const position = node.getStart(sourceFile);
  let cursor: ts.Node | undefined = node.parent;
  while (cursor) {
    if (isFunctionLikeWithParameters(cursor) && cursor.getStart(sourceFile) < position) {
      const parameter = cursor.parameters.find((candidate) =>
        bindingNameBinds(candidate.name, name),
      );
      if (parameter !== undefined) {
        return { binding: parameter };
      }
    }
    if (ts.isBlock(cursor) || ts.isSourceFile(cursor)) {
      for (const statement of cursor.statements) {
        if (statement.getStart(sourceFile) >= position) continue;
        if (!ts.isVariableStatement(statement)) {
          if (statementBindsName(statement, name)) return { binding: statement };
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
            return { binding: declaration, initializer: declaration.initializer };
          }
          if (
            ts.isObjectBindingPattern(declaration.name) &&
            declaration.initializer &&
            objectBindingPatternBindsName(declaration.name, name) &&
            isConstVariableDeclaration(declaration)
          ) {
            return { binding: declaration, initializer: declaration.initializer };
          }
          if (bindingNameBinds(declaration.name, name)) return { binding: declaration };
        }
      }
    }
    cursor = cursor.parent;
  }
  return undefined;
}

function bindingIsRenderParameter(binding: ts.Node, render: RenderFunction | undefined): boolean {
  return (
    render !== undefined &&
    ts.isParameter(binding) &&
    binding.parent === render &&
    (binding === render.parameters[0] || binding === render.parameters[2])
  );
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
  if (ts.isNumericLiteral(expr)) return expr.text;
  return null;
}

function jsxAttributeName(attribute: ts.JsxAttribute): string | null {
  return ts.isIdentifier(attribute.name) ? identifierName(attribute.name) : null;
}

function jsxAttributeExpression(attribute: ts.JsxAttribute): ts.Expression | undefined {
  const initializer = attribute.initializer;
  if (initializer === undefined || !ts.isJsxExpression(initializer)) return undefined;
  return initializer.expression;
}

function isRawHtmlAttributeName(name: string): name is RawTrustSink['label'] {
  return (
    name === 'dangerouslySetInnerHTML' ||
    name === 'innerHTML' ||
    name === 'rawHtml' ||
    name === 'html'
  );
}

function trustedTypeLocalNames(sourceFile: ts.SourceFile): TrustedTypeLocalNames {
  const trustedHtml = new Set<string>();
  const trustedUrl = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (literalText(statement.moduleSpecifier) !== BROWSER_MODULE_SPECIFIER) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const importedName = element.propertyName
        ? moduleExportNameText(element.propertyName)
        : identifierName(element.name);
      if (importedName === TRUSTED_HTML_TYPE_EXPORT) trustedHtml.add(identifierName(element.name));
      if (importedName === TRUSTED_URL_TYPE_EXPORT) trustedUrl.add(identifierName(element.name));
    }
  }
  return { trustedHtml, trustedUrl };
}

function bindingHasTrustedType(
  binding: ts.Node,
  sink: RawTrustSink,
  ctx: ClassifyContext,
): boolean {
  const typeNode =
    ts.isParameter(binding) || ts.isVariableDeclaration(binding) ? binding.type : undefined;
  return typeNode !== undefined && typeNodeHasTrustedBrand(typeNode, sink.expectedBrand, ctx);
}

function expressionHasTrustedType(
  expression: ts.Expression,
  sink: RawTrustSink,
  ctx: ClassifyContext,
): boolean {
  let cursor: ts.Expression = expression;
  while (ts.isParenthesizedExpression(cursor) || ts.isNonNullExpression(cursor)) {
    cursor = cursor.expression;
  }
  if (ts.isAsExpression(cursor) || ts.isTypeAssertionExpression(cursor)) {
    return typeNodeHasTrustedBrand(cursor.type, sink.expectedBrand, ctx);
  }
  if (ts.isSatisfiesExpression(cursor)) {
    return typeNodeHasTrustedBrand(cursor.type, sink.expectedBrand, ctx);
  }
  return false;
}

function expressionHasTrustedUrlType(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): boolean {
  const sink: RawTrustSink = {
    auditedReasonAllowed: true,
    expectedBrand: 'trustedUrl',
    label: 'trustedUrl',
    rawSink: 'trusted URL',
    syntax: 'value',
  };
  const ctx: ClassifyContext = {
    ...EMPTY_RENDER_BINDINGS,
    depth: 0,
    trustedTypeNames: trustedTypeLocalNames(sourceFile),
    visited: new Set<ts.Node>(),
  };
  return expressionHasTrustedType(expression, sink, ctx);
}

function bindingHasTrustedUrlType(sourceFile: ts.SourceFile, binding: ts.Node): boolean {
  const sink: RawTrustSink = {
    auditedReasonAllowed: true,
    expectedBrand: 'trustedUrl',
    label: 'trustedUrl',
    rawSink: 'trusted URL',
    syntax: 'value',
  };
  const ctx: ClassifyContext = {
    ...EMPTY_RENDER_BINDINGS,
    depth: 0,
    trustedTypeNames: trustedTypeLocalNames(sourceFile),
    visited: new Set<ts.Node>(),
  };
  return bindingHasTrustedType(binding, sink, ctx);
}

function typeNodeHasTrustedBrand(
  typeNode: ts.TypeNode,
  expectedBrand: TrustedSinkExpectedBrand,
  ctx: ClassifyContext,
): boolean {
  const expectedNames =
    expectedBrand === 'trustedHtml'
      ? ctx.trustedTypeNames.trustedHtml
      : ctx.trustedTypeNames.trustedUrl;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && expectedNames.has(identifierName(node))) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(typeNode);
  return found;
}

function staticStringValue(
  argument: ts.Expression | undefined,
  visited = new Set<ts.Node>(),
): string | null {
  if (argument === undefined) return null;
  const expr = unwrap(argument);
  if (ts.isStringLiteralLike(expr)) return literalText(expr);
  if (!ts.isIdentifier(expr)) return null;
  const initializer = localConstInitializer(expr, identifierName(expr));
  if (initializer === undefined || visited.has(initializer)) return null;
  visited.add(initializer);
  return staticStringValue(initializer, visited);
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
  let render: RenderFunction | undefined;

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
      render,
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
  render: undefined,
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
  const sinkLabel = sink.syntax === 'call' ? `${sink.label}()` : `${sink.label} value`;
  const detail =
    `${sinkLabel} sends ${source} to a ${sink.rawSink} sink without sanitization or an audited ` +
    'justification.';
  const publicFix = sink.auditedReasonAllowed
    ? `or, for a value you assert is not request/query data, use the audited escape ${sink.expectedBrand}(value, "<justification>") so it is surfaced in kovo explain --trust.`
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
