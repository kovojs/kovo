import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Metric E is deliberately narrower than the full trust/capability audit. */
export const ESCAPE_CENSUS_DOORS = Object.freeze([
  'allowControlChars',
  'csrf:false',
  'ctx.fetch',
  'kovoAnalyzerSummary',
  'trustedHtml',
  'trustedSql',
]);

const escapeCensusDoorSet = new Set(ESCAPE_CENSUS_DOORS);
const trustKindToDoor = Object.freeze({
  allowControlChars: 'allowControlChars',
  csrfFalse: 'csrf:false',
  kovoAnalyzerSummary: 'kovoAnalyzerSummary',
  trustedHtml: 'trustedHtml',
  trustedSql: 'trustedSql',
});
const knownTrustEscapeKinds = new Set([
  'allowControlChars',
  'csrfFalse',
  'customVerifier',
  'kovoAnalyzerSummary',
  'rawEndpoint',
  'staticExportPathOverride',
  'trustedHtml',
  'trustedSql',
  'trustedUrl',
  'webhookVerifyNone',
]);
const knownSemanticDoors = new Set([
  'Response',
  'compiler-dom-focus',
  'compiler-form',
  'compiler-state',
  'context.setCookie',
  'ctx.fetch',
  'delegated-event',
  'framework-storage',
  'framework-timer',
  'handler-root',
  'local-call-edge',
  'managed-db',
  'platform-invoker',
  'principal-scope',
  'redirect',
  'respond.*',
  'reviewed-client-export',
  'structured-headers',
  'task-context',
  'trustedHtml',
  'trustedSql',
]);
const semanticBudgetKeys = Object.freeze(['callDepth', 'nodes', 'operations', 'summaries']);
const semanticClosedReasons = new Set([
  'budget-call-depth',
  'budget-node-count',
  'budget-operation-count',
  'budget-summary-count',
  'helper-cycle',
  'opaque-transfer',
  'unknown-operation',
  'unsupported-authority-use',
]);
const expectedSources = Object.freeze({
  allowControlChars: 'trustEscapes',
  'csrf:false': 'trustEscapes',
  'ctx.fetch': 'securitySemanticGraph',
  kovoAnalyzerSummary: 'trustEscapes',
  trustedHtml: 'trustEscapes',
  trustedSql: 'trustEscapes',
});

/**
 * Read metric-E facts from already-produced graph objects and compare them with monotone package
 * ceilings. This measures declared escape authority; it does not prove an escape is effective,
 * justified, or safe (SPEC §2 / plans/10x-better-security-3.md §4.1).
 */
export function evaluateEscapeCensus(options) {
  const findings = [];
  const currentBudgets = validateBudgetDocument(options?.budgets, 'budgets', findings);
  const previousBudgets = validateBudgetDocument(
    options?.previousBudgets,
    'previousBudgets',
    findings,
  );
  compareMonotoneBudgets(currentBudgets, previousBudgets, findings);

  const apps = Array.isArray(options?.apps) ? options.apps : [];
  if (apps.length === 0) findings.push('escape census requires at least one app graph');

  const seenApps = new Set();
  const appReports = [];
  const packageRoots = new Map();
  for (const [index, entry] of apps.entries()) {
    const label = `apps[${index}]`;
    if (!record(entry)) {
      findings.push(`${label}: app entry must be an object`);
      continue;
    }
    const app = nonBlank(entry.app) ? entry.app : undefined;
    const packageName = nonBlank(entry.package) ? entry.package : undefined;
    if (!app) findings.push(`${label}: app must be a non-blank string`);
    if (!packageName) findings.push(`${label}: package must be a non-blank string`);
    if (!app || !packageName) continue;
    const appKey = `${packageName}\0${app}`;
    if (seenApps.has(appKey)) {
      findings.push(`${app}: duplicate app/package census input for ${packageName}`);
      continue;
    }
    seenApps.add(appKey);

    const roots = emptyRootMap();
    inspectGraph(entry.graph, app, roots, findings);
    appReports.push({
      app,
      doors: doorCounts(roots),
      package: packageName,
      roots: rootLists(roots),
    });
    let aggregate = packageRoots.get(packageName);
    if (!aggregate) {
      aggregate = emptyRootMap();
      packageRoots.set(packageName, aggregate);
    }
    for (const door of ESCAPE_CENSUS_DOORS) {
      for (const root of roots.get(door)) aggregate.get(door).add(`${app}:${root}`);
    }
  }

  const packageReports = [];
  for (const packageName of [...packageRoots.keys()].sort()) {
    const roots = packageRoots.get(packageName);
    const limits = currentBudgets.get(packageName);
    if (!limits) {
      findings.push(`${packageName}: missing per-package escape budget`);
      continue;
    }
    for (const door of ESCAPE_CENSUS_DOORS) {
      const escapedRoots = [...roots.get(door)].sort();
      const budget = limits[door];
      if (escapedRoots.length > budget) {
        findings.push(
          `${packageName}: ${door} escaped roots ${escapedRoots.length} exceed budget ${budget} (${escapedRoots.join(', ')})`,
        );
      }
    }
    packageReports.push({
      doors: doorCounts(roots),
      package: packageName,
      roots: rootLists(roots),
    });
  }
  for (const packageName of currentBudgets.keys()) {
    if (!packageRoots.has(packageName)) {
      findings.push(`${packageName}: stale budget has no app graph input`);
    }
  }

  appReports.sort(
    (left, right) => left.package.localeCompare(right.package) || left.app.localeCompare(right.app),
  );
  return {
    findings: [...new Set(findings)].sort(),
    report: {
      apps: appReports,
      packages: packageReports,
      schema: 'kovo.escape-census/v1',
    },
  };
}

