import { compilerIrHeader } from '../ir.js';
import { headlessUiGeneratedHandlerNames } from '../generated/headless-ui-generated-handlers.js';
import {
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerFailClosed,
  compilerJsonStringify,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerRegExpExec,
  compilerRegExpReplace,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringLocaleCompare,
  compilerStringTrim,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
import {
  runtimeOutputHelpers,
  templateStampHtmlEscapeExpression,
} from '../security/output-context.js';
import {
  applySourceReplacements,
  dedupeBy,
  indent,
  uniqueSorted,
  type SourceReplacement,
} from '../shared.js';
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
  const handlerSnapshot = compilerSnapshotDenseArray(handlers, 'Client handlers');
  const stateDeriveSnapshot = compilerSnapshotDenseArray(stateDerives, 'Client state derives');
  const imports = runtimeGeneratedImportNames(
    handlerSnapshot,
    queryUpdatePlans,
    stateDeriveSnapshot,
    clockUpdatePlans,
  );
  const importLine =
    compilerArrayLength(imports, 'Client runtime imports') > 0
      ? `import { ${compilerArrayJoin(imports, ', ')} } from '${RUNTIME_GENERATED_IMPORT}';\n\n`
      : '';
  const dependencyImportLines = emitClientImportDependencies(clientHandlerImports(handlerSnapshot));
  const dependencyConstantLines = emitClientConstantDependencies(
    clientHandlerConstants(handlerSnapshot),
  );
  const handlerExportParts: string[] = [];
  for (let index = 0; index < handlerSnapshot.length; index += 1) {
    appendClientValue(
      handlerExportParts,
      emitHandlerExport(handlerSnapshot[index]!),
      'Client handler exports',
    );
  }
  const handlerExports = compilerArrayJoin(handlerExportParts, '\n');
  const stateDeriveExportParts: string[] = [];
  for (let index = 0; index < stateDeriveSnapshot.length; index += 1) {
    appendClientValue(
      stateDeriveExportParts,
      emitStateDeriveExport(stateDeriveSnapshot[index]!),
      'Client state derive exports',
    );
  }
  const stateDeriveExports = compilerArrayJoin(stateDeriveExportParts, '\n');
  const queryPlanExport = emitQueryUpdatePlanExport(componentName, queryUpdatePlans);
  const clockPlanExport = emitClockUpdatePlanExport(componentName, clockUpdatePlans);
  const exportParts: string[] = [];
  if (handlerExports.length > 0)
    appendClientValue(exportParts, handlerExports, 'Client module export blocks');
  if (stateDeriveExports.length > 0)
    appendClientValue(exportParts, stateDeriveExports, 'Client module export blocks');
  if (queryPlanExport.length > 0)
    appendClientValue(exportParts, queryPlanExport, 'Client module export blocks');
  if (clockPlanExport.length > 0)
    appendClientValue(exportParts, clockPlanExport, 'Client module export blocks');
  const exports = compilerArrayJoin(exportParts, '\n\n');

  return `${compilerIrHeader}
${importLine}${dependencyImportLines}${dependencyConstantLines}${exports || '// no client handlers emitted'}
`;
}

function clientHandlerImports(handlers: readonly HandlerLowering[]): ClientImportDependency[] {
  const imports: ClientImportDependency[] = [];
  for (let handlerIndex = 0; handlerIndex < handlers.length; handlerIndex += 1) {
    const values = handlers[handlerIndex]!.clientImports;
    if (values === undefined) continue;
    const snapshot = compilerSnapshotDenseArray(values, 'Client handler imports');
    for (let index = 0; index < snapshot.length; index += 1) {
      appendClientValue(imports, snapshot[index]!, 'Client import dependencies');
    }
  }
  return imports;
}

function clientHandlerConstants(handlers: readonly HandlerLowering[]): ClientConstantDependency[] {
  const constants: ClientConstantDependency[] = [];
  for (let handlerIndex = 0; handlerIndex < handlers.length; handlerIndex += 1) {
    const values = handlers[handlerIndex]!.clientConstants;
    if (values === undefined) continue;
    const snapshot = compilerSnapshotDenseArray(values, 'Client handler constants');
    for (let index = 0; index < snapshot.length; index += 1) {
      appendClientValue(constants, snapshot[index]!, 'Client constant dependencies');
    }
  }
  return constants;
}

