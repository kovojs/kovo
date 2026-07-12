import { canonicalJson } from './canonical-json.js';
import { factHash } from './fact-hash.js';
import {
  compilerArrayIsArray,
  compilerCreateNullRecord,
  compilerDefineOwnDataProperty,
  compilerFreeze,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerSnapshotDenseArray,
  compilerSnapshotJsonValue,
} from './compiler-security-intrinsics.js';
import { dedupeByKey, dedupeOutputContextFacts, mergeQueryUpdatePlans } from './compile-result.js';
import type { ComponentCssAsset } from './css.js';
import type { StyleRuleUsage } from './css.js';
import type { PlatformSubstitution } from './lower/platform.js';
import type { GeneratedOutputWriteFact } from './output-context-facts.js';
import type {
  ClockUpdatePlanFact,
  ComponentGraphFact,
  EndpointGraphFact,
  FragmentTargetFact,
  HandlerWriteSinkFact,
  LiveTargetFact,
  PublishToClientFact,
  QueryUpdateCoverageFact,
  QueryUpdatePlanFact,
  StateDeriveFact,
  TaskGraphFact,
  ViewTransitionStamp,
} from './types.js';

/**
 * @internal A compiler pass owner for appended typed facts. SPEC.md §5.2 rule 10 keeps
 * post-parse decisions on typed facts; owner metadata makes fact propagation and hash inputs
 * inspectable when cache/HMR behavior changes.
 */
export interface CompileFactOwner {
  readonly pass: string;
  readonly phase: 'analyze' | 'emit' | 'graph' | 'lower' | 'validate';
}

export interface CompileFactFamilyMap {
  readonly clockUpdatePlans: ClockUpdatePlanFact;
  readonly componentCssAssets: ComponentCssAsset;
  readonly componentGraphFacts: ComponentGraphFact;
  readonly endpointGraphFacts: EndpointGraphFact;
  readonly fragmentTargetFacts: FragmentTargetFact;
  readonly handlerWriteSinkFacts: HandlerWriteSinkFact;
  readonly liveTargetFacts: LiveTargetFact;
  readonly outputContexts: GeneratedOutputWriteFact;
  readonly platformSubstitutions: PlatformSubstitution;
  readonly publishToClientFacts: PublishToClientFact;
  readonly queryUpdateCoverage: QueryUpdateCoverageFact;
  readonly queryUpdatePlans: QueryUpdatePlanFact;
  readonly stateDerives: StateDeriveFact;
  readonly styleRuleUsages: StyleRuleUsage;
  readonly taskGraphFacts: TaskGraphFact;
  readonly viewTransitions: ViewTransitionStamp;
}

export type CompileFactFamily = keyof CompileFactFamilyMap;

export type CompileFactSnapshot = {
  readonly [Family in CompileFactFamily]: readonly CompileFactFamilyMap[Family][];
} & {
  readonly factHash: string;
  readonly familyHashes: Readonly<Record<CompileFactFamily, string>>;
  readonly owners: readonly CompileFactOwner[];
};

interface CompileFactEntry<Family extends CompileFactFamily> {
  readonly fact: CompileFactFamilyMap[Family];
  readonly owner: CompileFactOwner;
}

const compileFactFamilies = [
  'clockUpdatePlans',
  'componentCssAssets',
  'componentGraphFacts',
  'endpointGraphFacts',
  'fragmentTargetFacts',
  'handlerWriteSinkFacts',
  'liveTargetFacts',
  'outputContexts',
  'platformSubstitutions',
  'publishToClientFacts',
  'queryUpdateCoverage',
  'queryUpdatePlans',
  'stateDerives',
  'styleRuleUsages',
  'taskGraphFacts',
  'viewTransitions',
] as const satisfies readonly CompileFactFamily[];

