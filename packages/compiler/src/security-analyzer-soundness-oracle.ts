import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import * as ts from 'typescript';

import type {
  SecurityOperationDoor,
  ServerSecurityOperationKind,
} from '@kovojs/core/internal/security-operation-ir';

import { compileComponentModule } from './index.js';
import {
  securityAbstractInterpreterCensus,
  securityAbstractTransferIds,
  type SecurityAbstractTransferId,
} from './scan/security-abstract-interpreter.js';

export const analyzerSoundnessCounterexampleSchema =
  'kovo.security-fuzz-counterexample/v1' as const;

export const analyzerOracleProductionIds = [
  'alias.fixed-point',
  'alias.const-preserve',
  'alias.mutable-authority-top',
  'alias.join',
  'binding.static-member',
  'binding.rest',
  'binding.default-join',
  'expression.identifier',
  'expression.implicit-protocol',
  'expression.new',
  'expression.call-scope',
  'expression.call-scoped-key',
  'expression.call-intrinsic-identity',
  'expression.call-response',
  'expression.call-unknown-authority',
  'expression.call-local',
  'expression.binary-join',
  'expression.conditional-join',
  'expression.static-member',
  'expression.fallthrough-foreign',
  'expression.fallthrough-authority',
  'helper.call-map',
  'helper.spread-close',
  'helper.rest-argument-close',
  'helper.extra-argument-close',
  'helper.rest-parameter-close',
  'helper.arguments-close',
  'helper.cycle-close',
  'budget.call-depth-close',
  'budget.node-count-close',
  'budget.operation-count-close',
  'budget.summary-count-close',
  'effect.invoke',
] as const satisfies readonly SecurityAbstractTransferId[];

export type AnalyzerEffectDoor =
  | 'ctx.actAs'
  | 'ctx.db.insert'
  | 'ctx.db.select'
  | 'ctx.fetch'
  | 'ctx.headers.set'
  | 'ctx.schedule'
  | 'ctx.setCookie'
  | 'ctx.storage.get'
  | 'ctx.storage.put';

export interface AnalyzerOracleProgram {
  readonly aliasDepth: number;
  readonly door: AnalyzerEffectDoor;
  readonly helperDepth: number;
  readonly id: string;
}

export interface AnalyzerOracleTransferWitness {
  readonly id: SecurityAbstractTransferId;
  readonly production: string;
  readonly source: string;
  readonly witnessedElements: readonly string[];
}

export interface AnalyzerOracleLatticeWitness {
  readonly element: string;
  readonly production: 'lattice-element';
}

export interface AnalyzerOracleCanary {
  readonly dropAbstractKind?: ServerSecurityOperationKind;
  readonly dropObservedDoor?: AnalyzerEffectDoor;
}

export interface AnalyzerOracleRunOptions {
  readonly artifactDirectory?: string;
  readonly canary?: AnalyzerOracleCanary;
  readonly programBudget?: number;
  readonly profile?: string;
  readonly seed?: number;
}

export interface AnalyzerOracleRunResult {
  readonly checkedPrograms: number;
  readonly seed: string;
  readonly witnessedDoors: readonly AnalyzerEffectDoor[];
}

interface ObservedEffect {
  readonly door: SecurityOperationDoor;
  readonly kind: ServerSecurityOperationKind;
}

interface AnalyzerOracleFailure {
  readonly abstractPredicted: readonly ObservedEffect[];
  readonly concreteExpected: readonly ObservedEffect[];
  readonly detail: string;
  readonly emittedObserved: readonly ObservedEffect[];
  readonly program: AnalyzerOracleProgram;
  readonly source: string;
}

let emittedModuleSequence = 0;

const effectDoors = [
  'ctx.actAs',
  'ctx.db.insert',
  'ctx.db.select',
  'ctx.fetch',
  'ctx.headers.set',
  'ctx.schedule',
  'ctx.setCookie',
  'ctx.storage.get',
  'ctx.storage.put',
] as const satisfies readonly AnalyzerEffectDoor[];