function appendClientValue<Value>(target: Value[], value: Value, label: string): void {
  compilerDefineOwnDataProperty(target, compilerArrayLength(target, label), value);
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
  const entries: ClientModuleImportManifestEntry[] = [];
  const runtimeLength = compilerArrayLength(runtimeImports, 'Client runtime manifest imports');
  if (runtimeLength > 0) {
    const imports: { importedName: string; localName: string }[] = [];
    for (let index = 0; index < runtimeLength; index += 1) {
      const name = compilerOwnDataValue(
        runtimeImports,
        index,
        'Client runtime manifest imports',
      ) as string;
      appendClientValue(
        imports,
        { importedName: name, localName: name },
        'Client runtime manifest imports',
      );
    }
    appendClientValue(
      entries,
      { imports, moduleSpecifier: RUNTIME_GENERATED_IMPORT },
      'Client import manifest entries',
    );
  }
  const handlerImports: ClientImportDependency[] = [];
  const handlerLength = compilerArrayLength(handlers, 'Client manifest handlers');
  for (let handlerIndex = 0; handlerIndex < handlerLength; handlerIndex += 1) {
    const handler = compilerOwnDataValue(
      handlers,
      handlerIndex,
      'Client manifest handlers',
    ) as HandlerLowering;
    const imports = handler.clientImports ?? [];
    const importLength = compilerArrayLength(imports, 'Client handler manifest imports');
    for (let importIndex = 0; importIndex < importLength; importIndex += 1) {
      appendClientValue(
        handlerImports,
        compilerOwnDataValue(
          imports,
          importIndex,
          'Client handler manifest imports',
        ) as ClientImportDependency,
        'Client handler manifest imports',
      );
    }
  }
  const dependencyEntries = clientImportDependenciesManifest(handlerImports);
  const dependencyLength = compilerArrayLength(
    dependencyEntries,
    'Client dependency manifest entries',
  );
  for (let index = 0; index < dependencyLength; index += 1) {
    appendClientValue(
      entries,
      compilerOwnDataValue(
        dependencyEntries,
        index,
        'Client dependency manifest entries',
      ) as ClientModuleImportManifestEntry,
      'Client import manifest entries',
    );
  }
  return clientImportManifestEntries(entries);
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
  const length = compilerArrayLength(parts, 'Runtime-generated import specifiers');
  for (let index = 0; index < length; index += 1) {
    const specifier = compilerStringTrim(
      compilerOwnDataValue(parts, index, 'Runtime-generated import specifiers') as string,
    );
    const alias = compilerRegExpExec(/\s+as\s+/i, specifier);
    const name = compilerStringTrim(
      alias === null ? specifier : compilerStringSlice(specifier, 0, alias.index),
    );
    if (name.length === 0) continue;
    appendClientValue(names, name, 'Runtime-generated import names');
  }
  return stableSortedClientValues(
    names,
    compilerStringLocaleCompare,
    'Runtime-generated import names',
  );
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
      appendClientValue(missing, name, 'Missing runtime-generated helpers');
      continue;
    }
    if (typeof helper !== 'string') {
      compilerFailClosed(`Runtime-generated helper ${name} must be a source string.`);
    }
    appendClientValue(helpers, helper, 'Runtime-generated helper source');
  }
  if (missing.length > 0) {
    compilerFailClosed(
      `Cannot emit browser-resolvable client module helpers for generated ABI import(s): ${compilerArrayJoin(missing, ', ')}`,
    );
  }

  const uniqueHelpers: string[] = [];
  const seen = compilerCreateSet<string>();
  for (let index = 0; index < helpers.length; index += 1) {
    const helper = helpers[index]!;
    if (compilerSetHas(seen, helper)) continue;
    compilerSetAdd(seen, helper);
    appendClientValue(uniqueHelpers, helper, 'Unique runtime-generated helpers');
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
  appendClientValue(candidates, 'runQueryUpdatePlan', 'Runtime-generated helper candidates');
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
    appendClientValue(result, name, 'Runtime-generated helper names');
  }
  return stableSortedClientValues(
    result,
    compilerStringLocaleCompare,
    'Runtime-generated helper names',
  );
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
  const plans = compilerSnapshotDenseArray(clockUpdatePlans, 'Client clock update plans');
  if (plans.length === 0) return '';

  const plan = plans[0];
  if (!plan) return '';
  const clockSnapshot = compilerSnapshotDenseArray(plan.clocks, 'Client clock definitions');
  const clockParts: string[] = [];
  for (let index = 0; index < clockSnapshot.length; index += 1) {
    const clock = clockSnapshot[index]!;
    appendClientValue(
      clockParts,
      `${compilerJsonSource(clock.name, 'Clock name')}: ${clock.spec}`,
      'Client clock source entries',
    );
  }
  const clocks = compilerArrayJoin(clockParts, ', ');

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
  const importSnapshot = compilerSnapshotDenseArray(imports, 'Client import dependencies');
  const normalizedFacts: { item: ClientImportDependency; moduleSpecifier: string }[] = [];
  for (let index = 0; index < importSnapshot.length; index += 1) {
    const item = importSnapshot[index]!;
    appendClientValue(
      normalizedFacts,
      { item, moduleSpecifier: generatedHandlerModuleSpecifier(item) },
      'Normalized client import dependencies',
    );
  }
  const normalized = dedupeBy(
    normalizedFacts,
    (entry) => `${entry.moduleSpecifier}\0${entry.item.importedName}\0${entry.item.localName}`,
  );
  const entries = stableSortedClientValues(
    normalized,
    (left, right) =>
      compilerStringLocaleCompare(left.moduleSpecifier, right.moduleSpecifier) ||
      compilerStringLocaleCompare(left.item.localName, right.item.localName) ||
      compilerStringLocaleCompare(left.item.importedName, right.item.importedName),
    'Normalized client import dependencies',
  );
  const lines: string[] = [];
  let moduleSpecifier: string | undefined;
  let specifiers: string[] = [];
  const flush = (): void => {
    if (moduleSpecifier === undefined) return;
    appendClientValue(
      lines,
      `import { ${compilerArrayJoin(specifiers, ', ')} } from ${compilerJsonSource(moduleSpecifier, 'Client import module specifier')};\n\n`,
      'Client import lines',
    );
  };
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (moduleSpecifier !== entry.moduleSpecifier) {
      flush();
      moduleSpecifier = entry.moduleSpecifier;
      specifiers = [];
    }
    appendClientValue(
      specifiers,
      entry.item.importedName === entry.item.localName
        ? entry.item.importedName
        : `${entry.item.importedName} as ${entry.item.localName}`,
      'Client import specifiers',
    );
  }
  flush();
  return compilerArrayJoin(lines, '');
}