/** @internal Append/merge/snapshot ledger for typed compiler facts. */
export class CompileFactLedger {
  readonly #entries: {
    [Family in CompileFactFamily]: CompileFactEntry<Family>[];
  } = emptyEntries();

  append<Family extends CompileFactFamily>(
    family: Family,
    owner: CompileFactOwner,
    facts: readonly CompileFactFamilyMap[Family][],
  ): void {
    if (facts.length === 0) return;
    const factSnapshot = compilerSnapshotDenseArray(facts, `Compile facts.${family}`);
    const ownerSnapshot = snapshotFactOwner(owner);
    const entries = this.#entries[family];
    for (let index = 0; index < factSnapshot.length; index += 1) {
      entries[entries.length] = {
        fact: snapshotCompileFact(
          family,
          factSnapshot[index]!,
          `Compile facts.${family}[${index}]`,
        ),
        owner: ownerSnapshot,
      } as CompileFactEntry<Family>;
    }
  }

  merge(snapshot: CompileFactSnapshot, owner: CompileFactOwner): void {
    for (let index = 0; index < compileFactFamilies.length; index += 1) {
      const family = compileFactFamilies[index]!;
      const facts = compilerOwnDataValue(snapshot, family, 'Compile fact snapshot');
      if (!compilerArrayIsArray(facts)) {
        throw new TypeError(`Compile fact snapshot.${family} must be an array.`);
      }
      this.append(family, owner, facts as CompileFactFamilyMap[typeof family][]);
    }
  }

  snapshot(): CompileFactSnapshot {
    const values = {
      clockUpdatePlans: dedupeByJson(this.#facts('clockUpdatePlans')),
      componentCssAssets: dedupeByJson(this.#facts('componentCssAssets')),
      componentGraphFacts: dedupeByJson(this.#facts('componentGraphFacts')),
      endpointGraphFacts: dedupeByJson(this.#facts('endpointGraphFacts')),
      fragmentTargetFacts: dedupeByJson(this.#facts('fragmentTargetFacts')),
      handlerWriteSinkFacts: dedupeByJson(this.#facts('handlerWriteSinkFacts')),
      liveTargetFacts: dedupeByJson(this.#facts('liveTargetFacts')),
      outputContexts: dedupeOutputContextFacts(this.#facts('outputContexts')),
      platformSubstitutions: dedupeByJson(this.#facts('platformSubstitutions')),
      publishToClientFacts: dedupeByJson(this.#facts('publishToClientFacts')),
      queryUpdateCoverage: dedupeByJson(this.#facts('queryUpdateCoverage')),
      queryUpdatePlans: mergeQueryUpdatePlans(this.#facts('queryUpdatePlans')),
      stateDerives: dedupeByKey(this.#facts('stateDerives'), (derive) => derive.exportName),
      styleRuleUsages: dedupeByJson(this.#facts('styleRuleUsages')),
      taskGraphFacts: dedupeByKey(this.#facts('taskGraphFacts'), (task) => task.key),
      viewTransitions: dedupeByKey(this.#facts('viewTransitions'), (stamp) => stamp.name),
    } satisfies {
      readonly [Family in CompileFactFamily]: readonly CompileFactFamilyMap[Family][];
    };
    const familyHashes = {} as Record<CompileFactFamily, string>;
    for (let index = 0; index < compileFactFamilies.length; index += 1) {
      const family = compileFactFamilies[index]!;
      familyHashes[family] = factHash(values[family]);
    }

    return {
      ...values,
      factHash: factHash(familyHashes),
      familyHashes,
      owners: this.#owners(),
    };
  }

  #facts<Family extends CompileFactFamily>(
    family: Family,
  ): readonly CompileFactFamilyMap[Family][] {
    const entries = this.#entries[family];
    const facts: CompileFactFamilyMap[Family][] = [];
    for (let index = 0; index < entries.length; index += 1) {
      facts[index] = snapshotCompileFact(
        family,
        entries[index]!.fact,
        `Compile facts.${family}[${index}]`,
      );
    }
    return facts;
  }

  #owners(): CompileFactOwner[] {
    const owners: CompileFactOwner[] = [];
    for (let familyIndex = 0; familyIndex < compileFactFamilies.length; familyIndex += 1) {
      const family = compileFactFamilies[familyIndex]!;
      const entries = this.#entries[family];
      for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
        owners[owners.length] = entries[entryIndex]!.owner;
      }
    }
    return dedupeByKey(owners, (owner) => `${owner.phase}\0${owner.pass}`);
  }
}

export function createCompileFactLedger(): CompileFactLedger {
  return new CompileFactLedger();
}

function emptyEntries(): {
  [Family in CompileFactFamily]: CompileFactEntry<Family>[];
} {
  return {
    clockUpdatePlans: [],
    componentCssAssets: [],
    componentGraphFacts: [],
    endpointGraphFacts: [],
    fragmentTargetFacts: [],
    handlerWriteSinkFacts: [],
    liveTargetFacts: [],
    outputContexts: [],
    platformSubstitutions: [],
    publishToClientFacts: [],
    queryUpdateCoverage: [],
    queryUpdatePlans: [],
    stateDerives: [],
    styleRuleUsages: [],
    taskGraphFacts: [],
    viewTransitions: [],
  } as unknown as {
    [Family in CompileFactFamily]: CompileFactEntry<Family>[];
  };
}

function dedupeByJson<Value>(values: readonly Value[]): Value[] {
  return dedupeByKey(values, canonicalJson);
}

function snapshotFactOwner(owner: CompileFactOwner): CompileFactOwner {
  const pass = compilerOwnDataValue(owner, 'pass', 'Compile fact owner');
  const phase = compilerOwnDataValue(owner, 'phase', 'Compile fact owner');
  if (
    typeof pass !== 'string' ||
    (phase !== 'analyze' &&
      phase !== 'emit' &&
      phase !== 'graph' &&
      phase !== 'lower' &&
      phase !== 'validate')
  ) {
    throw new TypeError('Compile fact owner must have an exact pass and phase.');
  }
  return compilerSnapshotJsonValue({ pass, phase }, 'Compile fact owner');
}

function snapshotCompileFact<Family extends CompileFactFamily>(
  family: Family,
  fact: CompileFactFamilyMap[Family],
  label: string,
): CompileFactFamilyMap[Family] {
  const snapshot = compilerSnapshotJsonValue(fact, label);
  if (family !== 'queryUpdatePlans') return snapshot;

  // Query-update analysis deliberately carries output contexts as a non-enumerable sidecar so the
  // dedicated output-context fact family owns their hash. Preserve that sidecar while still
  // severing caller ownership (SPEC.md §5.2).
  const outputContexts = compilerOwnDataValue(fact, 'outputContexts', label);
  if (outputContexts === undefined) return snapshot;
  if (!compilerArrayIsArray(outputContexts)) {
    throw new TypeError(`${label}.outputContexts must be an array.`);
  }
  const record = compilerCreateNullRecord<unknown>();
  const keys = compilerObjectKeys(snapshot as object);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (key === 'outputContexts') continue;
    compilerDefineOwnDataProperty(
      record,
      key,
      compilerOwnDataValue(snapshot, key, label),
    );
  }
  compilerDefineOwnDataProperty(
    record,
    'outputContexts',
    compilerSnapshotJsonValue(outputContexts, `${label}.outputContexts`),
    false,
  );
  return compilerFreeze(record) as CompileFactFamilyMap[Family];
}
