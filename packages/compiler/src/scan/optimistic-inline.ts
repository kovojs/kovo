import { createRequire } from 'node:module';
import * as ts from 'typescript';

import { deriveMutationKey } from '../mutation-names.js';
import { deriveRegistryIdentity } from '../registry-identities.js';

const mutableTs = ts as unknown as Record<string, unknown>;
if (!('ScriptTarget' in mutableTs))
  Object.assign(mutableTs, createRequire(import.meta.url)('typescript') as typeof ts);

/** @internal One lowered optimistic query entry from authored source. */
export interface InlineOptimisticTransformFact {
  query: string;
  source: string;
  status: 'await-fragment' | 'hand-written';
  /**
   * SPEC §10.2/§10.4: the source of the instance-key derivation when this transform targets a
   * keyed query INSTANCE (`questionDetail:q3` vs `questionDetail:q7`). Captured as a typed
   * lowering fact (§5.2 #9) — from the per-entry `{ keys, transform }` object form or a sibling
   * `keys` map — so the emitter can lower it into `OptimisticPlan.keys` rather than re-deriving it
   * from a source-string heuristic. Absent for unkeyed transforms.
   */
  keys?: string;
}

/** @internal A source-level optimistic plan lowered to the shared transform-plan IR. */
export interface InlineOptimisticPlanFact {
  localName: string;
  mutation?: string;
  queue?: string;
  transforms: readonly InlineOptimisticTransformFact[];
}

/** @internal Optional module resolver used when optimistic plans reference imported query values. */
export interface InlineOptimisticScanOptions {
  resolveStaticImport?: (
    fromFileName: string,
    moduleSpecifier: string,
  ) => { fileName: string; source: string } | null;
}

/**
 * @internal Extract inline `mutation({ optimistic })` plans and standalone
 * draft-style `{ queue, transforms }` plans into the same canonical IR.
 *
 * SPEC.md §10.4 and §5.2: authored sugar lowers to a reviewable transform plan;
 * this is the source boundary that keeps inline mutation optimism and standalone
 * `OptimisticFor`-style escape hatches byte-comparable in compiler fixtures.
 */
