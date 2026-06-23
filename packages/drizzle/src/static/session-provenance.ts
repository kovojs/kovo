import { Node, SyntaxKind, type ObjectLiteralExpression, type SourceFile, type VariableDeclaration } from 'ts-morph';

import {
  propertyNameText,
  resolvedSymbolKey,
  staticAccessName,
  staticAccessSegments,
  symbolForIdentifierReference,
  unwrappedStaticExpressionNode,
  unsummarizedHelperReason,
  type PrivateScopeKind,
  type PrivateScopeProvenance,
  type SessionAlias,
  type SessionProvenanceContext,
} from '../static.js';

export function emptySessionProvenanceContext(): SessionProvenanceContext {
  return { aliases: new Map(), helpers: new Map(), opaqueAliases: new Map() };
}

export function sessionProvenanceContextForNodes(
  sourceFile: SourceFile,
  bodies: readonly Node[],
): SessionProvenanceContext {
  // advanced-analyzer.md Layer 1: helper provenance must come from explicit typed
  // analyzer summaries, not arbitrary helper source-body inference.
  const helpers = analyzerHelperSummariesForSourceFile(sourceFile);
  const aliases = new Map<string, SessionAlias>();
  const opaqueAliases = new Map<string, string>();
  const context: SessionProvenanceContext = { aliases, helpers, opaqueAliases };

  for (const body of bodies) {
    for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      addSessionAliasesForVariableDeclaration(declaration, context, aliases);
    }
  }

  return context;
}

function analyzerHelperSummariesForSourceFile(
  sourceFile: SourceFile,
): Map<string, PrivateScopeProvenance> {
  const summaries = new Map<string, PrivateScopeProvenance>();
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = unwrappedStaticExpressionNode(call.getExpression());
    const calleeName = Node.isIdentifier(callee) ? callee.getText() : staticAccessName(callee);
    if (calleeName !== 'kovoAnalyzerSummary') continue;

    const [helper, summary] = call.getArguments();
    if (!helper || !summary) continue;

    const key = helperSymbolKeyForSummary(helper);
    const provenance = analyzerSummaryReturnProvenance(summary);
    if (!provenance) continue;
    if (key) summaries.set(key, provenance);
    const helperName = summaryHelperName(helper);
    if (helperName) summaries.set(`name:${helperName}`, provenance);
  }
  return summaries;
}

function helperSymbolKeyForSummary(node: Node): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  const symbol = Node.isIdentifier(expression)
    ? symbolForIdentifierReference(expression)
    : expression.getSymbol();
  return resolvedSymbolKey(symbol);
}

function summaryHelperName(node: Node): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  return Node.isIdentifier(expression) ? expression.getText() : staticAccessName(expression);
}

function analyzerSummaryReturnProvenance(node: Node): PrivateScopeProvenance | undefined {
  const object = unwrappedStaticExpressionNode(node);
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const returns = objectLiteralPropertyInitializer(object, 'returns');
  const returnsObject = returns ? unwrappedStaticExpressionNode(returns) : undefined;
  if (!returnsObject || !Node.isObjectLiteralExpression(returnsObject)) return undefined;

  const kind = objectLiteralStringProperty(returnsObject, 'kind');
  const path = objectLiteralStringProperty(returnsObject, 'path');
  if (!isPrivateScopeKind(kind) || path === undefined) return undefined;

  return { kind, path, requiresGuard: false };
}

function objectLiteralPropertyInitializer(
  object: ObjectLiteralExpression,
  name: string,
): Node | undefined {
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;
    return property.getInitializer();
  }
  return undefined;
}

function objectLiteralStringProperty(
  object: ObjectLiteralExpression,
  name: string,
): string | undefined {
  const value = objectLiteralPropertyInitializer(object, name);
  const expression = value ? unwrappedStaticExpressionNode(value) : undefined;
  return Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)
    ? expression.getLiteralText()
    : undefined;
}

function isPrivateScopeKind(kind: string | undefined): kind is PrivateScopeKind {
  return kind === 'guard' || kind === 'session' || kind === 'tenant';
}