function inspectGraph(graph, app, roots, findings) {
  if (!record(graph)) {
    findings.push(`${app}: graph must be an object`);
    return;
  }
  validateCoverage(graph.escapeCensus, app, findings);

  const trustKinds = new Set();
  const trustEscapes = graph.trustEscapes;
  if (!Array.isArray(trustEscapes)) {
    findings.push(`${app}: authoritative trustEscapes array is absent`);
  } else {
    for (const [index, escape] of trustEscapes.entries()) {
      const label = `${app}: trustEscapes[${index}]`;
      if (!record(escape) || !nonBlank(escape.kind)) {
        findings.push(`${label} must carry a non-blank kind`);
        continue;
      }
      if (!knownTrustEscapeKinds.has(escape.kind)) {
        findings.push(`${app}: unsupported trust-escape kind ${escape.kind}`);
        continue;
      }
      trustKinds.add(escape.kind);
      const door = trustKindToDoor[escape.kind];
      if (!door) continue;
      if (!nonBlank(escape.site)) findings.push(`${label} must carry a non-blank site`);
      if (!nonBlank(escape.root)) {
        findings.push(`${label} must carry a source-derived escape root`);
        continue;
      }
      roots.get(door).add(escape.root);
    }
  }

  const semanticTrustDoors = new Set();
  const components = graph.components;
  if (!Array.isArray(components)) {
    findings.push(`${app}: authoritative components array is absent`);
  } else {
    for (const [index, component] of components.entries()) {
      inspectComponent(
        component,
        `${app}/${component?.name ?? `components[${index}]`}`,
        roots,
        semanticTrustDoors,
        findings,
      );
    }
  }
  for (const kind of ['trustedHtml', 'trustedSql']) {
    if (semanticTrustDoors.has(kind) && !trustKinds.has(kind)) {
      findings.push(`${app}: semantic ${kind} reachability has no ${kind} trust-escape fact`);
    }
  }

  const mutations = graph.mutations;
  if (!Array.isArray(mutations)) {
    findings.push(`${app}: authoritative mutations array is absent`);
  } else {
    for (const [index, mutation] of mutations.entries()) {
      if (!record(mutation)) {
        findings.push(`${app}: mutations[${index}] must be an object`);
        continue;
      }
      if (mutation.csrf !== 'exempt') continue;
      if (!nonBlank(mutation.key)) {
        findings.push(`${app}: csrf-exempt mutation at index ${index} has no key`);
        continue;
      }
      const expectedRoot = `mutation:${mutation.key}`;
      if (!roots.get('csrf:false').has(expectedRoot)) {
        findings.push(
          `${app}: csrf-exempt mutation ${mutation.key} has no csrfFalse trust-escape root`,
        );
      }
    }
  }
}