function clientImportDependenciesManifest(
  imports: readonly ClientImportDependency[],
): readonly ClientModuleImportManifestEntry[] {
  const entriesByModule = compilerCreateMap<string, ClientImportDependency[]>();
  const unique = dedupeBy(
    imports,
    (entry) => `${entry.moduleSpecifier}\0${entry.importedName}\0${entry.localName}`,
  );
  const uniqueLength = compilerArrayLength(unique, 'Unique client dependency imports');
  for (let index = 0; index < uniqueLength; index += 1) {
    const item = compilerOwnDataValue(
      unique,
      index,
      'Unique client dependency imports',
    ) as ClientImportDependency;
    const moduleSpecifier = generatedHandlerModuleSpecifier(item);
    const entries = compilerMapGet(entriesByModule, moduleSpecifier) ?? [];
    appendClientValue(entries, item, 'Client imports by module');
    compilerMapSet(entriesByModule, moduleSpecifier, entries);
  }
  const groups: { entries: ClientImportDependency[]; moduleSpecifier: string }[] = [];
  compilerMapForEach(entriesByModule, (entries, moduleSpecifier) => {
    appendClientValue(groups, { entries, moduleSpecifier }, 'Client import module groups');
  });
  const sortedGroups = stableSortedClientValues(
    groups,
    (left, right) => compilerStringLocaleCompare(left.moduleSpecifier, right.moduleSpecifier),
    'Client import module groups',
  );
  const result: ClientModuleImportManifestEntry[] = [];
  const groupLength = compilerArrayLength(sortedGroups, 'Client import module groups');
  for (let groupIndex = 0; groupIndex < groupLength; groupIndex += 1) {
    const group = compilerOwnDataValue(
      sortedGroups,
      groupIndex,
      'Client import module groups',
    ) as (typeof sortedGroups)[number];
    const sortedEntries = stableSortedClientValues(
      group.entries,
      (left, right) => compilerStringLocaleCompare(left.localName, right.localName),
      'Client imports by module',
    );
    const projected: { importedName: string; localName: string }[] = [];
    const entryLength = compilerArrayLength(sortedEntries, 'Client imports by module');
    for (let entryIndex = 0; entryIndex < entryLength; entryIndex += 1) {
      const entry = compilerOwnDataValue(
        sortedEntries,
        entryIndex,
        'Client imports by module',
      ) as ClientImportDependency;
      appendClientValue(
        projected,
        { importedName: entry.importedName, localName: entry.localName },
        'Client import manifest specifiers',
      );
    }
    appendClientValue(
      result,
      { imports: projected, moduleSpecifier: group.moduleSpecifier },
      'Client dependency manifest entries',
    );
  }
  return result;
}