function addSessionAliasesForVariableDeclaration(
  declaration: VariableDeclaration,
  context: SessionProvenanceContext,
  aliases: Map<string, SessionAlias>,
): void {
  const initializer = declaration.getInitializer();
  if (!initializer) return;

  const nameNode = declaration.getNameNode();
  if (Node.isIdentifier(nameNode)) {
    const provenance = privateScopeForExpression(initializer, context);
    const key = resolvedSymbolKey(symbolForIdentifierReference(nameNode) ?? nameNode.getSymbol());
    if (provenance && key) {
      aliases.set(key, {
        declaration,
        kind: provenance.kind,
        name: nameNode.getText(),
        path: provenance.path,
        requiresGuard: provenance.requiresGuard ?? true,
      });
    } else if (provenance) {
      aliases.set(`name:${nameNode.getText()}`, {
        declaration,
        kind: provenance.kind,
        name: nameNode.getText(),
        path: provenance.path,
        requiresGuard: provenance.requiresGuard ?? true,
      });
    } else {
      const opaqueReason = unsummarizedHelperReasonForExpression(initializer);
      if (opaqueReason && key) {
        context.opaqueAliases.set(key, opaqueReason);
      } else if (opaqueReason) {
        context.opaqueAliases.set(`name:${nameNode.getText()}`, opaqueReason);
      }
    }
    return;
  }

  if (!Node.isObjectBindingPattern(nameNode)) return;
  const base = privateScopeForExpression(initializer, context);
  if (!base) return;

  for (const element of nameNode.getElements()) {
    const binding = element.getNameNode();
    if (!Node.isIdentifier(binding)) continue;
    const propertyName = element.getPropertyNameNode();
    const segment = propertyName ? propertyNameText(propertyName) : binding.getText();
    if (!segment) continue;
    const key = resolvedSymbolKey(symbolForIdentifierReference(binding) ?? binding.getSymbol());
    const provenance = {
      kind: base.kind,
      path: joinPrivateScopePath(base.path, segment),
      requiresGuard: base.requiresGuard,
    };
    if (key) {
      aliases.set(key, {
        declaration: element,
        kind: provenance.kind,
        name: binding.getText(),
        path: provenance.path,
        requiresGuard: provenance.requiresGuard ?? true,
      });
    } else {
      aliases.set(`name:${binding.getText()}`, {
        declaration: element,
        kind: provenance.kind,
        name: binding.getText(),
        path: provenance.path,
        requiresGuard: provenance.requiresGuard ?? true,
      });
    }
  }
}

export function privateScopeForExpression(
  node: Node,
  context: SessionProvenanceContext,
  depth = 0,
): PrivateScopeProvenance | undefined {
  if (depth > 4) return undefined;
  const expression = unwrappedStaticExpressionNode(node);

  const direct = directPrivateScopeForExpression(expression);
  if (direct) return direct;

  if (Node.isIdentifier(expression)) {
    const key = resolvedSymbolKey(
      symbolForIdentifierReference(expression) ?? expression.getSymbol(),
    );
    if (
      (key ? context.opaqueAliases.get(key) : undefined) ??
      context.opaqueAliases.get(`name:${expression.getText()}`)
    ) {
      return undefined;
    }
    const alias =
      (key ? context.aliases.get(key) : undefined) ??
      [...context.aliases.values()].find((candidate) => candidate.name === expression.getText());
    return alias && (!alias.requiresGuard || sessionAliasGuardDominatesUse(alias, expression))
      ? { kind: alias.kind, path: alias.path }
      : undefined;
  }

  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    const base = privateScopeForExpression(expression.getExpression(), context, depth + 1);
    const name = staticAccessName(expression);
    return base && name
      ? { kind: base.kind, path: joinPrivateScopePath(base.path, name) }
      : undefined;
  }

  if (Node.isCallExpression(expression)) {
    const callee = unwrappedStaticExpressionNode(expression.getExpression());
    if (Node.isIdentifier(callee)) {
      const key = resolvedSymbolKey(symbolForIdentifierReference(callee) ?? callee.getSymbol());
      return (
        (key ? context.helpers.get(key) : undefined) ??
        context.helpers.get(`name:${callee.getText()}`)
      );
    }
  }

  return undefined;
}

export function opaqueAliasReasonForExpression(
  node: Node,
  context: SessionProvenanceContext,
): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isIdentifier(expression)) return undefined;
  const key = resolvedSymbolKey(symbolForIdentifierReference(expression) ?? expression.getSymbol());
  return (
    (key ? context.opaqueAliases.get(key) : undefined) ??
    context.opaqueAliases.get(`name:${expression.getText()}`)
  );
}

function unsummarizedHelperReasonForExpression(node: Node): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  return Node.isCallExpression(expression) ? unsummarizedHelperReason(expression) : undefined;
}

function directPrivateScopeForExpression(node: Node): PrivateScopeProvenance | undefined {
  const segments = staticAccessSegments(node);
  if (!segments) return undefined;
  for (const kind of ['guard', 'session', 'tenant'] as const) {
    const index = segments.path.indexOf(kind);
    if (index < 0) continue;
    return { kind, path: segments.path.slice(index + 1).join('.'), requiresGuard: true };
  }
  return undefined;
}

export function privateScopeKey(provenance: PrivateScopeProvenance): string {
  return `${provenance.kind}:${provenance.path}`;
}

