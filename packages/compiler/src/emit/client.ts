import type { ElementParam, HandlerLowering } from '../lower/handlers.js';
import { dedupeBy, indent } from '../shared.js';

interface QueryDeriveFact {
  expression: string;
  exportName: string;
  input: string;
  name: string;
  param: string;
  selector: string;
}

interface QueryStampFact {
  attr: string;
  derive: QueryDeriveFact;
  selector: string;
}

interface QueryTemplateStampFact {
  itemBindings: readonly string[];
  key: string;
  list: string;
  selector: string;
  template: string;
}

interface QueryUpdatePlanFact {
  derives?: readonly QueryDeriveFact[];
  query: string;
  stamps?: readonly QueryStampFact[];
  templateStamps?: readonly QueryTemplateStampFact[];
}

export function emitClientModule(
  handlers: HandlerLowering[],
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
  componentName: string,
  irHeader: string,
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

  return `${irHeader}
${importLine}${exports || '// no client handlers emitted'}
`;
}

function emitHandlerBody(handler: HandlerLowering): string {
  const namedHandler = /^[A-Za-z_$][\w$]*$/.test(handler.expression);
  if (namedHandler) {
    return `return ${handler.expression}(event, ctx);`;
  }

  const arrowBody = arrowExpressionBody(handler.expression);
  if (!arrowBody) return '// unsupported handler expression was preserved as a diagnostic surface';
  if (arrowBody.startsWith('{') && arrowBody.endsWith('}')) {
    return lowerHandlerExpression(arrowBody.slice(1, -1).trim(), handler.params);
  }

  return `return ${lowerHandlerExpression(arrowBody, handler.params)};`;
}

function arrowExpressionBody(expression: string): string | null {
  const arrow = /^\(\)\s*=>\s*(?<body>[\s\S]+)$/.exec(expression);
  const body = arrow?.groups?.body;
  return body ? body.trim() : null;
}

function lowerHandlerExpression(expression: string, params: readonly ElementParam[]): string {
  let lowered = expression.replace(/\bstate\b/g, 'ctx.state');

  for (const param of params) {
    const sourceExpression = param.value.slice(1, -1);
    if (!sourceExpression) continue;

    lowered = lowered.replace(
      new RegExp(`(?<![\\w$])${escapeRegExp(sourceExpression)}(?![\\w$])`, 'g'),
      `ctx.params.${paramNameFromAttribute(param.attributeName)}`,
    );
  }

  return lowered;
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
      `      html = html.replace(${JSON.stringify(bindingValuePlaceholder(stamp.template, binding))}, String(read(${JSON.stringify(binding.slice(1))}) ?? ""));`,
  )
  .join('\n')}
      return html;
    } }`;
}

function bindingValuePlaceholder(template: string, binding: string): string {
  const match = new RegExp(
    `(<[^>]+\\bdata-bind=(["'])${escapeRegExp(binding)}\\2[^>]*>)(?<value>[\\s\\S]*?)(</[^>]+>)`,
  ).exec(template);
  return match?.groups?.value ?? '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
