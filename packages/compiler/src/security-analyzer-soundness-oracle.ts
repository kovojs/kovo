import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import * as ts from 'typescript';

import type {
  SecurityOperationDoor,
  SecuritySemanticClosedReason,
  ServerSecurityOperationKind,
} from '@kovojs/core/internal/security-operation-ir';

import { compileComponentModule } from './index.js';
import {
  captureSecurityAbstractTransfers,
  securityAbstractInterpreterCensus,
  securityAbstractTransferIds,
  serverAliasJoinTransfer,
  serverBinaryTransfer,
  serverBindingDefaultTransfer,
  serverConditionalTransfer,
  type SecurityAbstractTransferId,
} from './scan/security-abstract-interpreter.js';
import {
  captureServerProvenancePrecisionGrants,
  serverProvenancePrecisionGrantRows,
  type ServerProvenancePrecisionGrantId,
} from './scan/security-provenance-precision-grants.js';
import type { ServerValueProvenance } from './scan/security-provenance-relation.js';

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
  readonly noise: boolean;
  readonly transferId: SecurityAbstractTransferId;
  readonly variant: 'composition' | 'transfer';
}

export interface AnalyzerOracleTransferWitness {
  readonly expectation: AnalyzerOracleExpectation;
  readonly id: SecurityAbstractTransferId;
  readonly program: AnalyzerOracleProgram;
  readonly production: string;
  readonly source: string;
  readonly witnessedElements: readonly string[];
}

export interface AnalyzerOracleLatticeWitness {
  readonly element: ServerValueProvenance;
  readonly expected: AnalyzerOracleLatticeBehavior;
  readonly production: 'lattice-element';
}

export interface AnalyzerOracleLatticeBehavior {
  readonly aliasFromBottom: ServerValueProvenance;
  readonly binaryWithLocal: ServerValueProvenance;
  readonly conditionalWithLocal: ServerValueProvenance;
  readonly defaultWithLocal: ServerValueProvenance;
}

export interface AnalyzerOraclePrecisionGrantWitness {
  readonly expectedProvenance: Exclude<ServerValueProvenance, 'unknown-authority'>;
  readonly id: ServerProvenancePrecisionGrantId;
  readonly source: string;
  readonly transferId: SecurityAbstractTransferId;
}

type AnalyzerOracleExpectation =
  | {
      readonly effects: readonly ObservedEffect[];
      readonly verdict: 'accepted';
    }
  | {
      readonly reason: SecuritySemanticClosedReason;
      readonly verdict: 'closed';
    };

export interface AnalyzerOracleCanary {
  readonly dropObservedDoor?: AnalyzerEffectDoor;
  readonly weakenTransferId?: 'effect.invoke';
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
  readonly witnessedLatticeElements: readonly ServerValueProvenance[];
  readonly witnessedPrecisionGrants: readonly ServerProvenancePrecisionGrantId[];
  readonly witnessedTransfers: readonly SecurityAbstractTransferId[];
}

export interface AnalyzerOracleReplayResult {
  readonly detail: string;
  readonly programId: string;
  readonly witnessedTransfers: readonly SecurityAbstractTransferId[];
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
  readonly witnessedTransfers: readonly SecurityAbstractTransferId[];
}