function clientImportManifestEntries(
  entries: readonly ClientModuleImportManifestEntry[],
): readonly ClientModuleImportManifestEntry[] {
  const merged = compilerCreateMap<
    string,
    Map<string, { importedName: string; localName: string }>
  >();
  const entryLength = compilerArrayLength(entries, 'Client import manifest entries');
  for (let entryIndex = 0; entryIndex < entryLength; entryIndex += 1) {
    const entry = compilerOwnDataValue(
      entries,
      entryIndex,
      'Client import manifest entries',
    ) as ClientModuleImportManifestEntry;
    const imports =
      compilerMapGet(merged, entry.moduleSpecifier) ??
      compilerCreateMap<string, { importedName: string; localName: string }>();
    const importLength = compilerArrayLength(entry.imports, 'Client manifest specifiers');
    for (let importIndex = 0; importIndex < importLength; importIndex += 1) {
      const item = compilerOwnDataValue(
        entry.imports,
        importIndex,
        'Client manifest specifiers',
      ) as { importedName: string; localName: string };
      compilerMapSet(imports, `${item.importedName}\0${item.localName}`, item);
    }
    compilerMapSet(merged, entry.moduleSpecifier, imports);
  }
  const groups: {
    imports: Map<string, { importedName: string; localName: string }>;
    moduleSpecifier: string;
  }[] = [];
  compilerMapForEach(merged, (imports, moduleSpecifier) => {
    appendClientValue(groups, { imports, moduleSpecifier }, 'Merged client import groups');
  });
  const sortedGroups = stableSortedClientValues(
    groups,
    (left, right) => compilerStringLocaleCompare(left.moduleSpecifier, right.moduleSpecifier),
    'Merged client import groups',
  );
  const result: ClientModuleImportManifestEntry[] = [];
  const groupLength = compilerArrayLength(sortedGroups, 'Merged client import groups');
  for (let groupIndex = 0; groupIndex < groupLength; groupIndex += 1) {
    const group = compilerOwnDataValue(
      sortedGroups,
      groupIndex,
      'Merged client import groups',
    ) as (typeof sortedGroups)[number];
    const imports: { importedName: string; localName: string }[] = [];
    compilerMapForEach(group.imports, (item) => {
      appendClientValue(imports, item, 'Merged client import specifiers');
    });
    appendClientValue(
      result,
      {
        imports: stableSortedClientValues(
          imports,
          (left, right) => compilerStringLocaleCompare(left.localName, right.localName),
          'Merged client import specifiers',
        ),
        moduleSpecifier: group.moduleSpecifier,
      },
      'Merged client import manifest',
    );
  }
  return result;
}

