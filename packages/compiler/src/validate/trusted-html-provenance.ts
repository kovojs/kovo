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
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetForEach,
  compilerSetHas,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';
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
 * serverValue/trustedAssign):
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
            usePosition: value.getStart(sourceFile),
            visited: compilerCreateSet<ts.Node>(),
          });
          if (provenance === null) {
            // Proven local/static-clean value.
          } else {
            found[found.length] = rawTrustProvenanceDiagnostic(
              diagnostics,
              value,
              provenance,
              sink,
            );
          }
        }
      }
      if (ts.isJsxAttribute(node)) {
        appendClassifierInputs(
          found,
          validateJsxAttributeTrustedProvenance(diagnostics, sourceFile, node, bindingsByRender),
          'Trusted JSX diagnostics',
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
  /** Original sink-value position; alias/initializer recursion must still see writes before use. */
  readonly usePosition?: number;
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
    usePosition: value.getStart(sourceFile),
    visited: compilerCreateSet<ts.Node>(),
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
  const statementLength = compilerArrayLength(sourceFile.statements, 'Source statements');
  for (let index = 0; index < statementLength; index += 1) {
    const statement = compilerOwnDataValue(sourceFile.statements, index, 'Source statements') as
      | ts.Statement
      | undefined;
    if (!statement) throw new TypeError(`Source statements[${index}] must be dense own data.`);
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
      if (
        classifierArraySome(cursor.parameters, 'Callable parameters', (parameter) =>
          bindingNameBinds(parameter.name, name),
        )
      ) {
        return true;
      }
    }
    if (ts.isBlock(cursor) || ts.isModuleBlock(cursor) || ts.isSourceFile(cursor)) {
      const statementLength = compilerArrayLength(cursor.statements, 'Scope statements');
      for (let index = 0; index < statementLength; index += 1) {
        const statement = compilerOwnDataValue(cursor.statements, index, 'Scope statements') as
          | ts.Statement
          | undefined;
        if (!statement) throw new TypeError(`Scope statements[${index}] must be dense own data.`);
        if (statement.getStart(sourceFile) >= position) continue;
        if (ts.isImportDeclaration(statement)) continue;
        if (statementBindsName(statement, name)) return true;
        if (ts.isVariableStatement(statement)) {
          const declarationLength = compilerArrayLength(
            statement.declarationList.declarations,
            'Scope declarations',
          );
          for (
            let declarationIndex = 0;
            declarationIndex < declarationLength;
            declarationIndex += 1
          ) {
            const declaration = compilerOwnDataValue(
              statement.declarationList.declarations,
              declarationIndex,
              'Scope declarations',
            ) as ts.VariableDeclaration | undefined;
            if (!declaration) {
              throw new TypeError(
                `Scope declarations[${declarationIndex}] must be dense own data.`,
              );
            }
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
        visited: cloneClassifierSet(ctx.visited),
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
        visited: cloneClassifierSet(ctx.visited),
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
  visited = compilerCreateSet<ts.Node>(),
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
  if (local.initializer === undefined || compilerSetHas(visited, local.initializer)) return false;
  compilerSetAdd(visited, local.initializer);
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
        classifyExpression(expr.condition, { ...ctx, visited: cloneClassifierSet(ctx.visited) }),
        classifyExpression(expr.whenTrue, { ...ctx, visited: cloneClassifierSet(ctx.visited) }),
        classifyExpression(expr.whenFalse, { ...ctx, visited: cloneClassifierSet(ctx.visited) }),
      ]);
    }
    if (ts.isBinaryExpression(expr)) {
      return firstProvenance([
        classifyExpression(expr.left, { ...ctx, visited: cloneClassifierSet(ctx.visited) }),
        classifyExpression(expr.right, { ...ctx, visited: cloneClassifierSet(ctx.visited) }),
      ]);
    }
    if (ts.isTemplateExpression(expr)) {
      return firstProvenance(
        mapClassifierInputs(expr.templateSpans, 'Trusted HTML template spans', (span) =>
          classifyExpression(span.expression, { ...ctx, visited: cloneClassifierSet(ctx.visited) }),
        ),
      );
    }
    if (ts.isCallExpression(expr) || ts.isNewExpression(expr)) {
      const argumentProvenance = firstProvenance(
        mapClassifierInputs(expr.arguments ?? [], 'Trusted HTML call arguments', (arg) =>
          classifyExpression(arg, { ...ctx, visited: cloneClassifierSet(ctx.visited) }),
        ),
      );
      const calleeProvenance = classifyExpression(expr.expression, {
        ...ctx,
        visited: cloneClassifierSet(ctx.visited),
      });
      return firstProvenance([argumentProvenance, calleeProvenance]) ?? 'unprovable';
    }
    if (ts.isArrayLiteralExpression(expr)) {
      return firstProvenance(
        mapClassifierInputs(expr.elements, 'Trusted HTML array elements', (element) =>
          classifyExpression(element, { ...ctx, visited: cloneClassifierSet(ctx.visited) }),
        ),
      );
    }
    if (ts.isObjectLiteralExpression(expr)) {
      return firstProvenance(
        mapClassifierInputs(expr.properties, 'Trusted HTML object properties', (property) =>
          classifyObjectLiteralProperty(property, ctx),
        ),
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

function mapClassifierInputs<Input, Output>(
  values: readonly Input[],
  label: string,
  map: (value: Input) => Output,
): Output[] {
  const length = compilerArrayLength(values, label);
  const output: Output[] = [];
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, label);
    if (value === undefined) throw new TypeError(`${label}[${index}] must be dense own data.`);
    output[output.length] = map(value as Input);
  }
  return output;
}

function appendClassifierInputs<Value>(
  output: Value[],
  values: readonly Value[],
  label: string,
): void {
  const length = compilerArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, label);
    if (value === undefined) throw new TypeError(`${label}[${index}] must be dense own data.`);
    output[output.length] = value as Value;
  }
}

function classifierArraySome<Value>(
  values: readonly Value[],
  label: string,
  predicate: (value: Value) => boolean,
): boolean {
  const length = compilerArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, label);
    if (value === undefined) throw new TypeError(`${label}[${index}] must be dense own data.`);
    if (predicate(value as Value)) return true;
  }
  return false;
}