export function inlineOptimisticPlansFromSource(
  fileName: string,
  source: string,
  options: InlineOptimisticScanOptions = {},
): readonly InlineOptimisticPlanFact[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const facts: InlineOptimisticPlanFact[] = [];
  const localQueryKeys = collectQueryKeys(sourceFile, options);
  const localQueueNames = collectLocalQueueNames(sourceFile);

  const visit = (node: ts.Node): void => {
    const fact = optimisticPlanFromVariable(sourceFile, localQueryKeys, localQueueNames, node);
    if (fact) facts.push(fact);
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return facts;
}

/** @internal Serialize the canonical transform-plan IR for fixpoint fixtures. */
export function serializeInlineOptimisticPlanIr(plan: InlineOptimisticPlanFact): string {
  const lines = [
    `plan ${plan.localName}${plan.mutation ? ` mutation=${JSON.stringify(plan.mutation)}` : ''}`,
    ...(plan.queue === undefined ? [] : [`queue ${JSON.stringify(plan.queue)}`]),
    ...plan.transforms.flatMap((transform) => [
      `${transform.query} ${transform.source}`,
      // SPEC §10.2/§10.4: a keyed transform's instance-key derivation is part of the lowered
      // plan, so it must appear in the fixpoint IR or recompilation would drop the instance key.
      ...(transform.keys === undefined ? [] : [`${transform.query} keys ${transform.keys}`]),
    ]),
  ];
  return `${lines.join('\n')}\n`;
}

function optimisticPlanFromVariable(
  sourceFile: ts.SourceFile,
  localQueryKeys: ReadonlyMap<string, string>,
  localQueueNames: ReadonlyMap<string, string>,
  node: ts.Node,
): InlineOptimisticPlanFact | null {
  if (!ts.isVariableDeclaration(node)) return null;
  if (!ts.isIdentifier(node.name)) return null;

  const initializer = unwrapTsExpression(node.initializer);
  if (!initializer) return null;

  const inline = inlineMutationOptimisticPlan(
    sourceFile,
    localQueryKeys,
    localQueueNames,
    node.name.text,
    initializer,
  );
  if (inline) return inline;

  return standaloneOptimisticPlan(
    sourceFile,
    localQueryKeys,
    localQueueNames,
    node.name.text,
    initializer,
  );
}

function inlineMutationOptimisticPlan(
  sourceFile: ts.SourceFile,
  localQueryKeys: ReadonlyMap<string, string>,
  localQueueNames: ReadonlyMap<string, string>,
  localName: string,
  initializer: ts.Expression,
): InlineOptimisticPlanFact | null {
  if (!ts.isCallExpression(initializer)) return null;
  if (!ts.isIdentifier(initializer.expression) || initializer.expression.text !== 'mutation') {
    return null;
  }

  const [firstArg, secondArg] = initializer.arguments;
  const key =
    firstArg && ts.isStringLiteralLike(firstArg)
      ? firstArg.text
      : firstArg && ts.isObjectLiteralExpression(firstArg)
        ? deriveMutationKey(sourceFile.fileName, localName)
        : undefined;
  const optionsArg =
    firstArg && ts.isStringLiteralLike(firstArg)
      ? secondArg
      : firstArg && ts.isObjectLiteralExpression(firstArg)
        ? firstArg
        : undefined;
  if (key === undefined) return null;
  if (!optionsArg || !ts.isObjectLiteralExpression(optionsArg)) return null;

  const optimistic = objectPropertyExpression(optionsArg, 'optimistic');
  const optimisticObject = unwrapTsExpression(optimistic);
  if (!optimisticObject || !ts.isObjectLiteralExpression(optimisticObject)) return null;

  const queue = mutationQueuePropertyValue(optionsArg, key, localQueueNames);
  return {
    localName,
    mutation: key,
    ...(queue === undefined ? {} : { queue }),
    transforms: optimisticTransformsFromObject(sourceFile, localQueryKeys, optimisticObject),
  };
}

function standaloneOptimisticPlan(
  sourceFile: ts.SourceFile,
  localQueryKeys: ReadonlyMap<string, string>,
  localQueueNames: ReadonlyMap<string, string>,
  localName: string,
  initializer: ts.Expression,
): InlineOptimisticPlanFact | null {
  if (!ts.isObjectLiteralExpression(initializer)) return null;

  const transformsObject = unwrapTsExpression(objectPropertyExpression(initializer, 'transforms'));
  if (!transformsObject || !ts.isObjectLiteralExpression(transformsObject)) return null;

  const queue = queuePropertyValue(initializer, localQueueNames);
  const transforms = optimisticTransformsFromObject(sourceFile, localQueryKeys, transformsObject);
  // SPEC §10.2/§10.4: the standalone `OptimisticFor` object form carries instance-key derivations
  // in a sibling `keys` map (mirroring the runtime `OptimisticPlan.keys`); fold each into its
  // transform fact so both authoring shapes lower the same keyed plan.
  const keysObject = unwrapTsExpression(objectPropertyExpression(initializer, 'keys'));
  const merged =
    keysObject && ts.isObjectLiteralExpression(keysObject)
      ? mergeSiblingKeyDerivations(sourceFile, localQueryKeys, transforms, keysObject)
      : transforms;
  return {
    localName,
    ...(queue === undefined ? {} : { queue }),
    transforms: merged,
  };
}

function mutationQueuePropertyValue(
  object: ts.ObjectLiteralExpression,
  mutationKey: string,
  localQueueNames: ReadonlyMap<string, string>,
): string | undefined {
  const unwrapped = unwrapTsExpression(objectPropertyExpression(object, 'queue'));
  if (unwrapped?.kind === ts.SyntaxKind.TrueKeyword) return mutationKey;
  if (unwrapped && ts.isStringLiteralLike(unwrapped)) return unwrapped.text;
  return queueNameFromExpression(unwrapped, localQueueNames);
}

function mergeSiblingKeyDerivations(
  sourceFile: ts.SourceFile,
  localQueryKeys: ReadonlyMap<string, string>,
  transforms: readonly InlineOptimisticTransformFact[],
  keysObject: ts.ObjectLiteralExpression,
): InlineOptimisticTransformFact[] {
  const derivations = new Map<string, string>();
  for (const property of keysObject.properties) {
    const query = queryNameFromPropertyName(property.name, localQueryKeys);
    const valueNode = objectMemberValueNode(property);
    if (query && valueNode) derivations.set(query, valueNode.getText(sourceFile));
  }
  return transforms.map((transform) => {
    const keys = derivations.get(transform.query);
    return keys === undefined ? transform : { ...transform, keys };
  });
}

function optimisticTransformsFromObject(
  sourceFile: ts.SourceFile,
  localQueryKeys: ReadonlyMap<string, string>,
  object: ts.ObjectLiteralExpression,
): InlineOptimisticTransformFact[] {
  return object.properties.flatMap<InlineOptimisticTransformFact>((property) => {
    const query = queryNameFromPropertyName(property.name, localQueryKeys);
    if (!query) return [];

    if (ts.isPropertyAssignment(property)) {
      const initializer = unwrapTsExpression(property.initializer);
      if (initializer && isAwaitFragmentLiteral(initializer)) {
        return [{ query, source: `${query}: 'await-fragment'`, status: 'await-fragment' }];
      }
      // SPEC §10.2/§10.4: the per-entry keyed form `{ keys, transform }` co-locates the
      // instance-key derivation with the transform it targets — capture both as typed facts.
      if (initializer && ts.isObjectLiteralExpression(initializer)) {
        const keyed = keyedEntryFromObject(sourceFile, query, initializer);
        if (keyed) return [keyed];
      }
    }

    return [
      {
        query,
        source: property.getText(sourceFile),
        status: 'hand-written',
      },
    ];
  });
}

function keyedEntryFromObject(
  sourceFile: ts.SourceFile,
  query: string,
  object: ts.ObjectLiteralExpression,
): InlineOptimisticTransformFact | null {
  const keys = objectMemberValueNode(findObjectMember(object, 'keys'));
  const transform = objectMemberValueNode(findObjectMember(object, 'transform'));
  if (!keys || !transform) return null;
  return {
    query,
    source: transform.getText(sourceFile),
    status: 'hand-written',
    keys: keys.getText(sourceFile),
  };
}

function findObjectMember(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => propertyNameText(property.name) === name);
}