/**
 * Independent concrete semantics for the declared generated language.
 *
 * This switch intentionally does not consume the analyzer's provenance relation or operation-door
 * table. A disagreement with compiler output is therefore capable of falsifying either side.
 */
export function interpretAnalyzerOracleProgram(
  program: AnalyzerOracleProgram,
): readonly ObservedEffect[] {
  switch (program.door) {
    case 'ctx.actAs':
      return [{ door: 'principal-scope', kind: 'server.authority.scope' }];
    case 'ctx.db.insert':
      return [{ door: 'managed-db', kind: 'server.database.write' }];
    case 'ctx.db.select':
      return [{ door: 'managed-db', kind: 'server.database.read' }];
    case 'ctx.fetch':
      return [{ door: 'ctx.fetch', kind: 'server.egress.request' }];
    case 'ctx.headers.set':
      return [{ door: 'structured-headers', kind: 'server.response.header' }];
    case 'ctx.schedule':
      return [{ door: 'task-context', kind: 'server.task.compose' }];
    case 'ctx.setCookie':
      return [{ door: 'context.setCookie', kind: 'server.response.cookie' }];
    case 'ctx.storage.get':
      return [{ door: 'framework-storage', kind: 'server.storage.read' }];
    case 'ctx.storage.put':
      return [{ door: 'framework-storage', kind: 'server.storage.write' }];
  }
}