function classifierArrayFind<Value>(
  values: readonly Value[],
  label: string,
  predicate: (value: Value) => boolean,
): Value | undefined {
  const length = compilerArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, label);
    if (value === undefined) throw new TypeError(`${label}[${index}] must be dense own data.`);
    if (predicate(value as Value)) return value as Value;
  }
  return undefined;
}

function cloneClassifierSet<Value>(source: ReadonlySet<Value>): Set<Value> {
  const clone = compilerCreateSet<Value>();
  compilerSetForEach(source, (value) => compilerSetAdd(clone, value));
  return clone;
}

function classifierSetHasValues<Value>(source: ReadonlySet<Value>): boolean {
  let found = false;
  compilerSetForEach(source, () => {
    found = true;
  });
  return found;
}

function classifierMapHasValues<Key, Value>(source: ReadonlyMap<Key, Value>): boolean {
  let found = false;
  compilerMapForEach(source, () => {
    found = true;
  });
  return found;
}

function classifyObjectLiteralProperty(
  property: ts.ObjectLiteralElementLike,
  ctx: ClassifyContext,
): Provenance | null {
  if (ts.isSpreadAssignment(property)) {
    return (
      classifyExpression(property.expression, {
        ...ctx,
        visited: cloneClassifierSet(ctx.visited),
      }) ?? 'unprovable'
    );
  }
  if (ts.isPropertyAssignment(property)) {
    const keyProvenance = computedPropertyNameProvenance(property.name, ctx);
    const valueProvenance = classifyExpression(property.initializer, {
      ...ctx,
      visited: cloneClassifierSet(ctx.visited),
    });
    return firstProvenance([keyProvenance, valueProvenance]);
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    return classifyIdentifier(property.name, { ...ctx, visited: cloneClassifierSet(ctx.visited) });
  }
  return 'unprovable';
}

function firstProvenance(values: readonly (Provenance | null)[]): Provenance | null {
  let unprovable = false;
  const length = compilerArrayLength(values, 'Provenance candidates');
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, 'Provenance candidates') as
      | Provenance
      | null
      | undefined;
    if (value === undefined) {
      throw new TypeError(`Provenance candidates[${index}] must be dense own data.`);
    }
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
      const mutation = localCarrierMutationProvenance(cursor, localRoot.binding, firstMember, ctx);
      if (mutation !== undefined) return mutation;
      if (localRoot.initializer !== undefined && ctx.depth < MAX_ALIAS_DEPTH) {
        return classifyExpression(localRoot.initializer, { ...ctx, depth: ctx.depth + 1 });
      }
      return 'unprovable';
    }
    if (compilerSetHas(ctx.requestBindings, cursor.text)) return 'request';
    if (compilerSetHas(ctx.requestSlotRoots, cursor.text) && firstMember === 'request') {
      return 'request';
    }
    const queryRootKeys = compilerMapGet(ctx.queryDataRoots, cursor.text);
    if (
      queryRootKeys !== undefined &&
      firstMember !== undefined &&
      compilerSetHas(queryRootKeys, firstMember)
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
    const mutation = localCarrierMutationProvenance(id, local.binding, undefined, ctx);
    if (mutation !== undefined) return mutation;
    if (
      local.initializer !== undefined &&
      ctx.depth < MAX_ALIAS_DEPTH &&
      !compilerSetHas(ctx.visited, local.initializer)
    ) {
      compilerSetAdd(ctx.visited, local.initializer);
      return classifyExpression(local.initializer, { ...ctx, depth: ctx.depth + 1 });
    }
    return 'unprovable';
  }

  if (compilerSetHas(ctx.queryBindings, id.text)) return 'query';
  if (compilerMapGet(ctx.queryDataRoots, id.text) !== undefined) return 'query';
  if (compilerSetHas(ctx.requestBindings, id.text)) return 'request';
  return 'unprovable';
}

