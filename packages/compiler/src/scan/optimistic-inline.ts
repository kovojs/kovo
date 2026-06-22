import { createRequire } from 'node:module';
import * as ts from 'typescript';

const mutableTs = ts as unknown as Record<string, unknown>;
if (!('ScriptTarget' in mutableTs))
  Object.assign(mutableTs, createRequire(import.meta.url)('typescript') as typeof ts);

/** @internal One lowered optimistic query entry from authored source. */
export interface InlineOptimisticTransformFact {
  query: string;
  source: string;
  status: 'await-fragment' | 'hand-written';
}

/** @internal A source-level optimistic plan lowered to the shared transform-plan IR. */
export interface InlineOptimisticPlanFact {
  localName: string;
  mutation?: string;
  queue?: string;
  transforms: readonly InlineOptimisticTransformFact[];
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
): readonly InlineOptimisticPlanFact[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const facts: InlineOptimisticPlanFact[] = [];

  const visit = (node: ts.Node): void => {
    const fact = optimisticPlanFromVariable(sourceFile, node);
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
    ...plan.transforms.map((transform) => `${transform.query} ${transform.source}`),
  ];
  return `${lines.join('\n')}\n`;
}

function optimisticPlanFromVariable(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): InlineOptimisticPlanFact | null {
  if (!ts.isVariableDeclaration(node)) return null;
  if (!ts.isIdentifier(node.name)) return null;

  const initializer = unwrapTsExpression(node.initializer);
  if (!initializer) return null;

  const inline = inlineMutationOptimisticPlan(sourceFile, node.name.text, initializer);
  if (inline) return inline;

  return standaloneOptimisticPlan(sourceFile, node.name.text, initializer);
}

function inlineMutationOptimisticPlan(
  sourceFile: ts.SourceFile,
  localName: string,
  initializer: ts.Expression,
): InlineOptimisticPlanFact | null {
  if (!ts.isCallExpression(initializer)) return null;
  if (!ts.isIdentifier(initializer.expression) || initializer.expression.text !== 'mutation') {
    return null;
  }

  const [keyArg, optionsArg] = initializer.arguments;
  if (!keyArg || !ts.isStringLiteralLike(keyArg)) return null;
  if (!optionsArg || !ts.isObjectLiteralExpression(optionsArg)) return null;

  const optimistic = objectPropertyExpression(optionsArg, 'optimistic');
  const optimisticObject = unwrapTsExpression(optimistic);
  if (!optimisticObject || !ts.isObjectLiteralExpression(optimisticObject)) return null;

  const queue = stringPropertyValue(optionsArg, 'queue');
  return {
    localName,
    mutation: keyArg.text,
    ...(queue === undefined ? {} : { queue }),
    transforms: optimisticTransformsFromObject(sourceFile, optimisticObject),
  };
}

function standaloneOptimisticPlan(
  sourceFile: ts.SourceFile,
  localName: string,
  initializer: ts.Expression,
): InlineOptimisticPlanFact | null {
  if (!ts.isObjectLiteralExpression(initializer)) return null;

  const transforms = objectPropertyExpression(initializer, 'transforms');
  const transformsObject = unwrapTsExpression(transforms);
  if (!transformsObject || !ts.isObjectLiteralExpression(transformsObject)) return null;

  const queue = stringPropertyValue(initializer, 'queue');
  return {
    localName,
    ...(queue === undefined ? {} : { queue }),
    transforms: optimisticTransformsFromObject(sourceFile, transformsObject),
  };
}

function optimisticTransformsFromObject(
  sourceFile: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
): InlineOptimisticTransformFact[] {
  return object.properties.flatMap<InlineOptimisticTransformFact>((property) => {
    const query = propertyNameText(property.name);
    if (!query) return [];

    if (ts.isPropertyAssignment(property)) {
      const initializer = unwrapTsExpression(property.initializer);
      if (initializer && isAwaitFragmentLiteral(initializer)) {
        return [{ query, source: `${query}: 'await-fragment'`, status: 'await-fragment' }];
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

function stringPropertyValue(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): string | undefined {
  const expression = unwrapTsExpression(objectPropertyExpression(object, propertyName));
  return expression && ts.isStringLiteralLike(expression) ? expression.text : undefined;
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