/**
 * The source-bearing node for an object member's value: a property assignment's initializer,
 * or the whole member for a method shorthand (`transform(draft, input) { … }`).
 */
function objectMemberValueNode(
  member: ts.ObjectLiteralElementLike | undefined,
): ts.Node | undefined {
  if (!member) return undefined;
  if (ts.isPropertyAssignment(member)) return member.initializer;
  if (ts.isMethodDeclaration(member)) return member;
  return undefined;
}

function objectPropertyExpression(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.Expression | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.name) === propertyName) return property.initializer;
  }
  return null;
}

function queuePropertyValue(
  object: ts.ObjectLiteralExpression,
  localQueueNames: ReadonlyMap<string, string>,
): string | undefined {
  const expression = unwrapTsExpression(objectPropertyExpression(object, 'queue'));
  if (expression && ts.isStringLiteralLike(expression)) return expression.text;
  return queueNameFromExpression(expression, localQueueNames);
}

function queueNameFromExpression(
  expression: ts.Expression | null | undefined,
  localQueueNames: ReadonlyMap<string, string>,
): string | undefined {
  if (expression && ts.isIdentifier(expression)) return localQueueNames.get(expression.text);
  return undefined;
}

function collectLocalQueueNames(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const initializer = unwrapTsExpression(declaration.initializer);
      if (!initializer) continue;
      if (ts.isStringLiteralLike(initializer)) {
        bindings.set(declaration.name.text, initializer.text);
        continue;
      }
      if (!ts.isCallExpression(initializer)) continue;
      const [firstArg] = initializer.arguments;
      if (
        ts.isIdentifier(initializer.expression) &&
        initializer.expression.text === 'queue' &&
        firstArg &&
        ts.isStringLiteralLike(firstArg)
      ) {
        bindings.set(declaration.name.text, firstArg.text);
      }
    }
  }
  return bindings;
}