interface AnalyzerOracleReplayInput {
  readonly canary: AnalyzerOracleCanary;
  readonly expectedDetail: string;
  readonly program: AnalyzerOracleProgram;
  readonly seed: string;
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

const minimumAnalyzerOracleProgramBudget = analyzerOracleProductionIds.length + effectDoors.length;

/**
 * Independent concrete semantics for the declared generated language.
 *
 * This switch intentionally does not consume the analyzer's provenance relation or operation-door
 * table. A disagreement with compiler output is therefore capable of falsifying either side.
 */
export function interpretAnalyzerOracleProgram(
  program: AnalyzerOracleProgram,
): AnalyzerOracleExpectation {
  if (program.variant === 'transfer') return transferWitnessExpectation(program.transferId);
  return { effects: effectForDoor(program.door), verdict: 'accepted' };
}

function effectForDoor(door: AnalyzerEffectDoor): readonly ObservedEffect[] {
  switch (door) {
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
  if (!Number.isSafeInteger(budget) || budget < minimumAnalyzerOracleProgramBudget) {
    throw new TypeError(
      `Analyzer oracle budget must be at least ${minimumAnalyzerOracleProgramBudget} so every transfer and effect door is witnessed.`,
    );
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
  const programs: AnalyzerOracleProgram[] = analyzerOracleProductionIds.map(
    (transferId, index) => ({
      aliasDepth: 0,
      door: transferWitnessDoor(transferId),
      helperDepth: 0,
      id: `transfer-${index.toString().padStart(2, '0')}-${transferId.replaceAll('.', '-')}`,
      noise: true,
      transferId,
      variant: 'transfer',
    }),
  );
  for (let index = programs.length; index < budget; index += 1) {
    const compositionIndex = index - analyzerOracleProductionIds.length;
    const door =
      compositionIndex < effectDoors.length
        ? effectDoors[compositionIndex]!
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
      noise: true,
      transferId: 'effect.invoke',
      variant: 'composition',
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
    const program: AnalyzerOracleProgram = {
      aliasDepth: 0,
      door: transferWitnessDoor(id),
      helperDepth: 0,
      id: `transfer-${index.toString().padStart(2, '0')}-${id.replaceAll('.', '-')}`,
      noise: true,
      transferId: id,
      variant: 'transfer',
    };
    return {
      expectation: interpretAnalyzerOracleProgram(program),
      id,
      program,
      production: transfer.production,
      source: renderAnalyzerOracleSource(program),
      witnessedElements: [element],
    };
  });
}

export function generateAnalyzerOracleLatticeWitnesses(): AnalyzerOracleLatticeWitness[] {
  return securityAbstractInterpreterCensus.lattice.elements.map((element) => ({
    element,
    expected: independentLatticeBehavior(element),
    production: 'lattice-element',
  }));
}

/** Exactly one deterministic sampling obligation for every reviewed below-top precision grant. */
export function generateAnalyzerOraclePrecisionGrantWitnesses(): AnalyzerOraclePrecisionGrantWitness[] {
  return serverProvenancePrecisionGrantRows.map((row) => ({
    expectedProvenance: row.generatorExpectedProvenance,
    id: row.id,
    source: precisionGrantWitnessSource(row.id),
    transferId: precisionGrantTransferId(row.generatorTransfer),
  }));
}

export function evaluateAnalyzerOracleLatticeWitness(
  witness: AnalyzerOracleLatticeWitness,
): AnalyzerOracleLatticeBehavior {
  const aliasFromBottom = serverAliasJoinTransfer(undefined, witness.element);
  if (aliasFromBottom === undefined) {
    throw new TypeError(`Lattice element ${witness.element} did not materialize from bottom.`);
  }
  return {
    aliasFromBottom,
    binaryWithLocal: serverBinaryTransfer(witness.element, 'local'),
    conditionalWithLocal: serverConditionalTransfer(witness.element, 'local'),
    defaultWithLocal: serverBindingDefaultTransfer(witness.element, 'local'),
  };
}

export function analyzerOracleWitnessedLatticeElements(): readonly string[] {
  return generateAnalyzerOracleLatticeWitnesses().map((witness) => witness.element);
}

export function renderAnalyzerOracleSource(program: AnalyzerOracleProgram): string {
  if (program.variant === 'transfer') {
    return transferWitnessSource(program.transferId, program.noise);
  }
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
${program.noise ? '    const oracleNoise = 0;\n    void oracleNoise;\n' : ''}${aliases.join('\n')}
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
  const latticeWitnesses = generateAnalyzerOracleLatticeWitnesses();
  for (const witness of latticeWitnesses) {
    const actual = evaluateAnalyzerOracleLatticeWitness(witness);
    if (!sameLatticeBehavior(witness.expected, actual)) {
      throw new Error(
        `Analyzer lattice behavior drifted for ${witness.element}: expected=${JSON.stringify(witness.expected)} actual=${JSON.stringify(actual)}`,
      );
    }
  }
  const precisionGrantWitnesses = generateAnalyzerOraclePrecisionGrantWitnesses();
  const witnessedPrecisionGrants = new Set<ServerProvenancePrecisionGrantId>();
  for (const witness of precisionGrantWitnesses) {
    const abstractCapture = captureSecurityAbstractTransfers(() =>
      captureServerProvenancePrecisionGrants(() =>
        compileComponentModule({
          fileName: `src/precision-${witness.id}.tsx`,
          source: witness.source,
        }),
      ),
    );
    const observation = abstractCapture.result.observations.find(
      (candidate) =>
        candidate.id === witness.id && candidate.provenance === witness.expectedProvenance,
    );
    if (observation === undefined) {
      throw new Error(
        `Analyzer precision witness ${witness.id} did not observe ${witness.expectedProvenance}; observed=${abstractCapture.result.observations
          .map((candidate) => `${candidate.id}:${candidate.provenance}`)
          .join(',')}`,
      );
    }
    if (!abstractCapture.witnessedTransfers.includes(witness.transferId)) {
      throw new Error(
        `Analyzer precision witness ${witness.id} did not execute transfer ${witness.transferId}.`,
      );
    }
    witnessedPrecisionGrants.add(witness.id);
  }
  const orderedWitnessedPrecisionGrants = serverProvenancePrecisionGrantRows
    .map((row) => row.id)
    .filter((id) => witnessedPrecisionGrants.has(id));
  if (orderedWitnessedPrecisionGrants.length !== serverProvenancePrecisionGrantRows.length) {
    throw new Error(
      `Analyzer oracle did not execute every precision grant: ${orderedWitnessedPrecisionGrants.join(', ')}`,
    );
  }
  const witnessedDoors = new Set<AnalyzerEffectDoor>();
  const witnessedTransfers = new Set<SecurityAbstractTransferId>();
  for (const program of programs) {
    witnessedDoors.add(program.door);
    const check = await checkAnalyzerOracleProgram(program, options.canary);
    if (check.ok) {
      for (const transfer of check.witnessedTransfers) witnessedTransfers.add(transfer);
      continue;
    }
    const failure = check.failure;
    const minimized = await minimizeAnalyzerOracleFailure(program, options.canary);
    const minimizedCheck = await checkAnalyzerOracleProgram(minimized, options.canary);
    const minimizedFailure = minimizedCheck.ok ? failure : minimizedCheck.failure;
    const destination = await persistAnalyzerOracleFailure(minimizedFailure, options.canary, {
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
  const orderedWitnessedTransfers = securityAbstractTransferIds.filter((id) =>
    witnessedTransfers.has(id),
  );
  if (
    orderedWitnessedTransfers.length !== securityAbstractTransferIds.length ||
    orderedWitnessedTransfers.some((id, index) => id !== securityAbstractTransferIds[index])
  ) {
    throw new Error(
      `Analyzer oracle did not execute every transfer witness: ${orderedWitnessedTransfers.join(', ')}`,
    );
  }
  return {
    checkedPrograms: programs.length + precisionGrantWitnesses.length,
    seed: `0x${seed.toString(16).padStart(8, '0')}`,
    witnessedDoors: [...witnessedDoors].sort(),
    witnessedLatticeElements: latticeWitnesses.map((witness) => witness.element),
    witnessedPrecisionGrants: orderedWitnessedPrecisionGrants,
    witnessedTransfers: orderedWitnessedTransfers,
  };
}

type AnalyzerOracleProgramCheck =
  | {
      readonly ok: true;
      readonly witnessedTransfers: readonly SecurityAbstractTransferId[];
    }
  | {
      readonly failure: AnalyzerOracleFailure;
      readonly ok: false;
      readonly witnessedTransfers: readonly SecurityAbstractTransferId[];
    };

async function checkAnalyzerOracleProgram(
  program: AnalyzerOracleProgram,
  canary: AnalyzerOracleCanary | undefined,
): Promise<AnalyzerOracleProgramCheck> {
  const source = renderAnalyzerOracleSource(program);
  const weakened =
    canary?.weakenTransferId === program.transferId ? canary.weakenTransferId : undefined;
  const capture = captureSecurityAbstractTransfers(
    () =>
      compileComponentModule({
        fileName: `src/${program.id}.tsx`,
        source,
      }),
    weakened === undefined ? {} : { weakenTransferId: weakened },
  );
  const { result, witnessedTransfers } = capture;
  const expectation = interpretAnalyzerOracleProgram(program);
  const fail = (
    detail: string,
    values: {
      readonly abstractPredicted?: readonly ObservedEffect[];
      readonly concreteExpected?: readonly ObservedEffect[];
      readonly emittedObserved?: readonly ObservedEffect[];
    } = {},
  ): AnalyzerOracleProgramCheck => ({
    failure: {
      abstractPredicted: values.abstractPredicted ?? [],
      concreteExpected: values.concreteExpected ?? [],
      detail,
      emittedObserved: values.emittedObserved ?? [],
      program,
      source,
      witnessedTransfers,
    },
    ok: false,
    witnessedTransfers,
  });
  if (!witnessedTransfers.includes(program.transferId)) {
    return fail(`declared transfer witness did not execute marker ${program.transferId}`);
  }
  const securityDiagnostics = result.diagnostics.filter(
    (diagnostic) => diagnostic.code === 'KV449',
  );
  const closedReasons = result.componentGraphFacts
    .flatMap((fact) => fact.securitySemanticGraph?.roots ?? [])
    .flatMap((root) => root.traces)
    .flatMap((trace) => (trace.verdict === 'closed' ? [trace.reason] : []));
  if (expectation.verdict === 'closed') {
    const uniqueReasons = [...new Set(closedReasons)];
    if (
      securityDiagnostics.length === 0 ||
      uniqueReasons.length !== 1 ||
      uniqueReasons[0] !== expectation.reason ||
      !securityDiagnostics.some((diagnostic) =>
        diagnostic.message.includes(`verdict=closed:${expectation.reason}`),
      )
    ) {
      return fail(
        `expected exact fail-closed reason ${expectation.reason}; diagnostics=${securityDiagnostics.map((diagnostic) => diagnostic.message).join(' | ')}; reasons=${uniqueReasons.join(',')}`,
      );
    }
    return { ok: true, witnessedTransfers };
  }
  if (securityDiagnostics.length > 0) {
    return fail(`generated accepted program closed: ${securityDiagnostics[0]!.message}`, {
      concreteExpected: expectation.effects,
    });
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
    );
  const concreteExpected = expectation.effects;
  const serverModule = result.files.find((file) => file.kind === 'server')?.source;
  if (serverModule === undefined) {
    return fail('compiler emitted no server module', { abstractPredicted, concreteExpected });
  }
  const emittedObserved = await executeEmittedAnalyzerOracleModule(
    serverModule,
    canary?.dropObservedDoor,
  );
  if (!sameEffectMultiset(concreteExpected, emittedObserved)) {
    return fail('independent concrete semantics differ from instrumented emitted effect doors', {
      abstractPredicted,
      concreteExpected,
      emittedObserved,
    });
  }
  const predictedKeys = new Set(abstractPredicted.map(effectKey));
  const missed = emittedObserved.filter((effect) => !predictedKeys.has(effectKey(effect)));
  if (missed.length > 0) {
    return fail(
      `observed is not a subset of abstract-predicted: ${missed.map(effectKey).join(', ')}`,
      { abstractPredicted, concreteExpected, emittedObserved },
    );
  }
  return { ok: true, witnessedTransfers };
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
  const endpointStubUrl = javascriptDataUrl(`
export function endpoint(path, options) { return Object.freeze({ ...options, path }); }
export function scopedKey(_request, value) { return String(value); }
export function task(name, options) { return Object.freeze({ ...options, name }); }
`);
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
    readonly analyzerOracle?: {
      readonly handler?: (input: unknown, context: unknown) => unknown;
      readonly run?: (input: unknown, context: unknown) => unknown;
    };
  };
  const callable = generated.analyzerOracle?.handler ?? generated.analyzerOracle?.run;
  if (typeof callable !== 'function') {
    throw new TypeError('Compiled oracle module did not retain its handler or task run function.');
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
    request: {},
    schedule: () => {
      append('ctx.schedule', { door: 'task-context', kind: 'server.task.compose' });
      return null;
    },
    stateKey: (scope: unknown, value: unknown) => `${String(scope)}:${String(value)}`,
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
  await callable({}, context);
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
    { ...current, id: `${current.id}-min-noise`, noise: false },
    { ...current, aliasDepth: 0, id: `${current.id}-min-alias` },
    { ...current, helperDepth: 0, id: `${current.id}-min-helper` },
    {
      ...current,
      aliasDepth: 0,
      helperDepth: 0,
      id: `${current.id}-min`,
      noise: false,
    },
  ]) {
    if (!(await checkAnalyzerOracleProgram(candidate, canary)).ok) current = candidate;
  }
  return current;
}

async function persistAnalyzerOracleFailure(
  failure: AnalyzerOracleFailure,
  canary: AnalyzerOracleCanary | undefined,
  options: {
    readonly artifactDirectory?: string;
    readonly profile?: string;
    readonly seed: number;
  },
): Promise<string> {
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
  const seed = `0x${options.seed.toString(16).padStart(8, '0')}`;
  const destination = path.join(directory, 'analyzer-minimized-counterexample.json');
  const replayInput = normalizeAnalyzerOracleReplayInput({
    canary: canary ?? {},
    expectedDetail: failure.detail,
    program: failure.program,
    seed,
  });
  const replayEnvironment = {
    KOVO_ANALYZER_ORACLE_REPLAY_FILE: destination,
    KOVO_SECURITY_FUZZ_SEED: seed,
  };
  const replayArguments = [
    'exec',
    'vitest',
    '--run',
    'packages/compiler/src/security-analyzer-soundness-oracle.test.ts',
    '-t',
    'replays persisted analyzer counterexample from KOVO_ANALYZER_ORACLE_REPLAY_FILE',
    '--reporter=dot',
  ];
  const record = {
    schema: analyzerSoundnessCounterexampleSchema,
    campaignVersion: 1,
    profile,
    family: 'analyzer-soundness',
    caseId: 'observed-subset-abstract',
    seed: { algorithm: 'mulberry32', value: seed, version: 1 },
    decisionRole: 'normative',
    classification: 'unconfirmed-failure',
    safetyVerdict: 'undetermined',
    minimization: 'unconfirmed',
    replayVerified: false,
    replay: {
      argv: ['pnpm', ...replayArguments],
      command: `${shellEnvironment(replayEnvironment)} pnpm ${replayArguments
        .map(shellArgument)
        .join(' ')}`,
      environment: replayEnvironment,
      input: replayInput,
      inputDigest: digestAnalyzerOracleReplayInput(replayInput),
    },
    counterexample: failure,
  };
  writeFileSync(destination, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await replayAnalyzerSoundnessCounterexample(destination);
  const verifiedRecord = {
    ...record,
    classification: 'normative-property-violation',
    minimization: 'one independently replayable generated program',
    replayVerified: true,
    safetyVerdict: 'unsafe',
  };
  writeFileSync(destination, `${JSON.stringify(verifiedRecord, null, 2)}\n`, 'utf8');
  return destination;
}

/** Test-only fail-closed probe for the organic, no-canary persistence path. */
export async function persistAnalyzerOracleNonCanaryReplayProbeForTest(
  artifactDirectory: string,
): Promise<string> {
  const program = generateAnalyzerOraclePrograms({
    budget: minimumAnalyzerOracleProgramBudget,
    seed: 0x4b56_4149,
  }).find(
    (candidate) => candidate.variant === 'transfer' && candidate.transferId === 'effect.invoke',
  );
  if (program === undefined) {
    throw new TypeError('Analyzer oracle test probe could not find the effect.invoke witness.');
  }
  const minimizedProgram: AnalyzerOracleProgram = {
    ...program,
    id: `${program.id}-organic-replay-probe`,
    noise: false,
  };
  return persistAnalyzerOracleFailure(
    {
      abstractPredicted: effectForDoor('ctx.fetch'),
      concreteExpected: effectForDoor('ctx.fetch'),
      detail: 'test-only non-canary persistence probe',
      emittedObserved: effectForDoor('ctx.fetch'),
      program: minimizedProgram,
      source: renderAnalyzerOracleSource(minimizedProgram),
      witnessedTransfers: ['effect.invoke'],
    },
    undefined,
    { artifactDirectory, profile: 'test', seed: 0x4b56_4149 },
  );
}

/**
 * Load and independently rerun one persisted minimized oracle witness.
 *
 * A green test that merely expects the original campaign to reject is not replay evidence. This
 * path consumes only the serialized finite program and canary, verifies their binding digest, and
 * requires the same unsafe disagreement from a fresh compilation (SPEC §11.2).
 */
export async function replayAnalyzerSoundnessCounterexample(
  artifactPath: string,
): Promise<AnalyzerOracleReplayResult> {
  const document = parseRecord(
    JSON.parse(readFileSync(path.resolve(artifactPath), 'utf8')) as unknown,
    'counterexample artifact',
  );
  if (document.schema !== analyzerSoundnessCounterexampleSchema) {
    throw new TypeError(
      `Analyzer oracle replay requires schema ${analyzerSoundnessCounterexampleSchema}.`,
    );
  }
  const replay = parseRecord(document.replay, 'counterexample replay');
  const input = normalizeAnalyzerOracleReplayInput(replay.input);
  if (replay.inputDigest !== digestAnalyzerOracleReplayInput(input)) {
    throw new TypeError(
      'Analyzer oracle replay input digest does not match the persisted witness.',
    );
  }
  const seed = parseRecord(document.seed, 'counterexample seed');
  if (seed.value !== input.seed) {
    throw new TypeError('Analyzer oracle replay seed differs from the persisted witness seed.');
  }
  const counterexample = parseRecord(document.counterexample, 'counterexample failure');
  const counterexampleProgram = normalizeAnalyzerOracleProgram(counterexample.program);
  if (JSON.stringify(counterexampleProgram) !== JSON.stringify(input.program)) {
    throw new TypeError(
      'Analyzer oracle replay program differs from the persisted counterexample.',
    );
  }
  if (counterexample.source !== renderAnalyzerOracleSource(input.program)) {
    throw new TypeError(
      'Analyzer oracle replay source differs from the finite program descriptor.',
    );
  }
  if (counterexample.detail !== input.expectedDetail) {
    throw new TypeError('Analyzer oracle replay detail differs from the persisted expectation.');
  }

  const check = await checkAnalyzerOracleProgram(input.program, input.canary);
  if (check.ok) {
    throw new Error(
      `Analyzer oracle replay did not reproduce the unsafe verdict for ${input.program.id}.`,
    );
  }
  if (check.failure.detail !== input.expectedDetail) {
    throw new Error(
      `Analyzer oracle replay reproduced a different failure: expected=${input.expectedDetail}; actual=${check.failure.detail}`,
    );
  }
  return {
    detail: check.failure.detail,
    programId: input.program.id,
    witnessedTransfers: check.witnessedTransfers,
  };
}

export function digestAnalyzerOracleReplayInput(input: unknown): string {
  const normalized = normalizeAnalyzerOracleReplayInput(input);
  return `sha256:${createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`;
}

function normalizeAnalyzerOracleReplayInput(input: unknown): AnalyzerOracleReplayInput {
  const record = parseRecord(input, 'analyzer oracle replay input');
  requireExactRecordKeys(record, ['canary', 'expectedDetail', 'program', 'seed'], 'replay input');
  if (typeof record.expectedDetail !== 'string' || record.expectedDetail.length === 0) {
    throw new TypeError('Analyzer oracle replay expectedDetail must be a non-empty string.');
  }
  if (
    typeof record.seed !== 'string' ||
    !/^0x[0-9a-f]{8}$/u.test(record.seed) ||
    !Number.isSafeInteger(Number(record.seed))
  ) {
    throw new TypeError('Analyzer oracle replay seed must be one eight-digit hexadecimal uint32.');
  }
  return {
    canary: normalizeAnalyzerOracleCanary(record.canary),
    expectedDetail: record.expectedDetail,
    program: normalizeAnalyzerOracleProgram(record.program),
    seed: record.seed,
  };
}

function normalizeAnalyzerOracleCanary(canary: unknown): AnalyzerOracleCanary {
  const record = parseRecord(canary, 'analyzer oracle replay canary');
  const keys = Object.keys(record);
  if (keys.some((key) => key !== 'dropObservedDoor' && key !== 'weakenTransferId')) {
    throw new TypeError('Analyzer oracle replay canary contains an unknown field.');
  }
  const dropObservedDoor = record.dropObservedDoor;
  if (
    dropObservedDoor !== undefined &&
    (typeof dropObservedDoor !== 'string' ||
      !effectDoors.includes(dropObservedDoor as AnalyzerEffectDoor))
  ) {
    throw new TypeError('Analyzer oracle replay canary has an unknown observed door.');
  }
  const weakenTransferId = record.weakenTransferId;
  if (weakenTransferId !== undefined && weakenTransferId !== 'effect.invoke') {
    throw new TypeError('Analyzer oracle replay canary has an unknown weakened transfer.');
  }
  return {
    ...(dropObservedDoor === undefined
      ? {}
      : { dropObservedDoor: dropObservedDoor as AnalyzerEffectDoor }),
    ...(weakenTransferId === undefined ? {} : { weakenTransferId }),
  };
}

function normalizeAnalyzerOracleProgram(program: unknown): AnalyzerOracleProgram {
  const record = parseRecord(program, 'analyzer oracle replay program');
  requireExactRecordKeys(
    record,
    ['aliasDepth', 'door', 'helperDepth', 'id', 'noise', 'transferId', 'variant'],
    'replay program',
  );
  const aliasDepth = record.aliasDepth;
  const helperDepth = record.helperDepth;
  const door = record.door;
  const id = record.id;
  const noise = record.noise;
  const transferId = record.transferId;
  const variant = record.variant;
  if (
    !Number.isSafeInteger(aliasDepth) ||
    (aliasDepth as number) < 0 ||
    (aliasDepth as number) > securityAbstractInterpreterCensus.language.maxAliasDepth
  ) {
    throw new TypeError('Analyzer oracle replay alias depth is outside the finite language.');
  }
  if (
    !Number.isSafeInteger(helperDepth) ||
    (helperDepth as number) < 0 ||
    (helperDepth as number) > securityAbstractInterpreterCensus.language.maxHelperDepth
  ) {
    throw new TypeError('Analyzer oracle replay helper depth is outside the finite language.');
  }
  if (typeof door !== 'string' || !effectDoors.includes(door as AnalyzerEffectDoor)) {
    throw new TypeError('Analyzer oracle replay door is outside the finite language.');
  }
  if (typeof id !== 'string' || !/^[a-z0-9.-]+$/u.test(id)) {
    throw new TypeError('Analyzer oracle replay id is invalid.');
  }
  if (typeof noise !== 'boolean') {
    throw new TypeError('Analyzer oracle replay noise flag must be boolean.');
  }
  if (
    typeof transferId !== 'string' ||
    !securityAbstractTransferIds.includes(transferId as SecurityAbstractTransferId)
  ) {
    throw new TypeError('Analyzer oracle replay transfer is outside the census.');
  }
  if (variant !== 'composition' && variant !== 'transfer') {
    throw new TypeError('Analyzer oracle replay variant is invalid.');
  }
  const normalized: AnalyzerOracleProgram = {
    aliasDepth: aliasDepth as number,
    door: door as AnalyzerEffectDoor,
    helperDepth: helperDepth as number,
    id,
    noise,
    transferId: transferId as SecurityAbstractTransferId,
    variant,
  };
  if (
    variant === 'transfer' &&
    (normalized.aliasDepth !== 0 ||
      normalized.helperDepth !== 0 ||
      normalized.door !== transferWitnessDoor(normalized.transferId))
  ) {
    throw new TypeError('Analyzer oracle replay transfer descriptor is not canonical.');
  }
  if (variant === 'composition' && normalized.transferId !== 'effect.invoke') {
    throw new TypeError('Analyzer oracle replay composition must target effect.invoke.');
  }
  return normalized;
}

function parseRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactRecordKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record).sort();
  const orderedExpected = [...expected].sort();
  if (
    actual.length !== orderedExpected.length ||
    actual.some((key, index) => key !== orderedExpected[index])
  ) {
    throw new TypeError(`${label} must contain exactly ${orderedExpected.join(', ')}.`);
  }
}

function shellEnvironment(environment: Readonly<Record<string, string>>): string {
  return Object.entries(environment)
    .map(([key, value]) => `${key}=${shellArgument(value)}`)
    .join(' ');
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function precisionGrantTransferId(value: string): SecurityAbstractTransferId {
  if (isSecurityAbstractTransferId(value)) return value;
  throw new TypeError(`Precision-grant generator names unknown transfer ${value}.`);
}

function isSecurityAbstractTransferId(value: string): value is SecurityAbstractTransferId {
  return securityAbstractTransferIds.some((candidate) => candidate === value);
}

function precisionGrantWitnessSource(id: ServerProvenancePrecisionGrantId): string {
  switch (id) {
    case 'identifier-environment-lookup':
      return renderTransferModule(
        '',
        `const localValue = 1;
    const copiedValue = localValue;
    void copiedValue;
    ctx.fetch('https://oracle.invalid/precision-identifier');`,
        false,
      );
    case 'new-response-outcome':
      return renderTransferModule(
        '',
        `const value = new Response('oracle');
    void value;
    ctx.fetch('https://oracle.invalid/precision-new-response');`,
        false,
      );
    case 'new-foreign-executable':
      return renderTransferModule(
        '',
        `const value = new endpoint();
    void value;
    ctx.fetch('https://oracle.invalid/precision-new-foreign');`,
        false,
      );
    case 'new-local-constructor':
      return renderTransferModule(
        `class LocalValue {}`,
        `const value = new LocalValue();
    void value;
    ctx.fetch('https://oracle.invalid/precision-new-local');`,
        false,
      );
    case 'call-principal-scope':
      return renderTransferModule(
        '',
        `const scoped = ctx.actAs({ id: 'precision-principal' });
    void scoped;
    ctx.fetch('https://oracle.invalid/precision-scope');`,
        false,
      );
    case 'call-scoped-key':
      return `import { task } from '@kovojs/server';
export const analyzerOracle = task('precision-scoped-key', {
  run(_input, ctx) {
    const scoped = ctx.actAs({ id: 'precision-principal' });
    const key = scoped.stateKey('precision-value');
    ctx.storage.get(key);
    return null;
  },
});
`;
    case 'call-intrinsic-identity':
      return renderTransferModule(
        '',
        `const capability = Object.freeze(ctx.fetch);
    capability('https://oracle.invalid/precision-intrinsic');`,
        false,
      );
    case 'call-response-constructor':
      return renderTransferModule(
        '',
        `const value = Response.json({ ok: true });
    void value;
    ctx.fetch('https://oracle.invalid/precision-response-call');`,
        false,
      );
    case 'call-local':
      return renderTransferModule(
        `function local(value) { return value; }`,
        `const value = local(1);
    void value;
    ctx.fetch('https://oracle.invalid/precision-local-call');`,
        false,
      );
    case 'binary-finite-join':
      return renderTransferModule(
        '',
        `const value = 1 + 2;
    void value;
    ctx.fetch('https://oracle.invalid/precision-binary');`,
        false,
      );
    case 'conditional-finite-join':
      return renderTransferModule(
        '',
        `const value = true ? 1 : 2;
    void value;
    ctx.fetch('https://oracle.invalid/precision-conditional');`,
        false,
      );
    case 'static-member-relation':
      return renderTransferModule(
        '',
        `const value = ctx.headers;
    void value;
    ctx.fetch('https://oracle.invalid/precision-member');`,
        false,
      );
    case 'fallthrough-foreign-containment':
      return renderTransferModule(
        '',
        `const value = [endpoint];
    void value;
    ctx.fetch('https://oracle.invalid/precision-foreign-container');`,
        false,
      );
    case 'fallthrough-contained-local':
      return renderTransferModule(
        '',
        `const value = { answer: 42 };
    void value;
    ctx.fetch('https://oracle.invalid/precision-local-container');`,
        false,
      );
  }
}

function transferWitnessSource(id: SecurityAbstractTransferId, noise: boolean): string {
  switch (id) {
    case 'alias.fixed-point':
      return renderTransferModule(
        '',
        `const first = ctx.fetch;
    const second = first;
    second('https://oracle.invalid/fixed-point');`,
        noise,
      );
    case 'alias.const-preserve':
      return renderTransferModule(
        '',
        `const capability = ctx.fetch;
    capability('https://oracle.invalid/const-alias');`,
        noise,
      );
    case 'alias.mutable-authority-top':
      return renderTransferModule(
        '',
        `let capability = ctx.fetch;
    capability('https://oracle.invalid/mutable-alias');`,
        noise,
      );
    case 'alias.join':
      return renderTransferModule(
        '',
        `const first = ctx.fetch;
    const capability = first;
    capability('https://oracle.invalid/alias-join');`,
        noise,
      );
    case 'binding.static-member':
      return renderTransferModule(
        '',
        `const { fetch: capability } = ctx;
    capability('https://oracle.invalid/static-binding');`,
        noise,
      );
    case 'binding.rest':
      return renderTransferModule(
        '',
        `const { ...authority } = ctx;
    authority.fetch('https://oracle.invalid/rest-binding');`,
        noise,
      );
    case 'binding.default-join':
      return renderTransferModule(
        '',
        `const { fetch: capability = ctx.fetch } = ctx;
    capability('https://oracle.invalid/default-binding');`,
        noise,
      );
    case 'expression.identifier':
      return renderTransferModule(
        '',
        `const capability = ctx.fetch;
    capability('https://oracle.invalid/identifier');`,
        noise,
      );
    case 'expression.implicit-protocol':
      return renderTransferModule(
        '',
        `const protocol = { [Symbol.iterator]() { return [][Symbol.iterator](); } };
    void protocol;
    ctx.fetch('https://oracle.invalid/implicit-protocol');`,
        noise,
      );
    case 'expression.new':
      return renderTransferModule(
        '',
        `const response = new Response('oracle');
    void response;
    ctx.fetch('https://oracle.invalid/new-expression');`,
        noise,
      );
    case 'expression.call-scope':
      return renderTransferModule(
        '',
        `const scoped = ctx.actAs({ id: 'oracle-principal' });
    scoped.fetch('https://oracle.invalid/scoped');`,
        noise,
      );
    case 'expression.call-scoped-key':
      return `import { task } from '@kovojs/server';
export const analyzerOracle = task('analyzer-oracle', {
  run(_input, ctx) {
${noise ? '    const oracleNoise = 0;\n    void oracleNoise;\n' : ''}    const scoped = ctx.actAs({ id: 'oracle-principal' });
    const key = scoped.stateKey('oracle-value');
    ctx.storage.get(key);
    return null;
  },
});
`;
    case 'expression.call-intrinsic-identity':
      return renderTransferModule(
        '',
        `const capability = Object.freeze(ctx.fetch);
    capability('https://oracle.invalid/intrinsic-identity');`,
        noise,
      );
    case 'expression.call-response':
      return renderTransferModule(
        '',
        `const response = Response.json({ ok: true });
    void response;
    ctx.fetch('https://oracle.invalid/response-call');`,
        noise,
      );
    case 'expression.call-unknown-authority':
      return renderTransferModule(
        '',
        `const { ...authority } = ctx;
    const result = authority.fetch('https://oracle.invalid/unknown-authority');
    void result;`,
        noise,
      );
    case 'expression.call-local':
      return renderTransferModule(
        `function local(value) { return value; }`,
        `local(1);
    ctx.fetch('https://oracle.invalid/local-call');`,
        noise,
      );
    case 'expression.binary-join':
      return renderTransferModule(
        '',
        `const combined = ctx.fetch + '';
    void combined;
    ctx.fetch('https://oracle.invalid/binary');`,
        noise,
      );
    case 'expression.conditional-join':
      return renderTransferModule(
        '',
        `const capability = true ? ctx.fetch : ctx.fetch;
    capability('https://oracle.invalid/conditional');`,
        noise,
      );
    case 'expression.static-member':
      return renderTransferModule('', `ctx.headers.set('Cache-Control', 'no-store');`, noise);
    case 'expression.fallthrough-foreign':
      return renderTransferModule(
        '',
        `const holder = [endpoint];
    void holder;
    ctx.fetch('https://oracle.invalid/foreign-containment');`,
        noise,
      );
    case 'expression.fallthrough-authority':
      return renderTransferModule(
        '',
        `const holder = [ctx.fetch];
    void holder;
    ctx.fetch('https://oracle.invalid/authority-containment');`,
        noise,
      );
    case 'helper.call-map':
      return renderTransferModule(
        `function helper(capability) { capability('https://oracle.invalid/helper'); }`,
        `helper(ctx.fetch);`,
        noise,
      );
    case 'helper.spread-close':
      return renderTransferModule(
        `function helper(_capability) { return null; }`,
        `helper(...[ctx.fetch]);`,
        noise,
      );
    case 'helper.rest-argument-close':
      return renderTransferModule(
        `function helper(_plain, ..._rest) { return null; }`,
        `helper('plain', ctx.fetch);`,
        noise,
      );
    case 'helper.extra-argument-close':
      return renderTransferModule(
        `function helper(_plain) { return null; }`,
        `helper('plain', ctx.fetch);`,
        noise,
      );
    case 'helper.rest-parameter-close':
      return renderTransferModule(
        `function helper(..._capabilities) { return null; }`,
        `helper(ctx.fetch);`,
        noise,
      );
    case 'helper.arguments-close':
      return renderTransferModule(
        `function helper(_database) { return arguments[0].select(); }`,
        `helper(ctx.db);`,
        noise,
      );
    case 'helper.cycle-close':
      return renderTransferModule(
        `function first(database) { return second(database); }
function second(database) { return first(database); }`,
        `first(ctx.db);`,
        noise,
      );
    case 'budget.call-depth-close':
      return renderTransferModule(
        Array.from(
          { length: securityAbstractInterpreterCensus.resourceBounds.callDepth + 2 },
          (_unused, index) =>
            index === securityAbstractInterpreterCensus.resourceBounds.callDepth + 1
              ? `function helper${index}(database) { return database.select(); }`
              : `function helper${index}(database) { return helper${index + 1}(database); }`,
        ).join('\n'),
        `helper0(ctx.db);`,
        noise,
      );
    case 'budget.node-count-close':
      return renderTransferModule(
        '',
        Array.from(
          { length: securityAbstractInterpreterCensus.resourceBounds.nodes + 100 },
          () => ';',
        ).join('\n'),
        noise,
      );
    case 'budget.operation-count-close':
      return renderTransferModule(
        '',
        Array.from(
          { length: securityAbstractInterpreterCensus.resourceBounds.operations + 1 },
          () => 'ctx.db.select();',
        ).join('\n'),
        noise,
      );
    case 'budget.summary-count-close':
      return renderTransferModule(
        Array.from(
          { length: securityAbstractInterpreterCensus.resourceBounds.summaries + 1 },
          (_unused, index) => `function helper${index}(database) { return database.select(); }`,
        ).join('\n'),
        Array.from(
          { length: securityAbstractInterpreterCensus.resourceBounds.summaries + 1 },
          (_unused, index) => `helper${index}(ctx.db);`,
        ).join('\n'),
        noise,
      );
    case 'effect.invoke':
      return renderTransferModule('', `ctx.fetch('https://oracle.invalid/effect');`, noise);
  }
}

function renderTransferModule(
  moduleDeclarations: string,
  handlerBody: string,
  noise: boolean,
  serverImports = 'endpoint',
): string {
  return `import { ${serverImports} } from '@kovojs/server';
${moduleDeclarations}
export const analyzerOracle = endpoint('/__kovo/analyzer-oracle', {
  handler(_input, ctx) {
${noise ? '    const oracleNoise = 0;\n    void oracleNoise;\n' : ''}    ${handlerBody}
    return null;
  },
});
`;
}

function transferWitnessDoor(id: SecurityAbstractTransferId): AnalyzerEffectDoor {
  switch (id) {
    case 'expression.call-scope':
      return 'ctx.actAs';
    case 'expression.call-scoped-key':
      return 'ctx.storage.get';
    case 'expression.static-member':
      return 'ctx.headers.set';
    case 'budget.operation-count-close':
    case 'budget.summary-count-close':
    case 'helper.arguments-close':
    case 'helper.cycle-close':
      return 'ctx.db.select';
    default:
      return 'ctx.fetch';
  }
}

function transferWitnessExpectation(id: SecurityAbstractTransferId): AnalyzerOracleExpectation {
  switch (id) {
    case 'alias.mutable-authority-top':
    case 'binding.rest':
    case 'expression.call-unknown-authority':
    case 'expression.implicit-protocol':
    case 'expression.call-intrinsic-identity':
    case 'expression.binary-join':
    case 'expression.fallthrough-authority':
    case 'helper.spread-close':
    case 'helper.rest-argument-close':
    case 'helper.extra-argument-close':
    case 'helper.rest-parameter-close':
    case 'helper.arguments-close':
      return { reason: 'opaque-transfer', verdict: 'closed' };
    case 'helper.cycle-close':
      return { reason: 'helper-cycle', verdict: 'closed' };
    case 'budget.call-depth-close':
      return { reason: 'budget-call-depth', verdict: 'closed' };
    case 'budget.node-count-close':
      return { reason: 'budget-node-count', verdict: 'closed' };
    case 'budget.operation-count-close':
      return { reason: 'budget-operation-count', verdict: 'closed' };
    case 'budget.summary-count-close':
      return { reason: 'budget-summary-count', verdict: 'closed' };
    case 'expression.call-scope':
      return {
        effects: [
          { door: 'principal-scope', kind: 'server.authority.scope' },
          { door: 'ctx.fetch', kind: 'server.egress.request' },
        ],
        verdict: 'accepted',
      };
    case 'expression.call-scoped-key':
      return {
        effects: [
          { door: 'principal-scope', kind: 'server.authority.scope' },
          { door: 'framework-storage', kind: 'server.storage.read' },
        ],
        verdict: 'accepted',
      };
    case 'expression.static-member':
      return {
        effects: [{ door: 'structured-headers', kind: 'server.response.header' }],
        verdict: 'accepted',
      };
    default:
      return {
        effects: [{ door: 'ctx.fetch', kind: 'server.egress.request' }],
        verdict: 'accepted',
      };
  }
}

function independentLatticeBehavior(element: ServerValueProvenance): AnalyzerOracleLatticeBehavior {
  const authority = independentlyCarriesAuthority(element);
  const localJoin = authority
    ? 'unknown-authority'
    : element === 'foreign-executable'
      ? 'foreign-executable'
      : 'local';
  const defaultWithLocal = authority
    ? 'unknown-authority'
    : element === 'foreign-executable'
      ? 'foreign-executable'
      : element;
  return {
    aliasFromBottom: element,
    binaryWithLocal: localJoin,
    conditionalWithLocal: localJoin,
    defaultWithLocal,
  };
}

function independentlyCarriesAuthority(element: ServerValueProvenance): boolean {
  switch (element) {
    case 'foreign-executable':
    case 'intrinsic-identity-call':
    case 'intrinsic-object':
    case 'local':
    case 'safe-call':
      return false;
    default:
      return true;
  }
}

function sameLatticeBehavior(
  expected: AnalyzerOracleLatticeBehavior,
  actual: AnalyzerOracleLatticeBehavior,
): boolean {
  return (
    expected.aliasFromBottom === actual.aliasFromBottom &&
    expected.binaryWithLocal === actual.binaryWithLocal &&
    expected.conditionalWithLocal === actual.conditionalWithLocal &&
    expected.defaultWithLocal === actual.defaultWithLocal
  );
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