function inspectComponent(component, label, roots, semanticTrustDoors, findings) {
  if (!record(component)) {
    findings.push(`${label}: component must be an object`);
    return;
  }
  const handlerRoots = new Set();
  if (component.securityOperations !== undefined && !Array.isArray(component.securityOperations)) {
    findings.push(`${label}: securityOperations must be an array when present`);
  } else {
    for (const operation of component.securityOperations ?? []) {
      if (
        record(operation) &&
        operation.kind === 'server.handler.root' &&
        nonBlank(operation.root)
      ) {
        handlerRoots.add(operation.root);
      }
    }
  }
  const semantic = component.securitySemanticGraph;
  if (semantic === undefined) {
    if (handlerRoots.size > 0) {
      findings.push(
        `${label}: server handler roots are present but securitySemanticGraph is absent`,
      );
    }
    return;
  }
  if (!record(semantic) || semantic.schema !== 'kovo-security-semantic-graph/v2') {
    findings.push(`${label}: unsupported or malformed securitySemanticGraph schema`);
    return;
  }
  if (
    !record(semantic.budgets) ||
    Object.keys(semantic.budgets).length !== semanticBudgetKeys.length ||
    semanticBudgetKeys.some(
      (key) => !Number.isSafeInteger(semantic.budgets[key]) || semantic.budgets[key] < 0,
    )
  ) {
    findings.push(`${label}: securitySemanticGraph.budgets must be the exact finite budget record`);
  }
  if (!Array.isArray(semantic.roots)) {
    findings.push(`${label}: securitySemanticGraph.roots must be an array`);
    return;
  }
  const semanticRoots = new Set();
  for (const [index, root] of semantic.roots.entries()) {
    const rootLabel = `${label}: securitySemanticGraph.roots[${index}]`;
    if (!record(root) || !nonBlank(root.root)) {
      findings.push(`${rootLabel} must carry a non-blank root`);
      continue;
    }
    if (!record(root.binding) || root.binding.root !== root.root) {
      findings.push(`${rootLabel}.binding must bind the same exact root`);
    }
    semanticRoots.add(root.root);
    if (!Array.isArray(root.traces)) {
      findings.push(`${rootLabel}.traces must be an array`);
      continue;
    }
    for (const [traceIndex, trace] of root.traces.entries()) {
      const traceLabel = `${rootLabel}.traces[${traceIndex}]`;
      if (!record(trace) || (trace.verdict !== 'proved' && trace.verdict !== 'closed')) {
        findings.push(`${traceLabel} must carry a proved or closed verdict`);
        continue;
      }
      if (trace.root !== root.root) {
        findings.push(`${traceLabel}.root must match its semantic root`);
        continue;
      }
      if (!Array.isArray(trace.transfers) || trace.transfers.some((item) => !nonBlank(item))) {
        findings.push(`${traceLabel}.transfers must be an array of non-blank identities`);
        continue;
      }
      if (trace.verdict === 'closed') {
        if (!semanticClosedReasons.has(trace.reason) || !nonBlank(trace.detail)) {
          findings.push(`${traceLabel} carries an unsupported closed verdict`);
        }
        continue;
      }
      if (!record(trace.sink) || !nonBlank(trace.sink.door)) {
        findings.push(`${traceLabel}.sink must carry a non-blank door`);
        continue;
      }
      if (!knownSemanticDoors.has(trace.sink.door)) {
        findings.push(`${label}: unsupported semantic door ${trace.sink.door}`);
        continue;
      }
      if (trace.sink.door === 'ctx.fetch') roots.get('ctx.fetch').add(root.root);
      if (trace.sink.door === 'trustedHtml' || trace.sink.door === 'trustedSql') {
        semanticTrustDoors.add(trace.sink.door);
      }
    }
  }
  for (const handlerRoot of handlerRoots) {
    if (!semanticRoots.has(handlerRoot)) {
      findings.push(`${label}: server handler root ${handlerRoot} is absent from semantic graph`);
    }
  }
}

function validateCoverage(value, app, findings) {
  if (!record(value) || value.schema !== 'kovo.escape-census-coverage/v1') {
    findings.push(`${app}: missing kovo.escape-census-coverage/v1 producer witness`);
    return;
  }
  if (
    !Array.isArray(value.doors) ||
    value.doors.length !== ESCAPE_CENSUS_DOORS.length ||
    value.doors.some((door, index) => door !== ESCAPE_CENSUS_DOORS[index])
  ) {
    findings.push(
      `${app}: escape-census coverage doors do not match the closed metric-E vocabulary`,
    );
  }
  if (!record(value.sources)) {
    findings.push(`${app}: escape-census coverage sources must be an object`);
    return;
  }
  const keys = Object.keys(value.sources);
  if (
    keys.length !== ESCAPE_CENSUS_DOORS.length ||
    keys.some((door) => !escapeCensusDoorSet.has(door))
  ) {
    findings.push(`${app}: escape-census coverage sources contain missing or unsupported doors`);
  }
  for (const door of ESCAPE_CENSUS_DOORS) {
    if (value.sources[door] !== expectedSources[door]) {
      findings.push(`${app}: escape-census door ${door} must derive from ${expectedSources[door]}`);
    }
  }
}

