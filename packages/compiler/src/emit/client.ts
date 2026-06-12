import ts from 'typescript';

import { compilerIrHeader } from '../ir.js';
import { applySourceReplacements, dedupeBy, indent, type SourceReplacement } from '../shared.js';
import type {
  ElementParam,
  HandlerLowering,
  QueryDeriveFact,
  QueryStampFact,
  QueryTemplateStampFact,
  QueryUpdatePlanFact,
} from '../types.js';

export function emitClientModule(
  handlers: HandlerLowering[],
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
  componentName: string,
): string {
  const imports = [
    ...(queryUpdatePlans.length > 0 ? ['applyCompiledQueryUpdatePlan'] : []),
    ...(queryUpdatePlans.some(
      (plan) => (plan.derives?.length ?? 0) > 0 || (plan.stamps?.length ?? 0) > 0,
    )
      ? ['derive']
      : []),
    ...(handlers.length > 0 ? ['handler'] : []),
  ].sort();
  const importLine =
    imports.length > 0 ? `import { ${imports.join(', ')} } from '@jiso/runtime';\n\n` : '';
  const handlerExports = handlers.length
    ? handlers
        .map(
          (handler) =>
            `export const ${handler.exportName} = handler((event, ctx) => {\n${indent(emitHandlerBody(handler))}\n});`,
        )
        .join('\n')
    : '';
  const queryPlanExport = emitQueryUpdatePlanExport(componentName, queryUpdatePlans);
  const exports = [handlerExports, queryPlanExport].filter(Boolean).join('\n\n');

  return `${compilerIrHeader}
${importLine}${exports || '// no client handlers emitted'}
`;
}

function emitHandlerBody(handler: HandlerLowering): string {
  const namedHandler = /^[A-Za-z_$][\w$]*$/.test(handler.expression);
  if (namedHandler) {
    return `return ${handler.expression}(event, ctx);`;
  }

  const arrowBody = handler.arrowBody ?? arrowFunctionBody(handler.expression);
  if (!arrowBody) return '// unsupported handler expression was preserved as a diagnostic surface';
  if (arrowBody.kind === 'block') {
    return lowerHandlerExpression(arrowBody.source, handler.params);
  }

  return `return ${lowerHandlerExpression(arrowBody.source, handler.params)};`;
}

