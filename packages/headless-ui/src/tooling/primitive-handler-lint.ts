import ts from 'typescript';

export const primitiveHandlerLintCode = 'KOVO_HUI001' as const;

export interface PrimitiveHandlerLintInput {
  path: string;
  source: string;
}

export interface PrimitiveHandlerLintOptions {
  marker?: string;
}

export interface PrimitiveHandlerLintFinding {
  code: typeof primitiveHandlerLintCode;
  column: number;
  handlerName: string;
  line: number;
  message: string;
  path: string;
}

interface HandlerCandidate {
  body: ts.Block | undefined;
  eventParamName: string | null;
  name: string;
  node: ts.Node;
}

const defaultPreventedMessage =
  'Primitive handler must begin by no-oping when event.defaultPrevented is true; SPEC.md §4.6 keeps chained on:* handlers running left-to-right and assigns cancellation handling to primitive handlers.';
const handlerNamePattern =
  /(Click|Change|Input|KeyDown|KeyUp|PointerDown|PointerMove|PointerUp|PointerEnter|PointerLeave|Focus|Blur|OpenAutoFocus|CloseAutoFocus|EscapeKeyDown|InteractOutside)$/;

export function lintPrimitiveHandlers(
  inputs: readonly PrimitiveHandlerLintInput[],
  options: PrimitiveHandlerLintOptions = {},
): PrimitiveHandlerLintFinding[] {
  return inputs.flatMap((input) => lintPrimitiveHandlerSource(input, options.marker));
}

export function formatPrimitiveHandlerLintFindings(
  findings: readonly PrimitiveHandlerLintFinding[],
): string {
  return findings
    .map(
      (finding) =>
        `${finding.path}:${finding.line}:${finding.column} ${finding.code} ${finding.handlerName} ${finding.message}`,
    )
    .join('\n');
}

function lintPrimitiveHandlerSource(
  input: PrimitiveHandlerLintInput,
  marker: string | undefined,
): PrimitiveHandlerLintFinding[] {
  const sourceFile = ts.createSourceFile(input.path, input.source, ts.ScriptTarget.Latest, true);
  const findings: PrimitiveHandlerLintFinding[] = [];

  for (const statement of sourceFile.statements) {
    const markerMatched =
      marker === undefined ? false : hasPrimitiveHandlerMarker(statement, sourceFile, marker);
    if (marker !== undefined && !markerMatched) continue;

    for (const candidate of handlerCandidates(statement)) {
      if (marker === undefined && !isPrimitiveHandlerCandidate(candidate)) continue;
      if (hasDefaultPreventedGuard(candidate)) continue;

      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        candidate.node.getStart(sourceFile),
      );
      findings.push({
        code: primitiveHandlerLintCode,
        column: character + 1,
        handlerName: candidate.name,
        line: line + 1,
        message: defaultPreventedMessage,
        path: input.path,
      });
    }
  }

  return findings;
}

function isPrimitiveHandlerCandidate(candidate: HandlerCandidate): boolean {
  return (
    candidate.body !== undefined &&
    candidate.eventParamName !== null &&
    /event|evt/i.test(candidate.eventParamName) &&
    handlerNamePattern.test(candidate.name)
  );
}

function handlerCandidates(statement: ts.Statement): HandlerCandidate[] {
  if (ts.isFunctionDeclaration(statement)) {
    return [
      {
        body: statement.body,
        eventParamName: firstParamName(statement.parameters),
        name: statement.name?.text ?? '<anonymous>',
        node: statement,
      },
    ];
  }

  if (!ts.isVariableStatement(statement)) return [];

  return statement.declarationList.declarations.flatMap((declaration) => {
    if (!ts.isIdentifier(declaration.name)) return [];
    const initializer = declaration.initializer;
    if (!initializer || !isFunctionLikeInitializer(initializer)) return [];

    return [
      {
        body: ts.isBlock(initializer.body) ? initializer.body : undefined,
        eventParamName: firstParamName(initializer.parameters),
        name: declaration.name.text,
        node: declaration,
      },
    ];
  });
}

function hasPrimitiveHandlerMarker(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  marker: string,
): boolean {
  const fullText = sourceFile.getFullText();
  const ranges = ts.getLeadingCommentRanges(fullText, statement.pos) ?? [];
  return ranges.some((range) => fullText.slice(range.pos, range.end).includes(marker));
}

function hasDefaultPreventedGuard(candidate: HandlerCandidate): boolean {
  if (!candidate.body || !candidate.eventParamName) return false;
  const firstStatement = candidate.body.statements[0];
  if (!firstStatement || !ts.isIfStatement(firstStatement) || firstStatement.elseStatement) {
    return false;
  }

  return (
    isDefaultPreventedCheck(firstStatement.expression, candidate.eventParamName) &&
    isNoopReturn(firstStatement.thenStatement)
  );
}

function isDefaultPreventedCheck(expression: ts.Expression, eventParamName: string): boolean {
  const unwrapped = stripParentheses(expression);
  if (isEventDefaultPreventedAccess(unwrapped, eventParamName)) return true;

  if (!ts.isBinaryExpression(unwrapped)) return false;
  if (unwrapped.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return false;

  return (
    (isEventDefaultPreventedAccess(unwrapped.left, eventParamName) &&
      unwrapped.right.kind === ts.SyntaxKind.TrueKeyword) ||
    (unwrapped.left.kind === ts.SyntaxKind.TrueKeyword &&
      isEventDefaultPreventedAccess(unwrapped.right, eventParamName))
  );
}

function isEventDefaultPreventedAccess(expression: ts.Expression, eventParamName: string): boolean {
  const unwrapped = stripParentheses(expression);
  return (
    ts.isPropertyAccessExpression(unwrapped) &&
    unwrapped.name.text === 'defaultPrevented' &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === eventParamName
  );
}

function isNoopReturn(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return isUndefinedExpression(statement.expression);
  if (!ts.isBlock(statement) || statement.statements.length !== 1) return false;

  const onlyStatement = statement.statements[0];
  return (
    onlyStatement !== undefined &&
    ts.isReturnStatement(onlyStatement) &&
    isUndefinedExpression(onlyStatement.expression)
  );
}

function isUndefinedExpression(expression: ts.Expression | undefined): boolean {
  return (
    expression === undefined ||
    (ts.isIdentifier(expression) && expression.text === 'undefined') ||
    expression.kind === ts.SyntaxKind.VoidExpression
  );
}

function firstParamName(parameters: ts.NodeArray<ts.ParameterDeclaration>): string | null {
  const parameter = parameters[0];
  return parameter && ts.isIdentifier(parameter.name) ? parameter.name.text : null;
}

function isFunctionLikeInitializer(
  expression: ts.Expression,
): expression is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression);
}

function stripParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}
