import { compilerIrHeader } from '../ir.js';
import {
  runtimeOutputHelpers,
  templateStampHtmlEscapeExpression,
} from '../security/output-context.js';
import { applySourceReplacements, dedupeBy, indent, type SourceReplacement } from '../shared.js';
import { elementParamNameFromAttribute } from '../types.js';
import type {
  ClientConstantDependency,
  ClientImportDependency,
  ElementParam,
  HandlerArrowBody,
  HandlerLowering,
  ClockUpdatePlanFact,
  QueryDeriveFact,
  QueryStampFact,
  QueryTemplateStampFact,
  QueryUpdatePlanFact,
  StateDeriveFact,
} from '../types.js';

const RUNTIME_GENERATED_IMPORT = '@kovojs/browser/generated';

export function emitClientModule(
  handlers: HandlerLowering[],
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
  stateDerives: readonly StateDeriveFact[],
  componentName: string,
  clockUpdatePlans: readonly ClockUpdatePlanFact[] = [],
): string {
  const imports = [
    ...(queryUpdatePlans.length > 0 ? ['applyCompiledQueryUpdatePlan'] : []),
    ...(stateDerives.length > 0 ||
    queryUpdatePlans.some(
      (plan) => (plan.derives?.length ?? 0) > 0 || (plan.stamps?.length ?? 0) > 0,
    )
      ? ['derive']
      : []),
    ...(queryUpdatePlans.some((plan) => (plan.templateStamps?.length ?? 0) > 0)
      ? [runtimeOutputHelpers.escapeHtml]
      : []),
    ...runtimeOutputHelperImports([...queryUpdatePlans], stateDerives),
    ...(handlers.length > 0 ? ['handler'] : []),
    ...(clockUpdatePlans.length > 0 ? ['installClockUpdatePlans'] : []),
  ].sort();
  const importLine =
    imports.length > 0
      ? `import { ${imports.join(', ')} } from '${RUNTIME_GENERATED_IMPORT}';\n\n`
      : '';
  const dependencyImportLines = emitClientImportDependencies(
    handlers.flatMap((handler) => [...(handler.clientImports ?? [])]),
  );
  const dependencyConstantLines = emitClientConstantDependencies(
    handlers.flatMap((handler) => [...(handler.clientConstants ?? [])]),
  );
  const handlerExports = handlers.length ? handlers.map(emitHandlerExport).join('\n') : '';
  const stateDeriveExports = stateDerives.map(emitStateDeriveExport).join('\n');
  const queryPlanExport = emitQueryUpdatePlanExport(componentName, queryUpdatePlans);
  const clockPlanExport = emitClockUpdatePlanExport(componentName, clockUpdatePlans);
  const exports = [handlerExports, stateDeriveExports, queryPlanExport, clockPlanExport]
    .filter(Boolean)
    .join('\n\n');

  return `${compilerIrHeader}
${importLine}${dependencyImportLines}${dependencyConstantLines}${exports || '// no client handlers emitted'}
`;
}

function emitClockUpdatePlanExport(
  componentName: string,
  clockUpdatePlans: readonly ClockUpdatePlanFact[],
): string {
  if (clockUpdatePlans.length === 0) return '';

  const plan = clockUpdatePlans[0];
  if (!plan) return '';

  const clocks = plan.clocks
    .map((clock) => `${JSON.stringify(clock.name)}: ${clock.spec}`)
    .join(', ');

  return `export const ${componentName}$clockUpdatePlans = [{
  clocks: { ${clocks} },
  update(root, now, context) {
    return ${componentName}$queryUpdatePlans.now(root, now, context);
  },
}];

export function install${componentName}ClockUpdates(root) {
  return installClockUpdatePlans(root, ${componentName}$clockUpdatePlans);
}`;
}

function emitClientImportDependencies(imports: readonly ClientImportDependency[]): string {
  const entriesByModule = new Map<string, ClientImportDependency[]>();

  for (const item of dedupeBy(
    imports,
    (entry) => `${entry.moduleSpecifier}\0${entry.importedName}\0${entry.localName}`,
  )) {
    entriesByModule.set(item.moduleSpecifier, [
      ...(entriesByModule.get(item.moduleSpecifier) ?? []),
      item,
    ]);
  }

  return [...entriesByModule]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([moduleSpecifier, entries]) => {
      const specifiers = entries
        .sort((left, right) => left.localName.localeCompare(right.localName))
        .map((entry) =>
          entry.importedName === entry.localName
            ? entry.importedName
            : `${entry.importedName} as ${entry.localName}`,
        )
        .join(', ');
      return `import { ${specifiers} } from ${JSON.stringify(moduleSpecifier)};\n\n`;
    })
    .join('');
}