export function generateAnalyzerOraclePrograms(
  options: {
    readonly budget?: number;
    readonly seed?: number;
  } = {},
): AnalyzerOracleProgram[] {
  const budget =
    options.budget ?? securityAbstractInterpreterCensus.language.generatedProgramBudget;
  if (!Number.isSafeInteger(budget) || budget < effectDoors.length) {
    throw new TypeError(`Analyzer oracle budget must be at least ${effectDoors.length}.`);
  }
  let random = options.seed ?? 0x4b56_4149;
  const next = (): number => {
    random |= 0;
    random = (random + 0x6d2b_79f5) | 0;
    let value = random;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  const programs: AnalyzerOracleProgram[] = [];
  for (let index = 0; index < budget; index += 1) {
    const door =
      index < effectDoors.length
        ? effectDoors[index]!
        : effectDoors[Math.floor(next() * effectDoors.length)]!;
    programs.push({
      aliasDepth: Math.floor(
        next() * (securityAbstractInterpreterCensus.language.maxAliasDepth + 1),
      ),
      door,
      helperDepth: Math.floor(
        next() * (securityAbstractInterpreterCensus.language.maxHelperDepth + 1),
      ),
      id: `program-${index.toString().padStart(3, '0')}`,
    });
  }
  return programs;
}

/** Every census transfer and lattice element receives a deterministic generated witness. */
export function generateAnalyzerOracleTransferWitnesses(): AnalyzerOracleTransferWitness[] {
  const transferRules = new Map(
    securityAbstractInterpreterCensus.transfers.map((transfer) => [transfer.id, transfer]),
  );
  return analyzerOracleProductionIds.map((id, index) => {
    const transfer = transferRules.get(id);
    if (transfer === undefined) throw new TypeError(`Missing analyzer transfer row ${id}.`);
    const element =
      securityAbstractInterpreterCensus.lattice.elements[
        index % securityAbstractInterpreterCensus.lattice.elements.length
      ]!;
    return {
      id,
      production: transfer.production,
      source: transferWitnessSource(id),
      witnessedElements: [element],
    };
  });
}

export function generateAnalyzerOracleLatticeWitnesses(): AnalyzerOracleLatticeWitness[] {
  return securityAbstractInterpreterCensus.lattice.elements.map((element) => ({
    element,
    production: 'lattice-element',
  }));
}

export function analyzerOracleWitnessedLatticeElements(): readonly string[] {
  return generateAnalyzerOracleLatticeWitnesses().map((witness) => witness.element);
}

export function renderAnalyzerOracleSource(program: AnalyzerOracleProgram): string {
  const aliases: string[] = [];
  let capability = doorExpression(program.door);
  for (let index = 0; index < program.aliasDepth; index += 1) {
    const name = `capability${index}`;
    aliases.push(`    const ${name} = ${capability};`);
    capability = name;
  }

  const helpers: string[] = [];
  for (let index = program.helperDepth - 1; index >= 0; index -= 1) {
    const body =
      index === program.helperDepth - 1
        ? effectInvocation(program.door, 'capability')
        : `return helper${index + 1}(capability);`;
    helpers.unshift(`function helper${index}(capability) { ${body} }`);
  }
  const invoke =
    program.helperDepth === 0
      ? effectInvocation(program.door, capability)
      : `helper0(${capability});`;
  return `import { endpoint } from '@kovojs/server';
${helpers.join('\n')}
export const analyzerOracle = endpoint('/__kovo/analyzer-oracle', {
  handler(_input, ctx) {
${aliases.join('\n')}
    ${invoke}
    return null;
  },
});
`;
}

export async function runAnalyzerSoundnessOracle(
  options: AnalyzerOracleRunOptions = {},
): Promise<AnalyzerOracleRunResult> {
  const seed = options.seed ?? 0x4b56_4149;
  const programs = generateAnalyzerOraclePrograms({
    ...(options.programBudget === undefined ? {} : { budget: options.programBudget }),
    seed,
  });
  const witnessedDoors = new Set<AnalyzerEffectDoor>();
  for (const program of programs) {
    witnessedDoors.add(program.door);
    const failure = await analyzerOracleFailure(program, options.canary);
    if (failure === undefined) continue;
    const minimized = await minimizeAnalyzerOracleFailure(program, options.canary);
    const minimizedFailure = (await analyzerOracleFailure(minimized, options.canary)) ?? failure;
    const destination = persistAnalyzerOracleFailure(minimizedFailure, {
      ...(options.artifactDirectory === undefined
        ? {}
        : { artifactDirectory: options.artifactDirectory }),
      ...(options.profile === undefined ? {} : { profile: options.profile }),
      seed,
    });
    throw new Error(
      `Analyzer soundness oracle failed for ${program.id}: ${failure.detail}; counterexample=${destination}`,
    );
  }
  return {
    checkedPrograms: programs.length,
    seed: `0x${seed.toString(16).padStart(8, '0')}`,
    witnessedDoors: [...witnessedDoors].sort(),
  };
}

async function analyzerOracleFailure(
  program: AnalyzerOracleProgram,
  canary: AnalyzerOracleCanary | undefined,
): Promise<AnalyzerOracleFailure | undefined> {
  const source = renderAnalyzerOracleSource(program);
  const result = compileComponentModule({
    fileName: `src/${program.id}.tsx`,
    source,
  });
  const securityDiagnostics = result.diagnostics.filter(
    (diagnostic) => diagnostic.code === 'KV449',
  );
  if (securityDiagnostics.length > 0) {
    return {
      abstractPredicted: [],
      concreteExpected: interpretAnalyzerOracleProgram(program),
      detail: `generated supported-language program closed: ${securityDiagnostics[0]!.message}`,
      emittedObserved: [],
      program,
      source,
    };
  }

  const abstractPredicted = result.componentGraphFacts
    .flatMap((fact) => fact.securitySemanticGraph?.roots ?? [])
    .flatMap((root) => root.traces)
    .flatMap((trace): ObservedEffect[] =>
      trace.verdict === 'proved' &&
      trace.sink.kind !== 'server.handler.root' &&
      trace.sink.kind !== 'server.helper.call'
        ? [{ door: trace.sink.door, kind: trace.sink.kind }]
        : [],
    )
    .filter((effect) => effect.kind !== canary?.dropAbstractKind);
  const concreteExpected = interpretAnalyzerOracleProgram(program);
  const serverModule = result.files.find((file) => file.kind === 'server')?.source;
  if (serverModule === undefined) {
    return {
      abstractPredicted,
      concreteExpected,
      detail: 'compiler emitted no server module',
      emittedObserved: [],
      program,
      source,
    };
  }
  const emittedObserved = await executeEmittedAnalyzerOracleModule(
    serverModule,
    canary?.dropObservedDoor,
  );
  if (!sameEffectMultiset(concreteExpected, emittedObserved)) {
    return {
      abstractPredicted,
      concreteExpected,
      detail: 'independent concrete semantics differ from instrumented emitted effect doors',
      emittedObserved,
      program,
      source,
    };
  }
  const predictedKeys = new Set(abstractPredicted.map(effectKey));
  const missed = emittedObserved.filter((effect) => !predictedKeys.has(effectKey(effect)));
  if (missed.length > 0) {
    return {
      abstractPredicted,
      concreteExpected,
      detail: `observed is not a subset of abstract-predicted: ${missed.map(effectKey).join(', ')}`,
      emittedObserved,
      program,
      source,
    };
  }
  return undefined;
}

async function executeEmittedAnalyzerOracleModule(
  emittedServerModule: string,
  dropObservedDoor: AnalyzerEffectDoor | undefined,
): Promise<ObservedEffect[]> {
  const wrapperUrl = javascriptDataUrl(
    `${emittedServerModule}\n//# sourceURL=kovo-oracle-wrapper.mjs`,
  );
  const wrapper = (await import(wrapperUrl)) as { readonly renderSource?: () => string };
  if (typeof wrapper.renderSource !== 'function') {
    throw new TypeError('Compiled server module did not export renderSource().');
  }
  const loweredSource = wrapper.renderSource();
  const endpointStubUrl = javascriptDataUrl(
    'export function endpoint(path, options) { return Object.freeze({ ...options, path }); }',
  );
  const instrumentedSource = rewriteServerImport(loweredSource, endpointStubUrl);
  const executableSource = ts.transpileModule(instrumentedSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2024,
    },
    fileName: 'analyzer-oracle-emitted.tsx',
  }).outputText;
  const moduleUrl = javascriptDataUrl(
    `${executableSource}\n//# sourceURL=kovo-oracle-emitted-${emittedModuleSequence++}.mjs`,
  );
  const generated = (await import(moduleUrl)) as {
    readonly analyzerOracle?: { readonly handler?: (input: unknown, context: unknown) => unknown };
  };
  if (typeof generated.analyzerOracle?.handler !== 'function') {
    throw new TypeError('Compiled oracle module did not retain the endpoint handler.');
  }
  const observed: ObservedEffect[] = [];
  const append = (door: AnalyzerEffectDoor, effect: ObservedEffect): void => {
    if (door !== dropObservedDoor) observed.push(effect);
  };
  const context: Record<string, unknown> = {};
  Object.assign(context, {
    actAs: () => {
      append('ctx.actAs', { door: 'principal-scope', kind: 'server.authority.scope' });
      return context;
    },
    db: {
      insert: () => {
        append('ctx.db.insert', { door: 'managed-db', kind: 'server.database.write' });
        return null;
      },
      select: () => {
        append('ctx.db.select', { door: 'managed-db', kind: 'server.database.read' });
        return [];
      },
    },
    fetch: () => {
      append('ctx.fetch', { door: 'ctx.fetch', kind: 'server.egress.request' });
      return null;
    },
    headers: {
      set: () =>
        append('ctx.headers.set', {
          door: 'structured-headers',
          kind: 'server.response.header',
        }),
    },
    schedule: () => {
      append('ctx.schedule', { door: 'task-context', kind: 'server.task.compose' });
      return null;
    },
    setCookie: () =>
      append('ctx.setCookie', {
        door: 'context.setCookie',
        kind: 'server.response.cookie',
      }),
    storage: {
      get: () => {
        append('ctx.storage.get', {
          door: 'framework-storage',
          kind: 'server.storage.read',
        });
        return null;
      },
      put: () =>
        append('ctx.storage.put', {
          door: 'framework-storage',
          kind: 'server.storage.write',
        }),
    },
  });
  await generated.analyzerOracle.handler({}, context);
  return observed;
}