function joinPrivateScopePath(base: string, segment: string): string {
  return base.length === 0 ? segment : `${base}.${segment}`;
}

function sessionAliasGuardDominatesUse(alias: SessionAlias, use: Node): boolean {
  const declared = blockStatementAncestor(alias.declaration);
  const used = blockStatementAncestor(use);
  if (!declared || !used || !sameSourceNode(declared.block, used.block)) {
    return false;
  }

  const statements = declared.block.getStatements();
  const declarationIndex = statements.findIndex((statement) =>
    sameSourceNode(statement, declared.statement),
  );
  const useIndex = statements.findIndex((statement) => sameSourceNode(statement, used.statement));
  if (declarationIndex < 0 || useIndex <= declarationIndex) {
    return false;
  }

  let guarded = false;
  for (const statement of statements.slice(declarationIndex + 1, useIndex)) {
    if (statementReassignsAlias(statement, alias.name)) return false;
    if (isAcceptedSessionGuard(statement, alias.name)) {
      guarded = true;
      continue;
    }
    if (!guarded && statementContainsAliasIdentifier(statement, alias.name)) {
      return false;
    }
  }

  return guarded;
}

function blockStatementAncestor(
  node: Node,
): { block: Node & { getStatements(): Node[] }; statement: Node } | undefined {
  let current: Node | undefined = node;
  while (current) {
    const parent = current.getParent();
    if (parent && Node.isBlock(parent)) {
      return { block: parent as Node & { getStatements(): Node[] }, statement: current };
    }
    current = parent;
  }
  return undefined;
}

function sameSourceNode(left: Node, right: Node): boolean {
  return (
    left.getSourceFile().getFilePath() === right.getSourceFile().getFilePath() &&
    left.getStart() === right.getStart() &&
    left.getEnd() === right.getEnd()
  );
}

function isAcceptedSessionGuard(statement: Node, aliasName: string): boolean {
  if (!Node.isIfStatement(statement)) return false;
  if (!isFalsyIdentifierCheck(statement.getExpression(), aliasName)) return false;
  return statementExits(statement.getThenStatement());
}

function isFalsyIdentifierCheck(expression: Node, aliasName: string): boolean {
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isPrefixUnaryExpression(node)) return false;
  if (node.getOperatorToken() !== SyntaxKind.ExclamationToken) return false;
  const operand = unwrappedStaticExpressionNode(node.getOperand());
  return Node.isIdentifier(operand) && operand.getText() === aliasName;
}

function statementExits(statement: Node): boolean {
  if (Node.isReturnStatement(statement) || Node.isThrowStatement(statement)) return true;
  if (Node.isBlock(statement)) {
    const [first] = statement.getStatements();
    return first ? statementExits(first) : false;
  }
  if (!Node.isExpressionStatement(statement)) return false;
  const expression = unwrappedStaticExpressionNode(statement.getExpression());
  if (!Node.isCallExpression(expression)) return false;
  const name = staticAccessName(expression.getExpression());
  return name === 'fail' || name === 'redirect' || name === 'notFound';
}

function statementReassignsAlias(statement: Node, aliasName: string): boolean {
  const expressions = statement.getDescendantsOfKind(SyntaxKind.BinaryExpression);
  for (const expression of expressions) {
    const operatorKind = expression.getOperatorToken().getKind();
    if (
      operatorKind !== SyntaxKind.EqualsToken &&
      operatorKind !== SyntaxKind.PlusEqualsToken &&
      operatorKind !== SyntaxKind.MinusEqualsToken &&
      operatorKind !== SyntaxKind.AsteriskEqualsToken &&
      operatorKind !== SyntaxKind.SlashEqualsToken
    ) {
      continue;
    }
    const left = unwrappedStaticExpressionNode(expression.getLeft());
    if (Node.isIdentifier(left) && left.getText() === aliasName) return true;
  }

  for (const expression of statement.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression)) {
    const operator = expression.getOperatorToken();
    if (operator !== SyntaxKind.PlusPlusToken && operator !== SyntaxKind.MinusMinusToken) continue;
    const operand = unwrappedStaticExpressionNode(expression.getOperand());
    if (Node.isIdentifier(operand) && operand.getText() === aliasName) return true;
  }
  for (const expression of statement.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression)) {
    const operator = expression.getOperatorToken();
    if (operator !== SyntaxKind.PlusPlusToken && operator !== SyntaxKind.MinusMinusToken) continue;
    const operand = unwrappedStaticExpressionNode(expression.getOperand());
    if (Node.isIdentifier(operand) && operand.getText() === aliasName) return true;
  }

  return false;
}

function statementContainsAliasIdentifier(statement: Node, aliasName: string): boolean {
  return statement
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some((identifier) => identifier.getText() === aliasName);
}