interface CarrierMemberTarget {
  readonly computedKey?: ts.Expression;
  readonly key: string | null;
}

/**
 * H3 / SPEC §6.6 rule 5: following only a carrier's initializer is unsound once authored code can
 * write through that identity before the trust sink. Scan the enclosing execution scope up to the
 * original sink position, follow simple aliases, classify recognized writes, and fail closed when
 * the carrier escapes to code whose mutation behavior is not locally provable.
 */
function localCarrierMutationProvenance(
  root: ts.Identifier,
  binding: ts.Node,
  targetMember: string | undefined,
  ctx: ClassifyContext,
): Provenance | undefined {
  const sourceFile = root.getSourceFile();
  const start = binding.getEnd();
  const end = ctx.usePosition ?? root.getStart(sourceFile);
  if (end <= start) return undefined;

  const scope = carrierMutationScope(binding, ctx);
  const aliases = compilerCreateSet<string>();
  compilerSetAdd(aliases, identifierName(root));

  // Discover direct identity aliases to a fixed point before classifying writes. This covers
  // `const b = a`, `let b = a`, and later `b = a` without confusing destructured property values
  // with the carrier object itself.
  let changed = true;
  while (changed) {
    changed = false;
    visitCarrierRange(scope, sourceFile, start, end, (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (
          expressionIsCarrierAlias(node.initializer, aliases) &&
          !compilerSetHas(aliases, node.name.text)
        ) {
          compilerSetAdd(aliases, node.name.text);
          changed = true;
        }
        return;
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(unwrap(node.left)) &&
        expressionIsCarrierAlias(node.right, aliases)
      ) {
        const name = identifierName(unwrap(node.left) as ts.Identifier);
        if (!compilerSetHas(aliases, name)) {
          compilerSetAdd(aliases, name);
          changed = true;
        }
      }
    });
  }

  let found: Provenance | null = null;
  const record = (provenance: Provenance | null): void => {
    if (provenance !== null) found = firstProvenance([found, provenance]);
  };

  visitCarrierRange(scope, sourceFile, start, end, (node) => {
    if (ts.isBinaryExpression(node) && isAssignmentOperatorKind(node.operatorToken.kind)) {
      const left = unwrap(node.left);
      if (ts.isIdentifier(left) && compilerSetHas(aliases, identifierName(left))) {
        record(classifyExpression(node.right, mutationClassifyContext(ctx)) ?? 'unprovable');
        return;
      }
      if (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) {
        const target = carrierMemberTarget(left, aliases);
        if (target && carrierMutationTargetsMember(target, targetMember)) {
          const keyProvenance = target.computedKey
            ? classifyExpression(target.computedKey, mutationClassifyContext(ctx))
            : null;
          const valueProvenance = classifyExpression(node.right, mutationClassifyContext(ctx));
          record(
            target.key === null
              ? (firstProvenance([keyProvenance, valueProvenance, 'unprovable']) ?? 'unprovable')
              : valueProvenance,
          );
        }
      }
      return;
    }

    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (ts.isPropertyAccessExpression(unwrap(node.operand)) ||
        ts.isElementAccessExpression(unwrap(node.operand)))
    ) {
      const target = carrierMemberTarget(
        unwrap(node.operand) as ts.PropertyAccessExpression | ts.ElementAccessExpression,
        aliases,
      );
      if (target && carrierMutationTargetsMember(target, targetMember)) record('unprovable');
      return;
    }

    if (ts.isDeleteExpression(node)) {
      const expression = unwrap(node.expression);
      if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
        const target = carrierMemberTarget(expression, aliases);
        if (target && carrierMutationTargetsMember(target, targetMember)) record('unprovable');
      }
      return;
    }

    if (ts.isCallExpression(node)) {
      if (isStaticMethodCall(node, 'Object', 'assign')) {
        if (node.arguments[0] && expressionIsCarrierAlias(node.arguments[0], aliases)) {
          const argumentLength = compilerArrayLength(node.arguments, 'Object.assign arguments');
          for (let index = 1; index < argumentLength; index += 1) {
            const source = compilerOwnDataValue(
              node.arguments,
              index,
              'Object.assign arguments',
            ) as ts.Expression | undefined;
            if (!source) {
              throw new TypeError(`Object.assign arguments[${index}] must be dense own data.`);
            }
            record(objectAssignmentProvenance(source, targetMember, ctx));
          }
        }
        return;
      }
      if (isStaticMethodCall(node, 'Reflect', 'set')) {
        if (node.arguments[0] && expressionIsCarrierAlias(node.arguments[0], aliases)) {
          const key = node.arguments[1];
          const value = node.arguments[2];
          const staticKey = key === undefined ? null : staticStringValue(key);
          if (targetMember === undefined || staticKey === null || staticKey === targetMember) {
            const keyProvenance = key
              ? classifyExpression(key, mutationClassifyContext(ctx))
              : 'unprovable';
            const valueProvenance = value
              ? classifyExpression(value, mutationClassifyContext(ctx))
              : 'unprovable';
            record(
              staticKey === null
                ? (firstProvenance([keyProvenance, valueProvenance, 'unprovable']) ?? 'unprovable')
                : valueProvenance,
            );
          }
        }
        return;
      }
      if (isStaticMethodCall(node, 'Object', 'defineProperty')) {
        if (node.arguments[0] && expressionIsCarrierAlias(node.arguments[0], aliases)) {
          const key = node.arguments[1];
          const descriptor = node.arguments[2];
          const staticKey = key === undefined ? null : staticStringValue(key);
          if (targetMember === undefined || staticKey === null || staticKey === targetMember) {
            const keyProvenance = key
              ? classifyExpression(key, mutationClassifyContext(ctx))
              : 'unprovable';
            const descriptorProvenance = descriptor
              ? propertyDescriptorProvenance(descriptor, ctx)
              : 'unprovable';
            record(
              staticKey === null
                ? (firstProvenance([keyProvenance, descriptorProvenance, 'unprovable']) ??
                    'unprovable')
                : descriptorProvenance,
            );
          }
        }
        return;
      }
      if (isStaticMethodCall(node, 'Object', 'defineProperties')) {
        if (node.arguments[0] && expressionIsCarrierAlias(node.arguments[0], aliases)) {
          const descriptors = node.arguments[1];
          record(
            descriptors
              ? objectDescriptorMapProvenance(descriptors, targetMember, ctx)
              : 'unprovable',
          );
        }
        return;
      }

      const calleeTarget =
        ts.isPropertyAccessExpression(unwrap(node.expression)) ||
        ts.isElementAccessExpression(unwrap(node.expression))
          ? carrierMemberTarget(
              unwrap(node.expression) as ts.PropertyAccessExpression | ts.ElementAccessExpression,
              aliases,
            )
          : undefined;
      const passesCarrier = classifierArraySome(
        node.arguments,
        'Carrier call arguments',
        (argument) =>
          expressionIsCarrierAlias(
            ts.isSpreadElement(argument) ? argument.expression : argument,
            aliases,
          ),
      );
      if (calleeTarget || passesCarrier) record('unprovable');
      return;
    }

    if (ts.isReturnStatement(node) && node.expression) {
      if (expressionIsCarrierAlias(node.expression, aliases)) record('unprovable');
    }
  });

  return found ?? undefined;
}

