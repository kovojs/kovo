import { compilerIrHeader } from '../ir.js';
import { headlessUiGeneratedHandlerNames } from '../generated/headless-ui-generated-handlers.js';
import {
  compilerArrayJoin,
  compilerCreateSet,
  compilerOwnDataValue,
  compilerRegExpReplace,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringSplit,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';
import {
  runtimeOutputHelpers,
  templateStampHtmlEscapeExpression,
} from '../security/output-context.js';
import { applySourceReplacements, dedupeBy, indent, type SourceReplacement } from '../shared.js';
import { elementParamNameFromAttribute } from '../types.js';
import type {
  ClientConstantDependency,
  ClientImportDependency,
  ClientModuleImportManifestEntry,
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
const RUNTIME_GENERATED_IMPORT_PATTERN =
  /import\s*\{\s*([^}]+?)\s*\}\s*from\s*['"]@kovojs\/browser\/generated['"];\n\n?/g;

export function emitClientModule(
  handlers: HandlerLowering[],
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
  stateDerives: readonly StateDeriveFact[],
  componentName: string,
  clockUpdatePlans: readonly ClockUpdatePlanFact[] = [],
): string {
  const imports = runtimeGeneratedImportNames(
    handlers,
    queryUpdatePlans,
    stateDerives,
    clockUpdatePlans,
  );
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

export function emitClientModuleImportManifest(
  handlers: readonly HandlerLowering[],
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
  stateDerives: readonly StateDeriveFact[],
  clockUpdatePlans: readonly ClockUpdatePlanFact[] = [],
): readonly ClientModuleImportManifestEntry[] {
  const runtimeImports = runtimeGeneratedImportNames(
    handlers,
    queryUpdatePlans,
    stateDerives,
    clockUpdatePlans,
  );
  return clientImportManifestEntries([
    ...(runtimeImports.length > 0
      ? [
          {
            imports: runtimeImports.map((name) => ({ importedName: name, localName: name })),
            moduleSpecifier: RUNTIME_GENERATED_IMPORT,
          },
        ]
      : []),
    ...clientImportDependenciesManifest(
      handlers.flatMap((handler) => [...(handler.clientImports ?? [])]),
    ),
  ]);
}

/**
 * SPEC §5.2/#8 allows compiler-emitted modules to use the generated browser ABI, but SPEC §9.5
 * serves production client modules directly from `/c/__v/...` without Vite import rewriting.
 * Rewrite that compiler-owned ABI import into local helper definitions before production
 * registration so the browser never sees a bare package specifier in an immutable client module.
 */
export function rewriteClientModuleRuntimeImportsForBrowser(source: string): string {
  return compilerRegExpReplace(
    RUNTIME_GENERATED_IMPORT_PATTERN,
    source,
    (_match, specifiers: string) =>
      runtimeGeneratedHelperSource(importedRuntimeGeneratedNames(specifiers)),
  );
}

function importedRuntimeGeneratedNames(specifiers: string): readonly string[] {
  const parts = compilerStringSplit(specifiers, ',');
  const names: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const aliases = compilerStringSplit(compilerStringTrim(parts[index]!), /\s+as\s+/i);
    const name = aliases[0] === undefined ? '' : compilerStringTrim(aliases[0]);
    if (name.length === 0) continue;
    let insertAt = names.length;
    while (insertAt > 0 && name < names[insertAt - 1]!) {
      names[insertAt] = names[insertAt - 1]!;
      insertAt -= 1;
    }
    names[insertAt] = name;
  }
  return names;
}

function runtimeGeneratedHelperSource(names: readonly string[]): string {
  const helpers: string[] = [];
  const missing: string[] = [];
  const helperNames = compilerSnapshotDenseArray(
    runtimeGeneratedHelperNames(names),
    'Runtime-generated helper names',
  );
  for (let index = 0; index < helperNames.length; index += 1) {
    const name = helperNames[index]!;
    const helper = compilerOwnDataValue(
      RUNTIME_GENERATED_HELPERS,
      name,
      'Runtime-generated helper registry',
    );
    if (helper === undefined) {
      missing[missing.length] = name;
      continue;
    }
    if (typeof helper !== 'string') {
      throw new TypeError(`Runtime-generated helper ${name} must be a source string.`);
    }
    helpers[helpers.length] = helper;
  }
  if (missing.length > 0) {
    throw new Error(
      `Cannot emit browser-resolvable client module helpers for generated ABI import(s): ${compilerArrayJoin(missing, ', ')}`,
    );
  }

  const uniqueHelpers: string[] = [];
  const seen = compilerCreateSet<string>();
  for (let index = 0; index < helpers.length; index += 1) {
    const helper = helpers[index]!;
    if (compilerSetHas(seen, helper)) continue;
    compilerSetAdd(seen, helper);
    uniqueHelpers[uniqueHelpers.length] = helper;
  }
  return `${compilerArrayJoin(uniqueHelpers, '\n')}\n\n`;
}

function runtimeGeneratedHelperNames(names: readonly string[]): readonly string[] {
  const source = compilerSnapshotDenseArray(names, 'Imported runtime-generated names');
  const expanded = compilerCreateSet<string>();
  for (let index = 0; index < source.length; index += 1) {
    compilerSetAdd(expanded, source[index]!);
  }
  if (compilerSetHas(expanded, 'applyCompiledQueryUpdatePlan')) {
    compilerSetAdd(expanded, 'runQueryUpdatePlan');
  }
  const result: string[] = [];
  const candidates = compilerSnapshotDenseArray(source, 'Runtime-generated helper candidates');
  candidates[candidates.length] = 'runQueryUpdatePlan';
  for (let index = 0; index < candidates.length; index += 1) {
    const name = candidates[index]!;
    if (!compilerSetHas(expanded, name)) continue;
    let alreadyPresent = false;
    for (let resultIndex = 0; resultIndex < result.length; resultIndex += 1) {
      if (result[resultIndex] === name) {
        alreadyPresent = true;
        break;
      }
    }
    if (alreadyPresent) continue;
    let insertAt = result.length;
    while (insertAt > 0 && name < result[insertAt - 1]!) {
      result[insertAt] = result[insertAt - 1]!;
      insertAt -= 1;
    }
    result[insertAt] = name;
  }
  return result;
}

const RUNTIME_GENERATED_HELPERS: Readonly<Record<string, string>> = {
  applyCompiledQueryUpdatePlan: `const applyCompiledQueryUpdatePlan = (root, queryName, value, plan = {}, options = {}) => {
  return runQueryUpdatePlan(root, queryName, value, plan, options);
};`,
  runQueryUpdatePlan: `const runQueryUpdatePlan = (root, queryName, value, plan = {}, options = {}) => {
  const applied = { bindings: [], derives: [], stamps: [], templateStamps: [] };
  const qsa = (scope, selector) => Array.from(scope.querySelectorAll?.(selector) ?? []);
  const pathValue = (input, path) =>
    path.split('.').reduce((current, segment) => {
      const key = segment.endsWith('?') ? segment.slice(0, -1) : segment;
      return current && typeof current === 'object' ? current[key] : undefined;
    }, input);
  const format = (input) => input == null ? '' : typeof input === 'object' ? JSON.stringify(input) : String(input);
  const unsafeUrl = (input) => {
    const normalized = String(input).replace(/[\\x00-\\x20]/g, '').toLowerCase();
    return /^[a-z][a-z0-9+.-]*:/.test(normalized) && !/^(https?|ftp|mailto|tel):/.test(normalized);
  };
  const bindPropName = (name) => ({
    checked: 'checked',
    indeterminate: 'indeterminate',
    open: 'open',
    scrollleft: 'scrollLeft',
    scrolltop: 'scrollTop',
    selected: 'selected',
    value: 'value',
  })[String(name).toLowerCase()] ?? null;
  const writeProp = (element, name, input) => {
    const prop = bindPropName(name);
    if (!prop || element[prop] === undefined) return;
    if (/^(checked|indeterminate|open|selected)$/.test(prop)) {
      element[prop] = input != null && input !== false;
    } else if (prop === 'scrollLeft' || prop === 'scrollTop') {
      element[prop] = Number(input) || 0;
    } else {
      element[prop] = input == null ? '' : typeof input === 'object' ? JSON.stringify(input) : String(input);
    }
  };
  const writeAttr = (element, name, input) => {
    if (/^on[^:]|^(srcdoc|dangerouslysetinnerhtml|innerhtml|outerhtml|inserthtml|insertadjacenthtml)$/i.test(name)) {
      element.removeAttribute?.(name);
      return;
    }
    if (/^(checked|disabled|hidden|indeterminate|multiple|open|readonly|required|selected)$/i.test(name)) {
      if (input != null && input !== false) element.setAttribute?.(name, '');
      else element.removeAttribute?.(name);
      return;
    }
    const rendered = format(input);
    if (/^(href|src|action|formaction|poster|background|cite|data|ping|xlink:href)$/i.test(name) && unsafeUrl(rendered)) {
      element.setAttribute?.(name, '#');
      return;
    }
    element.setAttribute?.(name, rendered);
  };
  const write = (element, input) => {
    const rendered = format(input);
    // SPEC §4.8: data-bind/data-derive text writes are textContent sinks.
    element.textContent = rendered;
  };
  const bindingOptions = { ...(options.queryKey === undefined ? {} : { queryKey: options.queryKey }) };
  const belongsToQueryKey = (element) => !bindingOptions.queryKey || element.getAttribute?.('data-query-key') === bindingOptions.queryKey;
  if (plan.bindings !== false) {
    for (const element of qsa(root, '[data-bind]')) {
      if (!belongsToQueryKey(element)) continue;
      const path = element.getAttribute('data-bind');
      if (!path?.startsWith(queryName + '.')) continue;
      write(element, pathValue(value, path.slice(queryName.length + 1)));
      applied.bindings.push(path);
    }
    for (const element of qsa(root, '*')) {
      if (!belongsToQueryKey(element)) continue;
      for (const attribute of Array.from(element.attributes ?? [])) {
        if (!attribute.name.startsWith('data-bind:')) continue;
        const bound = attribute.name.slice('data-bind:'.length);
        const path = attribute.value;
        if (!path.startsWith(queryName + '.')) continue;
        const selected = pathValue(value, path.slice(queryName.length + 1));
        if (selected == null) element.removeAttribute?.(bound);
        else writeAttr(element, bound, selected);
        applied.bindings.push(path);
      }
      for (const attribute of Array.from(element.attributes ?? [])) {
        if (!attribute.name.startsWith('data-bind-prop:')) continue;
        const prop = attribute.name.slice('data-bind-prop:'.length);
        const path = attribute.value;
        if (!path.startsWith(queryName + '.')) continue;
        writeProp(element, prop, pathValue(value, path.slice(queryName.length + 1)));
        applied.bindings.push(path);
      }
    }
  }
  const context = options.queryStore ? { queryStore: options.queryStore } : {};
  for (const derive of plan.derives ?? []) {
    const selected = derive.select(value, root, context);
    for (const element of qsa(root, derive.selector ?? '[data-derive="' + queryName + '.' + derive.name + '"]')) {
      write(element, selected);
      applied.derives.push(derive.name);
    }
  }
  for (const stamp of plan.stamps ?? []) {
    const selected = stamp.select(value, root, context);
    for (const element of qsa(root, stamp.selector)) {
      if (selected == null) element.removeAttribute?.(stamp.attr);
      else writeAttr(element, stamp.attr, selected);
      applied.stamps.push(stamp.attr);
    }
  }
  for (const stamp of plan.templateStamps ?? []) {
    const list = pathValue(value, stamp.list);
    if (!Array.isArray(list)) continue;
    const items = list.map((item, index) => ({
      html: stamp.render(item, index),
      index,
      key: String(typeof stamp.key === 'function' ? stamp.key(item, index) : pathValue(item, stamp.key)),
      value: item,
    }));
    for (const host of qsa(root, stamp.selector)) {
      host.reconcileTemplateStamp?.(items);
      applied.templateStamps.push(stamp.list);
    }
  }
  return applied;
};`,
  derive: `const derive = (inputs, fn) => ({ inputs, run: fn });`,
  handler: `const handler = (fn) => fn;`,
  installClockUpdatePlans: `const installClockUpdatePlans = (root, plans, context = {}) => {
  const intervals = [];
  const intervalMs = (value) => typeof value === 'number' ? value : String(value ?? '').endsWith('s') ? Number(String(value).slice(0, -1)) * 1000 : Number(value);
  for (const plan of plans) {
    const entries = Object.entries(plan.clocks ?? {}).filter(([, spec]) => spec?.every);
    for (const [, spec] of entries) {
      const ms = intervalMs(spec.every);
      if (!Number.isFinite(ms) || ms <= 0) continue;
      const tick = () => plan.update(root, Object.fromEntries(entries.map(([name]) => [name, new Date()])), context);
      tick();
      intervals.push(setInterval(tick, ms));
    }
  }
  return () => intervals.forEach((id) => clearInterval(id));
};`,
  kovoBoundAttributeValue: `const kovoBoundAttributeValue = (value) => value == null ? null : String(value);`,
  kovoEscapeHtml: `const kovoEscapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);`,
  kovoSafeUrl: `const kovoSafeUrl = (value) => {
  const rendered = String(value ?? '');
  const normalized = rendered.replace(/[\\x00-\\x20]/g, '').toLowerCase();
  return /^[a-z][a-z0-9+.-]*:/.test(normalized) && !/^(https?|ftp|mailto|tel):/.test(normalized) ? '#' : rendered;
};`,
  kovoStyleProperty: `const kovoStyleProperty = (value) => {
  const rendered = String(value ?? '');
  return /\\bexpression\\s*\\(/i.test(rendered) || /-moz-binding\\s*:/i.test(rendered) || /url\\(\\s*(?:"\\s*javascript:|'\\s*javascript:|javascript:)/i.test(rendered) ? '' : rendered;
};`,
};

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

// SPEC §6.6/§6.2 + secure-framework Phase 4 / Tier 0 item 3: this emitter is the single sink that
// writes captured cross-module import lines into `*.client.js`. The fail-closed secret-emit gate is
// applied UPSTREAM in lower/handlers.ts (`clientImportDependencies` filters by the whole-channel
// `emitAllowedImportLocalNames` analysis), so by the time imports reach here they are already proven
// client-safe (callee-only or publishToClient-wrapped). A value-position capture of a server-only
// import is withheld before this point and its specifier never reaches the bundler.
function emitClientImportDependencies(imports: readonly ClientImportDependency[]): string {
  const entriesByModule = new Map<string, ClientImportDependency[]>();

  for (const item of dedupeBy(
    imports,
    (entry) => `${entry.moduleSpecifier}\0${entry.importedName}\0${entry.localName}`,
  )) {
    const moduleSpecifier = generatedHandlerModuleSpecifier(item);
    entriesByModule.set(moduleSpecifier, [...(entriesByModule.get(moduleSpecifier) ?? []), item]);
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

function clientImportDependenciesManifest(
  imports: readonly ClientImportDependency[],
): readonly ClientModuleImportManifestEntry[] {
  const entriesByModule = new Map<string, ClientImportDependency[]>();

  for (const item of dedupeBy(
    imports,
    (entry) => `${entry.moduleSpecifier}\0${entry.importedName}\0${entry.localName}`,
  )) {
    const moduleSpecifier = generatedHandlerModuleSpecifier(item);
    entriesByModule.set(moduleSpecifier, [...(entriesByModule.get(moduleSpecifier) ?? []), item]);
  }

  return [...entriesByModule]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([moduleSpecifier, entries]) => ({
      imports: entries
        .sort((left, right) => left.localName.localeCompare(right.localName))
        .map((entry) => ({ importedName: entry.importedName, localName: entry.localName })),
      moduleSpecifier,
    }));
}

function clientImportManifestEntries(
  entries: readonly ClientModuleImportManifestEntry[],
): readonly ClientModuleImportManifestEntry[] {
  const merged = new Map<string, Map<string, { importedName: string; localName: string }>>();
  for (const entry of entries) {
    const imports = merged.get(entry.moduleSpecifier) ?? new Map();
    for (const item of entry.imports) {
      imports.set(`${item.importedName}\0${item.localName}`, item);
    }
    merged.set(entry.moduleSpecifier, imports);
  }

  return [...merged]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([moduleSpecifier, imports]) => ({
      imports: [...imports.values()].sort((left, right) =>
        left.localName.localeCompare(right.localName),
      ),
      moduleSpecifier,
    }));
}

function runtimeGeneratedImportNames(
  handlers: readonly HandlerLowering[],
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
  stateDerives: readonly StateDeriveFact[],
  clockUpdatePlans: readonly ClockUpdatePlanFact[],
): readonly string[] {
  return [
    ...(queryUpdatePlans.length > 0 ? ['runQueryUpdatePlan'] : []),
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
}

function generatedHandlerModuleSpecifier(item: ClientImportDependency): string {
  if (
    // Compiler-owned Headless UI helper imports are normalized to the generated helper module.
    // This is emitted dependency hygiene, not app-authored API recognition.
    item.moduleSpecifier.startsWith('@kovojs/headless-ui/') &&
    item.moduleSpecifier !== '@kovojs/headless-ui/generated' &&
    headlessUiGeneratedHandlerNames.has(item.importedName)
  ) {
    return '@kovojs/headless-ui/generated';
  }

  return item.moduleSpecifier;
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
        `  ${JSON.stringify(plan.query)}(root, value, context = {}) {\n    return runQueryUpdatePlan(root, ${JSON.stringify(plan.query)}, value, { bindings: true, derives: [${plan.derives?.map(emitDerivePlan).join(', ') ?? ''}], stamps: [${plan.stamps?.map(emitStampPlan).join(', ') ?? ''}], templateStamps: [${plan.templateStamps?.map(emitTemplateStampPlan).join(', ') ?? ''}] }, { queryStore: context.queryStore });\n  },`,
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