function emitClientConstantDependencies(constants: readonly ClientConstantDependency[]): string {
  const lines = dedupeBy(constants, (entry) => `${entry.name}\0${entry.source}`)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `const ${entry.name} = ${entry.source};`);

  return lines.length > 0 ? `${lines.join('\n')}\n\n` : '';
}

function emitStateDeriveExport(deriveFact: StateDeriveFact): string {
  return `export const ${deriveFact.exportName} = derive(["state"], (state) => ${deriveFact.expression});`;
}

function emitHandlerExport(handler: HandlerLowering): string {
  const body = emitHandlerBody(handler);
  const eventParam = /\bevent\b/.test(body) ? 'event' : '_event';
  const contextParam = /\bctx\b/.test(body) ? 'ctx' : '_ctx';

  return `export const ${handler.exportName} = handler((${eventParam}, ${contextParam}) => {\n${indent(body)}\n});`;
}

function emitHandlerBody(handler: HandlerLowering): string {
  // SPEC §5.2: reuse the typed lowering fact instead of re-deciding bare-named-ness from the raw
  // `expression` snippet at emit time.
  if (handler.isBareNamedHandler) {
    return `return ${handler.expression}(event, ctx);`;
  }

  const arrowBody = handler.arrowBody;
  if (!arrowBody) return '// unsupported handler expression was preserved as a diagnostic surface';
  if (arrowBody.kind === 'block') {
    return lowerHandlerArrowBody(arrowBody, handler.params);
  }

  return `return ${lowerHandlerArrowBody(arrowBody, handler.params)};`;
}

function lowerHandlerArrowBody(body: HandlerArrowBody, params: readonly ElementParam[]): string {
  return applySourceReplacements(body.source, handlerArrowBodyReplacements(body, params));
}

function handlerArrowBodyReplacements(
  body: HandlerArrowBody,
  params: readonly ElementParam[],
): SourceReplacement[] {
  const replacements: SourceReplacement[] = [];
  const paramReplacements = params
    .map((param) => ({
      param,
      sourceExpression: param.expression,
    }))
    .filter((entry) => entry.sourceExpression.length > 0)
    .sort((left, right) => right.sourceExpression.length - left.sourceExpression.length);

  for (const access of body.propertyAccesses) {
    const param = paramReplacements.find((entry) => entry.sourceExpression === access.path)?.param;
    if (param) {
      replacements.push({
        end: access.end,
        replacement: `ctx.params.${elementParamNameFromAttribute(param.attributeName)}`,
        start: access.start,
      });
      continue;
    }

    if (access.path === 'state' || access.path.startsWith('state.')) {
      replacements.push({
        end: access.start + 'state'.length,
        replacement: 'ctx.state',
        start: access.start,
      });
    }
  }

  for (const reference of body.references ?? []) {
    const param = paramReplacements.find(
      (entry) => entry.sourceExpression === reference.name,
    )?.param;
    if (param) {
      replacements.push({
        end: reference.end,
        replacement: `ctx.params.${elementParamNameFromAttribute(param.attributeName)}`,
        start: reference.start,
      });
      continue;
    }

    if (reference.name !== 'state') continue;
    if (
      replacements.some(
        (replacement) => reference.start >= replacement.start && reference.end <= replacement.end,
      )
    ) {
      continue;
    }

    replacements.push({
      end: reference.end,
      replacement: 'ctx.state',
      start: reference.start,
    });
  }

  return dedupeHandlerReplacements(replacements);
}