function validateBudgetDocument(value, label, findings) {
  const result = new Map();
  if (!record(value) || value.schema !== 'kovo.escape-budgets/v1') {
    findings.push(`${label}: expected kovo.escape-budgets/v1`);
    return result;
  }
  if (!record(value.packages)) {
    findings.push(`${label}.packages must be an object`);
    return result;
  }
  for (const [packageName, limits] of Object.entries(value.packages)) {
    if (!nonBlank(packageName) || !record(limits)) {
      findings.push(`${label}: invalid package budget ${packageName || '<empty>'}`);
      continue;
    }
    const keys = Object.keys(limits);
    if (
      keys.length !== ESCAPE_CENSUS_DOORS.length ||
      keys.some((door) => !escapeCensusDoorSet.has(door))
    ) {
      findings.push(`${label}.${packageName}: budgets must cover exactly the metric-E doors`);
      continue;
    }
    const snapshot = {};
    let valid = true;
    for (const door of ESCAPE_CENSUS_DOORS) {
      const budget = limits[door];
      if (!Number.isSafeInteger(budget) || budget < 0) {
        findings.push(`${label}.${packageName}.${door}: budget must be a non-negative integer`);
        valid = false;
      } else {
        snapshot[door] = budget;
      }
    }
    if (valid) result.set(packageName, snapshot);
  }
  return result;
}

function compareMonotoneBudgets(current, previous, findings) {
  for (const [packageName, limits] of current) {
    const prior = previous.get(packageName);
    for (const door of ESCAPE_CENSUS_DOORS) {
      const previousLimit = prior?.[door] ?? 0;
      if (limits[door] > previousLimit) {
        findings.push(
          `${packageName}: ${door} budget increased from ${previousLimit} to ${limits[door]}; escape budgets are monotone`,
        );
      }
    }
  }
}

function emptyRootMap() {
  return new Map(ESCAPE_CENSUS_DOORS.map((door) => [door, new Set()]));
}

function doorCounts(roots) {
  return Object.fromEntries(ESCAPE_CENSUS_DOORS.map((door) => [door, roots.get(door).size]));
}

function rootLists(roots) {
  return Object.fromEntries(ESCAPE_CENSUS_DOORS.map((door) => [door, [...roots.get(door)].sort()]));
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function formatEscapeCensusReport(report) {
  const lines = ['kovo.escape-census/v1'];
  for (const app of report.apps) {
    for (const door of ESCAPE_CENSUS_DOORS) {
      lines.push(
        `ESCAPE app=${app.app} package=${app.package} door=${door} roots=${app.doors[door]} rootIds=${app.roots[door].join(',') || '-'}`,
      );
    }
  }
  for (const entry of report.packages) {
    lines.push(
      `PACKAGE package=${entry.package} total=${ESCAPE_CENSUS_DOORS.reduce((sum, door) => sum + entry.doors[door], 0)}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export function runEscapeCensusCli(argv, io = process) {
  const configIndex = argv.indexOf('--config');
  const configPath = configIndex < 0 ? undefined : argv[configIndex + 1];
  if (!configPath || argv.length !== 2) {
    io.stderr.write('usage: node scripts/escape-census-gate.mjs --config <config.json>\n');
    return 1;
  }
  try {
    const absoluteConfig = resolve(configPath);
    const config = JSON.parse(readFileSync(absoluteConfig, 'utf8'));
    if (!record(config) || config.schema !== 'kovo.escape-census-config/v1') {
      throw new TypeError('config must use kovo.escape-census-config/v1');
    }
    const base = dirname(absoluteConfig);
    const budgets = readJsonRelative(base, config.budgets, 'budgets');
    const previousBudgets = readJsonRelative(base, config.previousBudgets, 'previousBudgets');
    if (!Array.isArray(config.apps)) throw new TypeError('config.apps must be an array');
    const apps = config.apps.map((entry, index) => {
      if (!record(entry)) throw new TypeError(`config.apps[${index}] must be an object`);
      return {
        app: entry.app,
        graph: readJsonRelative(base, entry.graph, `apps[${index}].graph`),
        package: entry.package,
      };
    });
    const result = evaluateEscapeCensus({ apps, budgets, previousBudgets });
    io.stdout.write(formatEscapeCensusReport(result.report));
    if (result.findings.length === 0) return 0;
    io.stderr.write(
      `Escape census gate failed:\n${result.findings.map((item) => `- ${item}`).join('\n')}\n`,
    );
    return 1;
  } catch (error) {
    io.stderr.write(
      `Escape census gate failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

function readJsonRelative(base, value, label) {
  if (!nonBlank(value)) throw new TypeError(`${label} path must be a non-blank string`);
  return JSON.parse(readFileSync(resolve(base, value), 'utf8'));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runEscapeCensusCli(process.argv.slice(2));
}