function runtimeGeneratedImportNames(
  handlers: readonly HandlerLowering[],
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
  stateDerives: readonly StateDeriveFact[],
  clockUpdatePlans: readonly ClockUpdatePlanFact[],
): readonly string[] {
  const names: string[] = [];
  const planSnapshot = compilerSnapshotDenseArray(queryUpdatePlans, 'Client query update plans');
  const stateSnapshot = compilerSnapshotDenseArray(stateDerives, 'Client state derives');
  let hasDerive = compilerArrayLength(stateSnapshot, 'Client state derives') > 0;
  let hasTemplateStamp = false;
  let hasStyleProperty = false;
  for (let planIndex = 0; planIndex < planSnapshot.length; planIndex += 1) {
    const plan = planSnapshot[planIndex]!;
    if (
      (plan.derives !== undefined &&
        compilerArrayLength(plan.derives, 'Client query derives') > 0) ||
      (plan.stamps !== undefined && compilerArrayLength(plan.stamps, 'Client query stamps') > 0)
    ) {
      hasDerive = true;
    }
    if (
      plan.templateStamps !== undefined &&
      compilerArrayLength(plan.templateStamps, 'Client template stamps') > 0
    ) {
      hasTemplateStamp = true;
    }
    if (plan.stamps !== undefined) {
      const stamps = compilerSnapshotDenseArray(plan.stamps, 'Client query stamps');
      for (let stampIndex = 0; stampIndex < stamps.length; stampIndex += 1) {
        if (stamps[stampIndex]!.attr === 'style') hasStyleProperty = true;
      }
    }
  }
  for (let index = 0; index < stateSnapshot.length; index += 1) {
    if (stateSnapshot[index]!.attr === 'style') hasStyleProperty = true;
  }

  if (planSnapshot.length > 0)
    appendClientValue(names, 'runQueryUpdatePlan', 'Client runtime import names');
  if (hasDerive) appendClientValue(names, 'derive', 'Client runtime import names');
  if (hasTemplateStamp)
    appendClientValue(names, runtimeOutputHelpers.escapeHtml, 'Client runtime import names');
  if (hasStyleProperty)
    appendClientValue(names, runtimeOutputHelpers.styleProperty, 'Client runtime import names');
  if (compilerArrayLength(handlers, 'Client handlers') > 0)
    appendClientValue(names, 'handler', 'Client runtime import names');
  if (compilerArrayLength(clockUpdatePlans, 'Client clock update plans') > 0)
    appendClientValue(names, 'installClockUpdatePlans', 'Client runtime import names');
  return uniqueSorted(names);
}

function generatedHandlerModuleSpecifier(item: ClientImportDependency): string {
  if (
    // Compiler-owned Headless UI helper imports are normalized to the generated helper module.
    // This is emitted dependency hygiene, not app-authored API recognition.
    compilerStringStartsWith(item.moduleSpecifier, '@kovojs/headless-ui/') &&
    item.moduleSpecifier !== '@kovojs/headless-ui/generated' &&
    compilerSetHas(headlessUiGeneratedHandlerNames, item.importedName)
  ) {
    return '@kovojs/headless-ui/generated';
  }

  return item.moduleSpecifier;
}

function emitClientConstantDependencies(constants: readonly ClientConstantDependency[]): string {
  const entries = stableSortedClientValues(
    dedupeBy(constants, (entry) => `${entry.name}\0${entry.source}`),
    (left, right) => compilerStringLocaleCompare(left.name, right.name),
    'Client constant dependencies',
  );
  const lines: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    appendClientValue(lines, `const ${entry.name} = ${entry.source};`, 'Client constant lines');
  }

  return lines.length > 0 ? `${compilerArrayJoin(lines, '\n')}\n\n` : '';
}

