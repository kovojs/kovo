import ts from 'typescript';

export function minifyInlineJavaScriptSource(source: string): string {
  const sourceFile = parseInlineJavaScriptSource(source, 'Inline JavaScript source');
  assertPlainJavaScriptSource(sourceFile);
  assertNoTemplateInterpolation(sourceFile);
  const printer = ts.createPrinter({ removeComments: true });
  const printedSource = printer.printFile(sourceFile);
  const printedSourceFile = parseInlineJavaScriptSource(
    printedSource,
    'Compiler-printed inline JavaScript source',
  );
  const minifiedSource = compactInlineJavaScriptSource(printedSourceFile);
  const minifiedSourceFile = parseInlineJavaScriptSource(
    minifiedSource,
    'Minified inline JavaScript source',
  );

  // SPEC.md §4.4: the always-loaded bootstrap must fail closed if minification
  // changes the parsed JavaScript shipped in document shells.
  const printedTokenFingerprint = collectJavaScriptTokenFingerprint(printedSourceFile);
  const minifiedTokenFingerprint = collectJavaScriptTokenFingerprint(minifiedSourceFile);
  if (!sameStringList(printedTokenFingerprint, minifiedTokenFingerprint)) {
    throw new Error(
      `Inline JavaScript minifier changed the compiler-printed token stream.${formatSourceDifference(
        printedTokenFingerprint.join('\n'),
        minifiedTokenFingerprint.join('\n'),
      )}`,
    );
  }

  const printedFingerprint = collectJavaScriptAstFingerprint(printedSourceFile);
  const minifiedFingerprint = collectJavaScriptAstFingerprint(minifiedSourceFile);
  if (!sameStringList(printedFingerprint, minifiedFingerprint)) {
    throw new Error(
      `Inline JavaScript minifier changed the compiler-printed AST.${formatSourceDifference(
        printedFingerprint.join('\n'),
        minifiedFingerprint.join('\n'),
      )}`,
    );
  }

  return minifiedSource;
}

function parseInlineJavaScriptSource(source: string, label: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(
    'inline-jiso-loader.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const [diagnostic] =
    (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  if (diagnostic) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    throw new Error(`${label} is invalid JavaScript: ${message}`);
  }

  return sourceFile;
}

function collectJavaScriptTokenFingerprint(sourceFile: ts.SourceFile): string[] {
  return collectMinifiedTokens(sourceFile).map((token) => `${token.kind}:${token.text}`);
}

function collectJavaScriptAstFingerprint(sourceFile: ts.SourceFile): string[] {
  const parts: string[] = [];
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      parts.push(`${node.kind}:${node.getText(sourceFile)}`);
      return;
    }

    parts.push(String(node.kind));
    for (const child of children) visit(child);
  };

  visit(sourceFile);
  return parts;
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function formatSourceDifference(expected: string, actual: string): string {
  const maxLength = Math.max(expected.length, actual.length);
  let index = 0;
  while (index < maxLength && expected[index] === actual[index]) index += 1;
  if (index === maxLength) return '';

  return [
    '',
    `First difference at offset ${index}.`,
    `Expected: ${JSON.stringify(expected.slice(index, index + 80))}`,
    `Actual: ${JSON.stringify(actual.slice(index, index + 80))}`,
  ].join('\n');
}

function assertNoTemplateInterpolation(node: ts.Node): void {
  if (ts.isTemplateExpression(node)) {
    throw new Error(
      'Inline JavaScript source cannot use template interpolation; keep the bootstrap literal-safe.',
    );
  }

  ts.forEachChild(node, assertNoTemplateInterpolation);
}