function mutationClassifyContext(ctx: ClassifyContext): ClassifyContext {
  return {
    ...ctx,
    depth: ctx.depth + 1,
    visited: cloneClassifierSet(ctx.visited),
  };
}

function carrierMutationScope(binding: ts.Node, ctx: ClassifyContext): ts.Node {
  if (
    ctx.render !== undefined &&
    (ctx.usePosition ?? -1) >= ctx.render.getStart() &&
    (ctx.usePosition ?? Number.POSITIVE_INFINITY) < ctx.render.end
  ) {
    return ctx.render;
  }
  let cursor: ts.Node | undefined = binding.parent;
  while (cursor) {
    if (isFunctionLikeWithParameters(cursor) || ts.isSourceFile(cursor)) return cursor;
    cursor = cursor.parent;
  }
  return binding.getSourceFile();
}

function visitCarrierRange(
  scope: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
  visitor: (node: ts.Node) => void,
): void {
  const visit = (node: ts.Node): void => {
    if (node !== scope && isFunctionLikeWithParameters(node)) return;
    if (node.end <= start || node.getStart(sourceFile) >= end) return;
    visitor(node);
    ts.forEachChild(node, visit);
  };
  visit(scope);
}

function expressionIsCarrierAlias(
  expression: ts.Expression,
  aliases: ReadonlySet<string>,
): boolean {
  const value = unwrap(expression);
  return ts.isIdentifier(value) && compilerSetHas(aliases, identifierName(value));
}