function stableSortedClientValues<Value>(
  values: readonly Value[],
  compare: (left: Value, right: Value) => number,
  label: string,
): Value[] {
  const source = compilerSnapshotDenseArray(values, label);
  const selected = compilerCreateSet<number>();
  const sorted: Value[] = [];
  const length = compilerArrayLength(source, label);
  for (let outputIndex = 0; outputIndex < length; outputIndex += 1) {
    let bestIndex = -1;
    for (let index = 0; index < length; index += 1) {
      if (compilerSetHas(selected, index)) continue;
      if (
        bestIndex < 0 ||
        compare(
          compilerOwnDataValue(source, index, label) as Value,
          compilerOwnDataValue(source, bestIndex, label) as Value,
        ) < 0
      ) {
        bestIndex = index;
      }
    }
    if (bestIndex < 0) compilerFailClosed(`${label} could not be sorted deterministically.`);
    compilerSetAdd(selected, bestIndex);
    appendClientValue(
      sorted,
      compilerOwnDataValue(source, bestIndex, label) as Value,
      `${label} sorted values`,
    );
  }
  return sorted;
}

function emitStateDeriveExport(deriveFact: StateDeriveFact): string {
  return `export const ${deriveFact.exportName} = derive(["state"], (state) => ${deriveFact.expression});`;
}

function emitHandlerExport(handler: HandlerLowering): string {
  const body = emitHandlerBody(handler);
  const eventParam = compilerRegExpTest(/\bevent\b/, body) ? 'event' : '_event';
  const contextParam = compilerRegExpTest(/\bctx\b/, body) ? 'ctx' : '_ctx';

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
  const paramSnapshot = compilerSnapshotDenseArray(params, 'Client handler element params');
  const paramEntries: { param: ElementParam; sourceExpression: string }[] = [];
  for (let index = 0; index < paramSnapshot.length; index += 1) {
    const param = paramSnapshot[index]!;
    if (param.expression.length === 0) continue;
    appendClientValue(
      paramEntries,
      { param, sourceExpression: param.expression },
      'Client handler element param projections',
    );
  }
  const paramReplacements = stableSortedClientValues(
    paramEntries,
    (left, right) => right.sourceExpression.length - left.sourceExpression.length,
    'Client handler element param projections',
  );

  const propertyAccesses = compilerSnapshotDenseArray(
    body.propertyAccesses,
    'Client handler property accesses',
  );
  for (let index = 0; index < propertyAccesses.length; index += 1) {
    const access = propertyAccesses[index]!;
    const param = handlerElementParamForPath(paramReplacements, access.path);
    if (param) {
      appendClientValue(
        replacements,
        {
          end: access.end,
          replacement: `ctx.params.${elementParamNameFromAttribute(param.attributeName)}`,
          start: access.start,
        },
        'Client handler source replacements',
      );
      continue;
    }

    if (access.path === 'state' || compilerStringStartsWith(access.path, 'state.')) {
      appendClientValue(
        replacements,
        {
          end: access.start + 'state'.length,
          replacement: 'ctx.state',
          start: access.start,
        },
        'Client handler source replacements',
      );
    }
  }

  const references = compilerSnapshotDenseArray(body.references ?? [], 'Client handler references');
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index]!;
    const param = handlerElementParamForPath(paramReplacements, reference.name);
    if (param) {
      appendClientValue(
        replacements,
        {
          end: reference.end,
          replacement: `ctx.params.${elementParamNameFromAttribute(param.attributeName)}`,
          start: reference.start,
        },
        'Client handler source replacements',
      );
      continue;
    }

    if (reference.name !== 'state') continue;
    let alreadyCovered = false;
    for (let replacementIndex = 0; replacementIndex < replacements.length; replacementIndex += 1) {
      const replacement = replacements[replacementIndex]!;
      if (reference.start >= replacement.start && reference.end <= replacement.end) {
        alreadyCovered = true;
        break;
      }
    }
    if (alreadyCovered) continue;

    appendClientValue(
      replacements,
      {
        end: reference.end,
        replacement: 'ctx.state',
        start: reference.start,
      },
      'Client handler source replacements',
    );
  }

  return dedupeHandlerReplacements(replacements);
}