function arrowFunctionBody(
  expression: string,
): { kind: 'block' | 'expression'; source: string } | null {
  const sourceFile = ts.createSourceFile(
    'handler-expression.ts',
    `const __jiso_handler__ = ${expression};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let body: { kind: 'block' | 'expression'; source: string } | null = null;

  const visit = (node: ts.Node): void => {
    if (body !== null) return;

    if (ts.isArrowFunction(node) && node.parameters.length === 0) {
      const expressionBody = node.body;
      body = ts.isBlock(expressionBody)
        ? {
            kind: 'block',
            source: expressionBody
              .getSourceFile()
              .text.slice(expressionBody.getStart(sourceFile) + 1, expressionBody.getEnd() - 1)
              .trim(),
          }
        : {
            kind: 'expression',
            source: expressionBody.getText(sourceFile).trim(),
          };
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return body;
}

function lowerHandlerExpression(expression: string, params: readonly ElementParam[]): string {
  const replacements: SourceReplacement[] = [];
  const sourceFile = ts.createSourceFile(
    'handler-expression.ts',
    `function __jiso_handler__() {\n${expression}\n}`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const offset = 'function __jiso_handler__() {\n'.length;
  const paramReplacements = params
    .map((param) => ({
      param,
      sourceExpression: param.value.slice(1, -1),
    }))
    .filter((entry) => entry.sourceExpression.length > 0)
    .sort((left, right) => right.sourceExpression.length - left.sourceExpression.length);

  const visit = (node: ts.Node): void => {
    for (const { param, sourceExpression } of paramReplacements) {
      if (
        isSerializableExpressionNode(node) &&
        node.getText(sourceFile) === sourceExpression &&
        !hasReplacementAncestor(node, sourceFile, paramReplacements)
      ) {
        replacements.push({
          end: node.getEnd() - offset,
          replacement: `ctx.params.${paramNameFromAttribute(param.attributeName)}`,
          start: node.getStart(sourceFile) - offset,
        });
        return;
      }
    }

    if (ts.isIdentifier(node) && node.text === 'state' && !isPropertyName(node)) {
      replacements.push({
        end: node.getEnd() - offset,
        replacement: 'ctx.state',
        start: node.getStart(sourceFile) - offset,
      });
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return applySourceReplacements(expression, replacements);
}

function isSerializableExpressionNode(node: ts.Node): boolean {
  return (
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  );
}

function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isShorthandPropertyAssignment(parent) && parent.name === node)
  );
}

function hasReplacementAncestor(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  replacements: readonly { sourceExpression: string }[],
): boolean {
  let current = node.parent;

  while (current) {
    if (
      isSerializableExpressionNode(current) &&
      replacements.some(
        (replacement) => current.getText(sourceFile) === replacement.sourceExpression,
      )
    ) {
      return true;
    }
    current = current.parent;
  }

  return false;
}

function paramNameFromAttribute(attributeName: string): string {
  return attributeName
    .replace(/^data-p-/, '')
    .replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function emitQueryUpdatePlanExport(
  componentName: string,
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
): string {
  if (queryUpdatePlans.length === 0) return '';

  const derives = dedupeBy(
    queryUpdatePlans.flatMap((plan) => [
      ...(plan.derives ?? []),
      ...(plan.stamps ?? []).map((stamp) => stamp.derive),
    ]),
    (derive) => derive.exportName,
  );
  const deriveExports = derives
    .map(
      (derive) =>
        `export const ${derive.exportName} = derive([${JSON.stringify(derive.input)}], (${derive.param}) => ${derive.expression});`,
    )
    .join('\n');
  const entries = queryUpdatePlans
    .map(
      (plan) =>
        `  ${JSON.stringify(plan.query)}(root, value) {\n    return applyCompiledQueryUpdatePlan(root, ${JSON.stringify(plan.query)}, value, { bindings: true, derives: [${plan.derives?.map(emitDerivePlan).join(', ') ?? ''}], stamps: [${plan.stamps?.map(emitStampPlan).join(', ') ?? ''}], templateStamps: [${plan.templateStamps?.map(emitTemplateStampPlan).join(', ') ?? ''}] });\n  },`,
    )
    .join('\n');

  return `${deriveExports ? `${deriveExports}\n\n` : ''}export const ${componentName}$queryUpdatePlans = {\n${entries}\n};`;
}

function emitDerivePlan(derive: QueryDeriveFact): string {
  return `{ name: ${JSON.stringify(derive.name)}, selector: ${JSON.stringify(derive.selector)}, select(value) { return ${derive.exportName}.run(value); } }`;
}

function emitStampPlan(stamp: QueryStampFact): string {
  return `{ attr: ${JSON.stringify(stamp.attr)}, selector: ${JSON.stringify(stamp.selector)}, select(value) { return ${stamp.derive.exportName}.run(value); } }`;
}

function emitTemplateStampPlan(stamp: QueryTemplateStampFact): string {
  const placeholders = new Map(
    stamp.itemBindingPlaceholders?.map((placeholder) => [placeholder.path, placeholder.value]) ??
      [],
  );

  return `{ key: ${JSON.stringify(stamp.key)}, list: ${JSON.stringify(
    stamp.list.split('.').slice(1).join('.'),
  )}, selector: ${JSON.stringify(stamp.selector)}, render(item) {
      const record = item && typeof item === "object" ? item : {};
      const read = (path) => path.split(".").reduce((value, part) => {
        const key = part.endsWith("?") ? part.slice(0, -1) : part;
        return value && typeof value === "object" ? value[key] : undefined;
      }, record);
      let html = ${JSON.stringify(stamp.template)};
${stamp.itemBindings
  .map(
    (binding) =>
      `      html = html.replace(${JSON.stringify(placeholders.get(binding) ?? '')}, String(read(${JSON.stringify(binding.slice(1))}) ?? ""));`,
  )
  .join('\n')}
      return html;
    } }`;
}