function carrierMemberTarget(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  aliases: ReadonlySet<string>,
): CarrierMemberTarget | undefined {
  let cursor: ts.Expression = expression;
  let firstMember: string | null = null;
  let computedKey: ts.Expression | undefined;
  while (ts.isPropertyAccessExpression(cursor) || ts.isElementAccessExpression(cursor)) {
    if (ts.isPropertyAccessExpression(cursor)) {
      firstMember = cursor.name.text;
      computedKey = undefined;
      cursor = unwrap(cursor.expression);
    } else {
      const key = elementAccessName(cursor.argumentExpression);
      firstMember = key;
      computedKey = key === null ? cursor.argumentExpression : undefined;
      cursor = unwrap(cursor.expression);
    }
  }
  if (!ts.isIdentifier(cursor) || !compilerSetHas(aliases, identifierName(cursor))) {
    return undefined;
  }
  return { ...(computedKey === undefined ? {} : { computedKey }), key: firstMember };
}

function carrierMutationTargetsMember(
  target: CarrierMemberTarget,
  member: string | undefined,
): boolean {
  return member === undefined || target.key === null || target.key === member;
}

function isAssignmentOperatorKind(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isStaticMethodCall(call: ts.CallExpression, receiver: string, method: string): boolean {
  const callee = unwrap(call.expression);
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(unwrap(callee.expression)) &&
    identifierName(unwrap(callee.expression) as ts.Identifier) === receiver &&
    callee.name.text === method
  );
}

function objectAssignmentProvenance(
  expression: ts.Expression,
  targetMember: string | undefined,
  ctx: ClassifyContext,
): Provenance | null {
  const value = unwrap(expression);
  if (targetMember === undefined || !ts.isObjectLiteralExpression(value)) {
    return (
      classifyExpression(expression, mutationClassifyContext(ctx)) ??
      (ts.isObjectLiteralExpression(value) ? null : 'unprovable')
    );
  }

  const provenances: Array<Provenance | null> = [];
  const propertyLength = compilerArrayLength(value.properties, 'Object assignment properties');
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      value.properties,
      index,
      'Object assignment properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) {
      throw new TypeError(`Object assignment properties[${index}] must be dense own data.`);
    }
    if (ts.isSpreadAssignment(property)) {
      provenances[provenances.length] =
        classifyExpression(property.expression, mutationClassifyContext(ctx)) ?? 'unprovable';
      continue;
    }
    const name = propertyNameText(property.name);
    if (name === null) {
      provenances[provenances.length] = 'unprovable';
      continue;
    }
    if (name !== targetMember) continue;
    if (ts.isPropertyAssignment(property)) {
      provenances[provenances.length] = classifyExpression(
        property.initializer,
        mutationClassifyContext(ctx),
      );
    } else if (ts.isShorthandPropertyAssignment(property)) {
      provenances[provenances.length] = classifyIdentifier(
        property.name,
        mutationClassifyContext(ctx),
      );
    } else {
      provenances[provenances.length] = 'unprovable';
    }
  }
  return firstProvenance(provenances);
}

function propertyDescriptorProvenance(
  expression: ts.Expression,
  ctx: ClassifyContext,
): Provenance | null {
  const value = unwrap(expression);
  if (!ts.isObjectLiteralExpression(value)) return 'unprovable';
  const provenances: Array<Provenance | null> = [];
  const propertyLength = compilerArrayLength(value.properties, 'Property descriptor properties');
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      value.properties,
      index,
      'Property descriptor properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) {
      throw new TypeError(`Property descriptor properties[${index}] must be dense own data.`);
    }
    if (ts.isSpreadAssignment(property)) {
      provenances[provenances.length] = 'unprovable';
      continue;
    }
    const name = propertyNameText(property.name);
    if (name === 'value') {
      if (ts.isPropertyAssignment(property)) {
        provenances[provenances.length] = classifyExpression(
          property.initializer,
          mutationClassifyContext(ctx),
        );
      } else if (ts.isShorthandPropertyAssignment(property)) {
        provenances[provenances.length] = classifyIdentifier(
          property.name,
          mutationClassifyContext(ctx),
        );
      } else {
        provenances[provenances.length] = 'unprovable';
      }
    } else if (name === 'get' || name === 'set' || name === null) {
      provenances[provenances.length] = 'unprovable';
    }
  }
  return firstProvenance(provenances);
}