function handlerElementParamForPath(
  entries: readonly { param: ElementParam; sourceExpression: string }[],
  path: string,
): ElementParam | undefined {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.sourceExpression === path) return entry.param;
  }
  return undefined;
}

function dedupeHandlerReplacements(
  replacements: readonly SourceReplacement[],
): SourceReplacement[] {
  return dedupeBy(
    replacements,
    (replacement) => `${replacement.start}:${replacement.end}:${replacement.replacement}`,
  );
}

function emitQueryUpdatePlanExport(
  componentName: string,
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
): string {
  const plans = compilerSnapshotDenseArray(queryUpdatePlans, 'Client query update plans');
  if (plans.length === 0) return '';

  const deriveCandidates: QueryDeriveFact[] = [];
  for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
    const plan = plans[planIndex]!;
    if (plan.derives !== undefined) {
      const planDerives = compilerSnapshotDenseArray(plan.derives, 'Client query derives');
      for (let index = 0; index < planDerives.length; index += 1) {
        appendClientValue(deriveCandidates, planDerives[index]!, 'Client derive candidates');
      }
    }
    if (plan.stamps !== undefined) {
      const stamps = compilerSnapshotDenseArray(plan.stamps, 'Client query stamps');
      for (let index = 0; index < stamps.length; index += 1) {
        appendClientValue(deriveCandidates, stamps[index]!.derive, 'Client derive candidates');
      }
    }
  }
  const derives = dedupeBy(deriveCandidates, (derive) => derive.exportName);
  const deriveExportParts: string[] = [];
  let needsDeriveValues = false;
  for (let index = 0; index < derives.length; index += 1) {
    const derive = derives[index]!;
    const inputs = deriveInputs(derive);
    if (inputs.length > 1) needsDeriveValues = true;
    appendClientValue(
      deriveExportParts,
      `export const ${derive.exportName} = derive(${compilerJsonSource(inputs, 'Client derive inputs')}, (${compilerArrayJoin(deriveParams(derive), ', ')}) => ${derive.expression});`,
      'Client derive export source',
    );
  }
  const deriveExports = compilerArrayJoin(deriveExportParts, '\n');
  const helper = needsDeriveValues
    ? `${deriveExports ? '\n\n' : ''}function kovoDeriveValues(inputs, currentInput, currentValue, context) {
  return inputs.map((input) => input === currentInput ? currentValue : context?.queryStore?.get(input));
}`
    : '';
  const entryParts: string[] = [];
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index]!;
    const query = compilerJsonSource(plan.query, 'Query update plan name');
    appendClientValue(
      entryParts,
      `  ${query}(root, value, context = {}) {\n    return runQueryUpdatePlan(root, ${query}, value, { bindings: true, derives: [${emitClientFactList(plan.derives, emitDerivePlan, 'Query derive plans')}], stamps: [${emitClientFactList(plan.stamps, emitStampPlan, 'Query stamp plans')}], templateStamps: [${emitClientFactList(plan.templateStamps, emitTemplateStampPlan, 'Query template stamp plans')}] }, { queryStore: context.queryStore });\n  },`,
      'Client query update entries',
    );
  }
  const entries = compilerArrayJoin(entryParts, '\n');

  return `${deriveExports}${helper}${deriveExports || helper ? '\n\n' : ''}export const ${componentName}$queryUpdatePlans = {\n${entries}\n};`;
}

function emitClientFactList<Value>(
  values: readonly Value[] | undefined,
  emit: (value: Value) => string,
  label: string,
): string {
  if (values === undefined) return '';
  const snapshot = compilerSnapshotDenseArray(values, label);
  const emitted: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    appendClientValue(emitted, emit(snapshot[index]!), `${label} source`);
  }
  return compilerArrayJoin(emitted, ', ');
}

function compilerJsonSource(value: unknown, label: string): string {
  const source = compilerJsonStringify(value);
  if (source === undefined) compilerFailClosed(`${label} must be JSON-serializable.`);
  return source;
}