function collectQueryKeys(
  sourceFile: ts.SourceFile,
  options: InlineOptimisticScanOptions,
): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>();
  for (const [localName, key] of collectImportedQueryKeys(sourceFile, options)) {
    bindings.set(localName, key);
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const initializer = unwrapTsExpression(declaration.initializer);
      if (!initializer || !ts.isCallExpression(initializer)) continue;
      const derivedKey = queryKeyFromCall(
        sourceFile,
        declaration.name.text,
        statement,
        initializer,
      );
      if (derivedKey) bindings.set(declaration.name.text, derivedKey);
    }
  }
  return bindings;
}

function collectImportedQueryKeys(
  sourceFile: ts.SourceFile,
  options: InlineOptimisticScanOptions,
): ReadonlyMap<string, string> {
  const resolveStaticImport = options.resolveStaticImport;
  if (!resolveStaticImport) return new Map();

  const bindings = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!statement.importClause?.namedBindings) continue;
    if (!ts.isNamedImports(statement.importClause.namedBindings)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;

    const imported = resolveStaticImport(sourceFile.fileName, statement.moduleSpecifier.text);
    if (!imported) continue;
    const importedSourceFile = ts.createSourceFile(
      imported.fileName,
      imported.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const exportedQueryKeys = collectExportedQueryKeys(importedSourceFile);
    for (const element of statement.importClause.namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      const key = exportedQueryKeys.get(importedName);
      if (key) bindings.set(element.name.text, key);
    }
  }
  return bindings;
}

function collectExportedQueryKeys(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!isExportedStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const initializer = unwrapTsExpression(declaration.initializer);
      if (!initializer || !ts.isCallExpression(initializer)) continue;
      const key = queryKeyFromCall(sourceFile, declaration.name.text, statement, initializer);
      if (key) bindings.set(declaration.name.text, key);
    }
  }
  return bindings;
}

function queryKeyFromCall(
  sourceFile: ts.SourceFile,
  localName: string,
  statement: ts.VariableStatement,
  call: ts.CallExpression,
): string | null {
  if (!isQueryCallExpression(call.expression)) return null;
  const [firstArg] = call.arguments;
  if (firstArg && ts.isStringLiteralLike(firstArg)) return firstArg.text;
  if (firstArg && ts.isObjectLiteralExpression(firstArg) && isExportedStatement(statement)) {
    return deriveRegistryIdentity(sourceFile.fileName, localName).key;
  }
  return null;
}

function isQueryCallExpression(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === 'query';
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'elevated' &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'query'
  );
}

function isExportedStatement(statement: ts.VariableStatement): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

function queryNameFromPropertyName(
  name: ts.PropertyName | undefined,
  localQueryKeys: ReadonlyMap<string, string>,
): string | null {
  if (!name) return null;
  if (ts.isComputedPropertyName(name))
    return queryNameFromComputedExpression(name.expression, localQueryKeys);
  return propertyNameText(name);
}

function queryNameFromComputedExpression(
  expression: ts.Expression,
  localQueryKeys: ReadonlyMap<string, string>,
): string | null {
  const unwrapped = unwrapTsExpression(expression);
  if (unwrapped && ts.isIdentifier(unwrapped)) {
    return localQueryKeys.get(unwrapped.text) ?? null;
  }
  if (
    unwrapped &&
    ts.isPropertyAccessExpression(unwrapped) &&
    unwrapped.name.text === 'key' &&
    ts.isIdentifier(unwrapped.expression)
  ) {
    return localQueryKeys.get(unwrapped.expression.text) ?? null;
  }
  return null;
}

function propertyNameText(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function isAwaitFragmentLiteral(expression: ts.Expression): boolean {
  return ts.isStringLiteralLike(expression) && expression.text === 'await-fragment';
}

function unwrapTsExpression(expression: ts.Expression | null | undefined): ts.Expression | null {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current ?? null;
}