function objectDescriptorMapProvenance(
  expression: ts.Expression,
  targetMember: string | undefined,
  ctx: ClassifyContext,
): Provenance | null {
  const value = unwrap(expression);
  if (targetMember === undefined || !ts.isObjectLiteralExpression(value)) return 'unprovable';
  const provenances: Array<Provenance | null> = [];
  const propertyLength = compilerArrayLength(value.properties, 'Descriptor map properties');
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(value.properties, index, 'Descriptor map properties') as
      | ts.ObjectLiteralElementLike
      | undefined;
    if (!property) {
      throw new TypeError(`Descriptor map properties[${index}] must be dense own data.`);
    }
    if (ts.isSpreadAssignment(property)) {
      provenances[provenances.length] = 'unprovable';
      continue;
    }
    const name = propertyNameText(property.name);
    if (name === null) {
      provenances[provenances.length] = 'unprovable';
      continue;
    }
    if (name !== targetMember) continue;
    if (ts.isPropertyAssignment(property)) {
      provenances[provenances.length] = propertyDescriptorProvenance(property.initializer, ctx);
    } else {
      provenances[provenances.length] = 'unprovable';
    }
  }
  return firstProvenance(provenances);
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
      const parameter = classifierArrayFind(cursor.parameters, 'Callable parameters', (candidate) =>
        bindingNameBinds(candidate.name, name),
      );
      if (parameter !== undefined) {
        return { binding: parameter };
      }
    }
    if (ts.isBlock(cursor) || ts.isSourceFile(cursor)) {
      const statementLength = compilerArrayLength(cursor.statements, 'Local scope statements');
      for (let index = 0; index < statementLength; index += 1) {
        const statement = compilerOwnDataValue(
          cursor.statements,
          index,
          'Local scope statements',
        ) as ts.Statement | undefined;
        if (!statement) {
          throw new TypeError(`Local scope statements[${index}] must be dense own data.`);
        }
        if (statement.getStart(sourceFile) >= position) continue;
        if (!ts.isVariableStatement(statement)) {
          if (statementBindsName(statement, name)) return { binding: statement };
          continue;
        }
        const declarationLength = compilerArrayLength(
          statement.declarationList.declarations,
          'Local variable declarations',
        );
        for (
          let declarationIndex = 0;
          declarationIndex < declarationLength;
          declarationIndex += 1
        ) {
          const declaration = compilerOwnDataValue(
            statement.declarationList.declarations,
            declarationIndex,
            'Local variable declarations',
          ) as ts.VariableDeclaration | undefined;
          if (!declaration) {
            throw new TypeError(
              `Local variable declarations[${declarationIndex}] must be dense own data.`,
            );
          }
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
  return classifierArraySome(
    bindings.elements,
    'Named import bindings',
    (element) => element.name.text === name,
  );
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
      if (
        classifierArraySome(cursor.parameters, 'Callable parameters', (parameter) =>
          bindingNameBinds(parameter.name, name),
        )
      ) {
        return undefined;
      }
    }
    if (ts.isBlock(cursor) || ts.isSourceFile(cursor)) {
      const statementLength = compilerArrayLength(cursor.statements, 'Callable scope statements');
      for (let index = 0; index < statementLength; index += 1) {
        const statement = compilerOwnDataValue(
          cursor.statements,
          index,
          'Callable scope statements',
        ) as ts.Statement | undefined;
        if (!statement) {
          throw new TypeError(`Callable scope statements[${index}] must be dense own data.`);
        }
        if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
          return statement;
        }
        if (!ts.isVariableStatement(statement)) continue;
        const declarationLength = compilerArrayLength(
          statement.declarationList.declarations,
          'Callable variable declarations',
        );
        for (
          let declarationIndex = 0;
          declarationIndex < declarationLength;
          declarationIndex += 1
        ) {
          const declaration = compilerOwnDataValue(
            statement.declarationList.declarations,
            declarationIndex,
            'Callable variable declarations',
          ) as ts.VariableDeclaration | undefined;
          if (!declaration) {
            throw new TypeError(
              `Callable variable declarations[${declarationIndex}] must be dense own data.`,
            );
          }
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
  const statementLength = compilerArrayLength(body.statements, 'Callable body statements');
  for (let index = 0; index < statementLength; index += 1) {
    const statement = compilerOwnDataValue(body.statements, index, 'Callable body statements') as
      | ts.Statement
      | undefined;
    if (!statement) {
      throw new TypeError(`Callable body statements[${index}] must be dense own data.`);
    }
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
  return classifierArraySome(
    name.elements,
    'Binding elements',
    (element) => ts.isBindingElement(element) && bindingNameBinds(element.name, target),
  );
}

function objectBindingPatternBindsName(pattern: ts.ObjectBindingPattern, name: string): boolean {
  const elementLength = compilerArrayLength(pattern.elements, 'Object binding elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = compilerOwnDataValue(pattern.elements, index, 'Object binding elements') as
      | ts.BindingElement
      | undefined;
    if (!element) throw new TypeError(`Object binding elements[${index}] must be dense own data.`);
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
  const trustedHtml = compilerCreateSet<string>();
  const trustedUrl = compilerCreateSet<string>();
  const statementLength = compilerArrayLength(sourceFile.statements, 'Trusted type statements');
  for (let index = 0; index < statementLength; index += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      index,
      'Trusted type statements',
    ) as ts.Statement | undefined;
    if (!statement)
      throw new TypeError(`Trusted type statements[${index}] must be dense own data.`);
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (literalText(statement.moduleSpecifier) !== BROWSER_MODULE_SPECIFIER) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const elementLength = compilerArrayLength(bindings.elements, 'Trusted type imports');
    for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
      const element = compilerOwnDataValue(
        bindings.elements,
        elementIndex,
        'Trusted type imports',
      ) as ts.ImportSpecifier | undefined;
      if (!element) {
        throw new TypeError(`Trusted type imports[${elementIndex}] must be dense own data.`);
      }
      const importedName = element.propertyName
        ? moduleExportNameText(element.propertyName)
        : identifierName(element.name);
      if (importedName === TRUSTED_HTML_TYPE_EXPORT) {
        compilerSetAdd(trustedHtml, identifierName(element.name));
      }
      if (importedName === TRUSTED_URL_TYPE_EXPORT) {
        compilerSetAdd(trustedUrl, identifierName(element.name));
      }
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
    usePosition: expression.getStart(sourceFile),
    visited: compilerCreateSet<ts.Node>(),
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
    usePosition: binding.getStart(sourceFile),
    visited: compilerCreateSet<ts.Node>(),
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
    if (ts.isIdentifier(node) && compilerSetHas(expectedNames, identifierName(node))) {
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
  visited = compilerCreateSet<ts.Node>(),
): string | null {
  if (argument === undefined) return null;
  const expr = unwrap(argument);
  if (ts.isStringLiteralLike(expr)) return literalText(expr);
  if (!ts.isIdentifier(expr)) return null;
  const initializer = localConstInitializer(expr, identifierName(expr));
  if (initializer === undefined || compilerSetHas(visited, initializer)) return null;
  compilerSetAdd(visited, initializer);
  return staticStringValue(initializer, visited);
}

/** Discharge: a non-empty STATIC reason as the second argument (`"…"` or `{ reason: "…" }`). */
function hasAuditedReason(call: ts.CallExpression): boolean {
  const metadata = call.arguments[1];
  if (metadata === undefined) return false;
  if (ts.isStringLiteralLike(metadata)) return compilerStringTrim(metadata.text).length > 0;
  if (ts.isObjectLiteralExpression(metadata)) {
    const propertyLength = compilerArrayLength(metadata.properties, 'Trust metadata properties');
    for (let index = 0; index < propertyLength; index += 1) {
      const property = compilerOwnDataValue(
        metadata.properties,
        index,
        'Trust metadata properties',
      ) as ts.ObjectLiteralElementLike | undefined;
      if (!property) {
        throw new TypeError(`Trust metadata properties[${index}] must be dense own data.`);
      }
      if (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        identifierName(property.name) === AUDITED_REASON_PROPERTY &&
        ts.isStringLiteralLike(property.initializer)
      ) {
        return compilerStringTrim(property.initializer.text).length > 0;
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
  const byRender = compilerCreateMap<ts.Node, RenderProvenanceBindings>();
  const componentNames = componentFactoryLocalNames(sourceFile);

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      compilerSetHas(componentNames, node.expression.text) &&
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
  const queryKeys = compilerCreateSet<string>();
  let render: RenderFunction | undefined;

  const propertyLength = compilerArrayLength(options.properties, 'Component option properties');
  for (let index = 0; index < propertyLength; index += 1) {
    const property = compilerOwnDataValue(
      options.properties,
      index,
      'Component option properties',
    ) as ts.ObjectLiteralElementLike | undefined;
    if (!property) {
      throw new TypeError(`Component option properties[${index}] must be dense own data.`);
    }
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
    if (
      identifierName(property.name) === QUERIES_PROPERTY &&
      ts.isObjectLiteralExpression(property.initializer)
    ) {
      const entryLength = compilerArrayLength(
        property.initializer.properties,
        'Component query properties',
      );
      for (let entryIndex = 0; entryIndex < entryLength; entryIndex += 1) {
        const entry = compilerOwnDataValue(
          property.initializer.properties,
          entryIndex,
          'Component query properties',
        ) as ts.ObjectLiteralElementLike | undefined;
        if (!entry) {
          throw new TypeError(`Component query properties[${entryIndex}] must be dense own data.`);
        }
        const key = entry.name;
        const name = key === undefined ? null : propertyNameText(key);
        if (name !== null) compilerSetAdd(queryKeys, name);
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
  const bindings = compilerCreateSet<string>();
  const queryDataRoots = compilerCreateMap<string, ReadonlySet<string>>();
  const requestBindings = compilerCreateSet<string>();
  const requestSlotRoots = compilerCreateSet<string>();

  if (dataParam !== undefined && classifierSetHasValues(queryKeys)) {
    if (ts.isObjectBindingPattern(dataParam.name)) {
      const elementLength = compilerArrayLength(dataParam.name.elements, 'Render data bindings');
      for (let index = 0; index < elementLength; index += 1) {
        const element = compilerOwnDataValue(
          dataParam.name.elements,
          index,
          'Render data bindings',
        ) as ts.BindingElement | undefined;
        if (!element) {
          throw new TypeError(`Render data bindings[${index}] must be dense own data.`);
        }
        const sourceName = element.propertyName ?? element.name;
        if (
          ts.isIdentifier(sourceName) &&
          compilerSetHas(queryKeys, sourceName.text) &&
          ts.isIdentifier(element.name)
        ) {
          compilerSetAdd(bindings, element.name.text);
        }
      }
    } else if (ts.isIdentifier(dataParam.name)) {
      compilerMapSet(queryDataRoots, dataParam.name.text, queryKeys);
    }
  }

  collectRenderRequestBindings(render.parameters[2], requestBindings, requestSlotRoots);

  if (
    classifierSetHasValues(bindings) ||
    classifierMapHasValues(queryDataRoots) ||
    classifierSetHasValues(requestBindings) ||
    classifierSetHasValues(requestSlotRoots)
  ) {
    compilerMapSet(byRender, render, {
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
    compilerSetAdd(slotRoots, slotsParam.name.text);
    return;
  }
  if (!ts.isObjectBindingPattern(slotsParam.name)) return;

  const elementLength = compilerArrayLength(slotsParam.name.elements, 'Render slot bindings');
  for (let index = 0; index < elementLength; index += 1) {
    const element = compilerOwnDataValue(
      slotsParam.name.elements,
      index,
      'Render slot bindings',
    ) as ts.BindingElement | undefined;
    if (!element) throw new TypeError(`Render slot bindings[${index}] must be dense own data.`);
    const sourceName =
      element.propertyName !== undefined
        ? propertyNameText(element.propertyName)
        : ts.isIdentifier(element.name)
          ? identifierName(element.name)
          : null;
    if (sourceName !== 'request') continue;

    if (ts.isIdentifier(element.name)) {
      compilerSetAdd(bindings, identifierName(element.name));
    } else if (ts.isObjectBindingPattern(element.name)) {
      const nestedLength = compilerArrayLength(element.name.elements, 'Nested request bindings');
      for (let nestedIndex = 0; nestedIndex < nestedLength; nestedIndex += 1) {
        const nested = compilerOwnDataValue(
          element.name.elements,
          nestedIndex,
          'Nested request bindings',
        ) as ts.BindingElement | undefined;
        if (!nested) {
          throw new TypeError(`Nested request bindings[${nestedIndex}] must be dense own data.`);
        }
        if (ts.isIdentifier(nested.name)) compilerSetAdd(bindings, identifierName(nested.name));
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
  const names = compilerCreateSet<string>();
  compilerSetAdd(names, COMPONENT_FACTORY_NAME);
  const statementLength = compilerArrayLength(
    sourceFile.statements,
    'Component factory statements',
  );
  for (let index = 0; index < statementLength; index += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      index,
      'Component factory statements',
    ) as ts.Statement | undefined;
    if (!statement) {
      throw new TypeError(`Component factory statements[${index}] must be dense own data.`);
    }
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (literalText(statement.moduleSpecifier) !== CORE_MODULE_SPECIFIER) continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      const elementLength = compilerArrayLength(named.elements, 'Component factory imports');
      for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
        const element = compilerOwnDataValue(
          named.elements,
          elementIndex,
          'Component factory imports',
        ) as ts.ImportSpecifier | undefined;
        if (!element) {
          throw new TypeError(`Component factory imports[${elementIndex}] must be dense own data.`);
        }
        const importedName = element.propertyName
          ? moduleExportNameText(element.propertyName)
          : identifierName(element.name);
        if (importedName === COMPONENT_FACTORY_NAME) {
          compilerSetAdd(names, identifierName(element.name));
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
    const bindings = compilerMapGet(byRender, cursor);
    if (bindings !== undefined) return bindings;
    cursor = cursor.parent;
  }
  return EMPTY_RENDER_BINDINGS;
}

const EMPTY_BINDINGS: ReadonlySet<string> = compilerCreateSet<string>();
const EMPTY_QUERY_DATA_ROOTS: ReadonlyMap<string, ReadonlySet<string>> = compilerCreateMap();
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