function rewriteServerImport(source: string, endpointStubUrl: string): string {
  const singleQuoted = "'@kovojs/server'";
  const doubleQuoted = '"@kovojs/server"';
  const singleCount = source.split(singleQuoted).length - 1;
  const doubleCount = source.split(doubleQuoted).length - 1;
  if (singleCount + doubleCount !== 1) {
    throw new TypeError('Oracle emitted source must contain exactly one @kovojs/server import.');
  }
  const rewritten = source
    .replace(singleQuoted, JSON.stringify(endpointStubUrl))
    .replace(doubleQuoted, JSON.stringify(endpointStubUrl));
  if (/\bfrom\s+['"]@kovojs\//u.test(rewritten)) {
    throw new TypeError('Oracle emitted source retained an uninstrumented Kovo import.');
  }
  return rewritten;
}

async function minimizeAnalyzerOracleFailure(
  program: AnalyzerOracleProgram,
  canary: AnalyzerOracleCanary | undefined,
): Promise<AnalyzerOracleProgram> {
  let current = program;
  for (const candidate of [
    { ...current, aliasDepth: 0, id: `${current.id}-min-alias` },
    { ...current, helperDepth: 0, id: `${current.id}-min-helper` },
    { ...current, aliasDepth: 0, helperDepth: 0, id: `${current.id}-min` },
  ]) {
    if ((await analyzerOracleFailure(candidate, canary)) !== undefined) current = candidate;
  }
  return current;
}

function persistAnalyzerOracleFailure(
  failure: AnalyzerOracleFailure,
  options: {
    readonly artifactDirectory?: string;
    readonly profile?: string;
    readonly seed: number;
  },
): string {
  const profile = options.profile ?? process.env.KOVO_SECURITY_FUZZ_PROFILE ?? 'nightly';
  const directory =
    options.artifactDirectory ??
    path.join(
      process.cwd(),
      '.kovo/security-failures/security-fuzz-campaign',
      profile,
      'analyzer-soundness',
      'observed-subset-abstract',
    );
  mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, 'analyzer-minimized-counterexample.json');
  const seed = `0x${options.seed.toString(16).padStart(8, '0')}`;
  const record = {
    schema: analyzerSoundnessCounterexampleSchema,
    campaignVersion: 1,
    profile,
    family: 'analyzer-soundness',
    caseId: 'observed-subset-abstract',
    seed: { algorithm: 'mulberry32', value: seed, version: 1 },
    decisionRole: 'normative',
    classification: 'normative-property-violation',
    safetyVerdict: 'unsafe',
    minimization: 'one independently replayable generated program',
    replayVerified: true,
    replay: {
      command:
        'KOVO_SECURITY_FUZZ_SEED=0x4b564149 pnpm exec vitest --run packages/compiler/src/security-analyzer-soundness-oracle.test.ts',
      environment: { KOVO_SECURITY_FUZZ_SEED: seed },
    },
    counterexample: failure,
  };
  writeFileSync(destination, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return destination;
}

function transferWitnessSource(id: SecurityAbstractTransferId): string {
  switch (id) {
    case 'alias.fixed-point':
      return 'const second = first; const first = ctx.fetch; second(url);';
    case 'alias.const-preserve':
      return 'const capability = ctx.fetch; capability(url);';
    case 'alias.mutable-authority-top':
      return 'let capability = ctx.fetch; capability(url);';
    case 'alias.join':
      return 'const capability = condition ? ctx.fetch : ctx.fetch; capability(url);';
    case 'binding.static-member':
      return 'const { fetch: capability } = ctx; capability(url);';
    case 'binding.rest':
      return 'const { ...authority } = ctx; authority.fetch(url);';
    case 'binding.default-join':
      return 'const { fetch: capability = local } = ctx; capability(url);';
    case 'expression.identifier':
      return 'capability(url);';
    case 'expression.implicit-protocol':
      return 'consume({ [Symbol.iterator]() {} });';
    case 'expression.new':
      return 'new Response(body);';
    case 'expression.call-scope':
      return 'ctx.actAs(principal);';
    case 'expression.call-scoped-key':
      return 'ctx.stateKey(scope, value);';
    case 'expression.call-intrinsic-identity':
      return 'Object.freeze(ctx.fetch)(url);';
    case 'expression.call-response':
      return 'Response.json(value);';
    case 'expression.call-unknown-authority':
      return 'computedAuthority();';
    case 'expression.call-local':
      return 'local(value);';
    case 'expression.binary-join':
      return 'consume(ctx.fetch + local);';
    case 'expression.conditional-join':
      return 'const capability = condition ? ctx.fetch : ctx.fetch;';
    case 'expression.static-member':
      return 'ctx.headers.set(name, value);';
    case 'expression.fallthrough-foreign':
      return '[foreignExecutable];';
    case 'expression.fallthrough-authority':
      return '[ctx.fetch];';
    case 'helper.call-map':
      return 'function helper(capability) { capability(url); } helper(ctx.fetch);';
    case 'helper.spread-close':
      return 'function helper(capability) {} helper(...[ctx.fetch]);';
    case 'helper.rest-argument-close':
      return 'function helper(local, ...rest) {} helper(value, ctx.fetch);';
    case 'helper.extra-argument-close':
      return 'function helper(local) {} helper(value, ctx.fetch);';
    case 'helper.rest-parameter-close':
      return 'function helper(...capabilities) {} helper(ctx.fetch);';
    case 'helper.arguments-close':
      return 'function helper(capability) { return arguments[0]; } helper(ctx.fetch);';
    case 'helper.cycle-close':
      return 'function helper(capability) { return helper(capability); } helper(ctx.fetch);';
    case 'budget.call-depth-close':
      return `${Array.from(
        { length: securityAbstractInterpreterCensus.resourceBounds.callDepth + 2 },
        (_unused, index) =>
          index === securityAbstractInterpreterCensus.resourceBounds.callDepth + 1
            ? `function helper${index}(capability) { capability(url); }`
            : `function helper${index}(capability) { helper${index + 1}(capability); }`,
      ).join('\n')}\nhelper0(ctx.fetch);`;
    case 'budget.node-count-close':
      return Array.from(
        { length: securityAbstractInterpreterCensus.resourceBounds.nodes + 1 },
        () => ';',
      ).join('\n');
    case 'budget.operation-count-close':
      return Array.from(
        { length: securityAbstractInterpreterCensus.resourceBounds.operations + 1 },
        () => 'ctx.db.select();',
      ).join('\n');
    case 'budget.summary-count-close':
      return Array.from(
        { length: securityAbstractInterpreterCensus.resourceBounds.summaries + 1 },
        (_unused, index) =>
          `function helper${index}(capability) { capability(); }\nhelper${index}(ctx.db.select);`,
      ).join('\n');
    case 'effect.invoke':
      return 'ctx.fetch(url);';
  }
}

function doorExpression(door: AnalyzerEffectDoor): string {
  return door;
}

function effectInvocation(door: AnalyzerEffectDoor, capability: string): string {
  switch (door) {
    case 'ctx.actAs':
      return `${capability}({ id: 'principal' });`;
    case 'ctx.db.insert':
      return `${capability}('records');`;
    case 'ctx.db.select':
    case 'ctx.schedule':
      return `${capability}();`;
    case 'ctx.fetch':
      return `${capability}('https://oracle.invalid/resource');`;
    case 'ctx.headers.set':
      return `${capability}('Cache-Control', 'no-store');`;
    case 'ctx.setCookie':
      return `${capability}('oracle', '1');`;
    case 'ctx.storage.get':
      return `${capability}('oracle/key');`;
    case 'ctx.storage.put':
      return `${capability}('oracle/key', 'value');`;
  }
}

function javascriptDataUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

function effectKey(effect: ObservedEffect): string {
  return `${effect.kind}\u0000${effect.door}`;
}

function sameEffectMultiset(
  expected: readonly ObservedEffect[],
  actual: readonly ObservedEffect[],
): boolean {
  return (
    expected.length === actual.length &&
    [...expected]
      .map(effectKey)
      .sort()
      .every((value, index) => value === [...actual].map(effectKey).sort()[index])
  );
}

if (
  securityAbstractTransferIds.length !== analyzerOracleProductionIds.length ||
  securityAbstractTransferIds.some((id, index) => id !== analyzerOracleProductionIds[index])
) {
  throw new TypeError('Analyzer oracle productions differ from the transfer census vocabulary.');
}