function assertPlainJavaScriptSource(sourceFile: ts.SourceFile): void {
  const visit = (node: ts.Node): void => {
    const typeScriptSyntax = typeScriptOnlySyntaxLabel(node);
    if (typeScriptSyntax) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
      throw new Error(
        `Inline JavaScript source cannot use TypeScript-only syntax (${typeScriptSyntax}) at ${position.line + 1}:${position.character + 1}.`,
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

function typeScriptOnlySyntaxLabel(node: ts.Node): string | undefined {
  if (ts.isAsExpression(node)) return 'as expression';
  if (ts.isEnumDeclaration(node)) return 'enum declaration';
  if (ts.isImportEqualsDeclaration(node)) return 'import equals declaration';
  if (ts.isInterfaceDeclaration(node)) return 'interface declaration';
  if (ts.isModuleDeclaration(node)) return 'namespace/module declaration';
  if (ts.isNonNullExpression(node)) return 'non-null assertion';
  if (ts.isSatisfiesExpression(node)) return 'satisfies expression';
  if (ts.isTypeAliasDeclaration(node)) return 'type alias declaration';
  if (ts.isTypeAssertionExpression(node)) return 'type assertion';
  if (ts.isTypeNode(node)) return 'type annotation';
  if (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ImplementsKeyword) {
    return 'implements clause';
  }
  if (ts.canHaveModifiers(node)) {
    const modifier = ts
      .getModifiers(node)
      ?.find((candidate) => typeScriptOnlyModifierKinds.has(candidate.kind));
    if (modifier) return `modifier ${ts.SyntaxKind[modifier.kind]}`;
  }
  if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return 'type-only import';
  if (ts.isExportDeclaration(node) && node.isTypeOnly) return 'type-only export';
  if (ts.isImportSpecifier(node) && node.isTypeOnly) return 'type-only import';
  if (ts.isExportSpecifier(node) && node.isTypeOnly) return 'type-only export';

  return undefined;
}

const typeScriptOnlyModifierKinds = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AbstractKeyword,
  ts.SyntaxKind.AccessorKeyword,
  ts.SyntaxKind.DeclareKeyword,
  ts.SyntaxKind.OverrideKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
]);

function compactInlineJavaScriptSource(sourceFile: ts.SourceFile): string {
  const tokens = collectMinifiedTokens(sourceFile);

  return tokens
    .map((token, index) => {
      const previousToken = tokens[index - 1];
      const separator = previousToken && needsTokenSeparator(previousToken, token) ? ' ' : '';
      return `${separator}${token.text}`;
    })
    .join('');
}

function collectMinifiedTokens(sourceFile: ts.SourceFile): MinifiedToken[] {
  const source = sourceFile.text;
  const regexSpans = collectRegularExpressionLiteralSpans(sourceFile);
  let regexIndex = 0;
  const tokens: MinifiedToken[] = [];
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source,
  );

  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const tokenStart = scanner.getTokenPos();
    while (regexIndex < regexSpans.length) {
      const currentSpan = regexSpans[regexIndex];
      if (currentSpan === undefined || currentSpan.end > tokenStart) break;
      regexIndex += 1;
    }

    const regexSpan = regexSpans[regexIndex];
    if (
      regexSpan &&
      regexSpan.start < scanner.getTextPos() &&
      regexSpan.end > tokenStart &&
      regexSpan.start !== tokenStart
    ) {
      throw new Error(
        `Inline JavaScript regex literal span overlaps scanner token at offset ${tokenStart}.`,
      );
    }

    const token =
      regexSpan?.start === tokenStart
        ? {
            kind: ts.SyntaxKind.RegularExpressionLiteral,
            text: source.slice(regexSpan.start, regexSpan.end),
          }
        : { kind, text: scanner.getTokenText() };
    tokens.push(token);
    if (regexSpan?.start === tokenStart) {
      scanner.setTextPos(regexSpan.end);
      regexIndex += 1;
    }
  }

  if (regexIndex !== regexSpans.length) {
    throw new Error('Inline JavaScript regex literal span was not consumed by the scanner.');
  }

  return tokens;
}

interface SourceSpan {
  end: number;
  start: number;
}

function collectRegularExpressionLiteralSpans(sourceFile: ts.SourceFile): SourceSpan[] {
  const spans: SourceSpan[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(node)) {
      spans.push({
        end: node.getEnd(),
        start: node.getStart(sourceFile, false),
      });
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return spans.sort((left, right) => left.start - right.start);
}

interface MinifiedToken {
  kind: ts.SyntaxKind;
  text: string;
}

function needsTokenSeparator(previousToken: MinifiedToken, nextToken: MinifiedToken): boolean {
  if (
    previousToken.kind === ts.SyntaxKind.RegularExpressionLiteral &&
    startsWithIdentifierPart(nextToken.text)
  ) {
    return true;
  }
  if (
    previousToken.kind === ts.SyntaxKind.RegularExpressionLiteral &&
    (nextToken.kind === ts.SyntaxKind.SlashToken ||
      nextToken.kind === ts.SyntaxKind.SlashEqualsToken)
  ) {
    return true;
  }
  if (
    previousToken.kind === ts.SyntaxKind.SlashToken &&
    nextToken.kind === ts.SyntaxKind.RegularExpressionLiteral
  ) {
    return true;
  }

  return !tokensRemainSeparateWithoutWhitespace(previousToken, nextToken);
}

function tokensRemainSeparateWithoutWhitespace(
  previousToken: MinifiedToken,
  nextToken: MinifiedToken,
): boolean {
  if (
    previousToken.kind === ts.SyntaxKind.RegularExpressionLiteral ||
    nextToken.kind === ts.SyntaxKind.RegularExpressionLiteral
  ) {
    return true;
  }

  let scannerError = false;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    `${previousToken.text}${nextToken.text}`,
    () => {
      scannerError = true;
    },
  );

  const remainsSeparate =
    scanner.scan() === previousToken.kind &&
    scanner.getTokenText() === previousToken.text &&
    scanner.scan() === nextToken.kind &&
    scanner.getTokenText() === nextToken.text &&
    scanner.scan() === ts.SyntaxKind.EndOfFileToken;

  return remainsSeparate && !scannerError;
}

function startsWithIdentifierPart(value: string): boolean {
  const firstCodePoint = value.codePointAt(0);
  return (
    firstCodePoint !== undefined && ts.isIdentifierPart(firstCodePoint, ts.ScriptTarget.Latest)
  );
}