function dedupeHandlerReplacements(
  replacements: readonly SourceReplacement[],
): SourceReplacement[] {
  return dedupeBy(replacements, (replacement) =>
    [replacement.start, replacement.end, replacement.replacement].join(':'),
  );
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
        `export const ${derive.exportName} = derive(${JSON.stringify(deriveInputs(derive))}, (${deriveParams(derive).join(', ')}) => ${derive.expression});`,
    )
    .join('\n');
  const helper = derives.some((derive) => deriveInputs(derive).length > 1)
    ? `${deriveExports ? '\n\n' : ''}function kovoDeriveValues(inputs, currentInput, currentValue, context) {
  return inputs.map((input) => input === currentInput ? currentValue : context?.queryStore?.get(input));
}`
    : '';
  const entries = queryUpdatePlans
    .map(
      (plan) =>
        `  ${JSON.stringify(plan.query)}(root, value, context = {}) {\n    return applyCompiledQueryUpdatePlan(root, ${JSON.stringify(plan.query)}, value, { bindings: true, derives: [${plan.derives?.map(emitDerivePlan).join(', ') ?? ''}], stamps: [${plan.stamps?.map(emitStampPlan).join(', ') ?? ''}], templateStamps: [${plan.templateStamps?.map(emitTemplateStampPlan).join(', ') ?? ''}] }, { queryStore: context.queryStore });\n  },`,
    )
    .join('\n');

  return `${deriveExports}${helper}${deriveExports || helper ? '\n\n' : ''}export const ${componentName}$queryUpdatePlans = {\n${entries}\n};`;
}

function emitDerivePlan(derive: QueryDeriveFact): string {
  return `{ name: ${JSON.stringify(derive.name)}, selector: ${JSON.stringify(derive.selector)}, select(value, root, context) { return ${emitDeriveRun(derive)}; } }`;
}

function emitStampPlan(stamp: QueryStampFact): string {
  return `{ attr: ${JSON.stringify(stamp.attr)}, selector: ${JSON.stringify(stamp.selector)}, select(value, root, context) { return ${emitDeriveRun(stamp.derive)}; } }`;
}

function deriveInputs(derive: QueryDeriveFact): readonly string[] {
  return derive.inputs ?? [derive.input];
}

function deriveParams(derive: QueryDeriveFact): readonly string[] {
  return derive.params ?? [derive.param];
}

function emitDeriveRun(derive: QueryDeriveFact): string {
  const inputs = deriveInputs(derive);
  return inputs.length === 1
    ? `${derive.exportName}.run(value)`
    : `${derive.exportName}.run(...kovoDeriveValues(${JSON.stringify(inputs)}, ${JSON.stringify(derive.input)}, value, context))`;
}

function emitTemplateStampPlan(stamp: QueryTemplateStampFact): string {
  const renderSegments = templateStampRenderSegments(stamp);

  // SPEC §1 and §5.2: list stamp item bodies are generated HTML fragments later parsed with
  // innerHTML, so scalar placeholders must use the shared output-context HTML escaping helper.
  return `{ key: ${JSON.stringify(stamp.key)}, list: ${JSON.stringify(stamp.listReadPath)}, selector: ${JSON.stringify(stamp.selector)}, render(item) {
      const record = item && typeof item === "object" ? item : {};
      const read = (path) => path.reduce((value, key) => value && typeof value === "object" ? value[key] : undefined, record);
      return [${renderSegments.join(', ')}].join("");
    } }`;
}

function templateStampRenderSegments(stamp: QueryTemplateStampFact): string[] {
  const placeholders = [...(stamp.itemBindingPlaceholders ?? [])].sort(
    (left, right) => left.templateStart - right.templateStart,
  );
  const segments: string[] = [];
  let cursor = 0;

  for (const placeholder of placeholders) {
    if (placeholder.templateStart < cursor) continue;
    if (placeholder.templateStart > cursor) {
      segments.push(JSON.stringify(stamp.template.slice(cursor, placeholder.templateStart)));
    }
    segments.push(
      templateStampHtmlEscapeExpression(
        `read(${JSON.stringify(placeholder.readSegments.map((segment) => segment.name))})`,
      ),
    );
    cursor = placeholder.templateEnd;
  }

  if (cursor < stamp.template.length) {
    segments.push(JSON.stringify(stamp.template.slice(cursor)));
  }

  return segments.length > 0 ? segments : [JSON.stringify(stamp.template)];
}

function runtimeOutputHelperImports(
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
  stateDerives: readonly StateDeriveFact[],
): string[] {
  return queryUpdatePlans.some((plan) => plan.stamps?.some((stamp) => stamp.attr === 'style')) ||
    stateDerives.some((derive) => derive.attr === 'style')
    ? [runtimeOutputHelpers.styleProperty]
    : [];
}