function emitDerivePlan(derive: QueryDeriveFact): string {
  return `{ name: ${compilerJsonSource(derive.name, 'Query derive name')}, selector: ${compilerJsonSource(derive.selector, 'Query derive selector')}, select(value, root, context) { return ${emitDeriveRun(derive)}; } }`;
}

function emitStampPlan(stamp: QueryStampFact): string {
  return `{ attr: ${compilerJsonSource(stamp.attr, 'Query stamp attribute')}, selector: ${compilerJsonSource(stamp.selector, 'Query stamp selector')}, select(value, root, context) { return ${emitDeriveRun(stamp.derive)}; } }`;
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
    : `${derive.exportName}.run(...kovoDeriveValues(${compilerJsonSource(inputs, 'Query derive inputs')}, ${compilerJsonSource(derive.input, 'Query derive input')}, value, context))`;
}

function emitTemplateStampPlan(stamp: QueryTemplateStampFact): string {
  const renderSegments = templateStampRenderSegments(stamp);

  // SPEC §1 and §5.2: list stamp item bodies are generated HTML fragments later parsed with
  // innerHTML, so scalar placeholders must use the shared output-context HTML escaping helper.
  return `{ key: ${compilerJsonSource(stamp.key, 'Template stamp key')}, list: ${compilerJsonSource(stamp.listReadPath, 'Template stamp list path')}, selector: ${compilerJsonSource(stamp.selector, 'Template stamp selector')}, render(item) {
      const record = item && typeof item === "object" ? item : {};
      const read = (path) => path.reduce((value, key) => value && typeof value === "object" ? value[key] : undefined, record);
      return [${compilerArrayJoin(renderSegments, ', ')}].join("");
    } }`;
}

function templateStampRenderSegments(stamp: QueryTemplateStampFact): string[] {
  const placeholders = stableSortedClientValues(
    stamp.itemBindingPlaceholders ?? [],
    (left, right) => left.templateStart - right.templateStart,
    'Template stamp placeholders',
  );
  const segments: string[] = [];
  let cursor = 0;

  const placeholderLength = compilerArrayLength(placeholders, 'Template stamp placeholders');
  for (let placeholderIndex = 0; placeholderIndex < placeholderLength; placeholderIndex += 1) {
    const placeholder = compilerOwnDataValue(
      placeholders,
      placeholderIndex,
      'Template stamp placeholders',
    ) as NonNullable<QueryTemplateStampFact['itemBindingPlaceholders']>[number];
    if (placeholder.templateStart < cursor) continue;
    if (placeholder.templateStart > cursor) {
      appendClientValue(
        segments,
        compilerJsonSource(
          compilerStringSlice(stamp.template, cursor, placeholder.templateStart),
          'Template stamp literal',
        ),
        'Template stamp render segments',
      );
    }
    const readSegmentFacts = compilerSnapshotDenseArray(
      placeholder.readSegments,
      'Template stamp read segments',
    );
    const readSegmentNames: string[] = [];
    const readSegmentLength = compilerArrayLength(readSegmentFacts, 'Template stamp read segments');
    for (let readIndex = 0; readIndex < readSegmentLength; readIndex += 1) {
      const readSegment = compilerOwnDataValue(
        readSegmentFacts,
        readIndex,
        'Template stamp read segments',
      ) as (typeof readSegmentFacts)[number];
      appendClientValue(readSegmentNames, readSegment.name, 'Template stamp read-segment names');
    }
    appendClientValue(
      segments,
      templateStampHtmlEscapeExpression(
        `read(${compilerJsonSource(readSegmentNames, 'Template stamp read segments')})`,
      ),
      'Template stamp render segments',
    );
    cursor = placeholder.templateEnd;
  }

  if (cursor < stamp.template.length) {
    appendClientValue(
      segments,
      compilerJsonSource(compilerStringSlice(stamp.template, cursor), 'Template stamp literal'),
      'Template stamp render segments',
    );
  }

  if (compilerArrayLength(segments, 'Template stamp render segments') === 0) {
    appendClientValue(
      segments,
      compilerJsonSource(stamp.template, 'Template stamp literal'),
      'Template stamp render segments',
    );
  }
  return segments;
}
