import { factHash } from './fact-hash.js';
import { dedupeByKey, dedupeOutputContextFacts, mergeQueryUpdatePlans } from './compile-result.js';
import type { ComponentCssAsset } from './css.js';
import type { StyleRuleUsage } from './css.js';
import type { PlatformSubstitution } from './lower/platform.js';
import type { GeneratedOutputWriteFact } from './output-context-facts.js';
import type {
  ClockUpdatePlanFact,
  ComponentGraphFact,
  FragmentTargetFact,
  LiveTargetFact,
  PublishToClientFact,
  QueryUpdateCoverageFact,
  QueryUpdatePlanFact,
  StateDeriveFact,
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
  readonly fragmentTargetFacts: FragmentTargetFact;
  readonly liveTargetFacts: LiveTargetFact;
  readonly outputContexts: GeneratedOutputWriteFact;
  readonly platformSubstitutions: PlatformSubstitution;
  readonly publishToClientFacts: PublishToClientFact;
  readonly queryUpdateCoverage: QueryUpdateCoverageFact;
  readonly queryUpdatePlans: QueryUpdatePlanFact;
  readonly stateDerives: StateDeriveFact;
  readonly styleRuleUsages: StyleRuleUsage;
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
  'fragmentTargetFacts',
  'liveTargetFacts',
  'outputContexts',
  'platformSubstitutions',
  'publishToClientFacts',
  'queryUpdateCoverage',
  'queryUpdatePlans',
  'stateDerives',
  'styleRuleUsages',
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
    this.#entries[family].push(...facts.map((fact) => ({ fact, owner })));
  }

  merge(snapshot: CompileFactSnapshot, owner: CompileFactOwner): void {
    for (const family of compileFactFamilies) {
      this.append(family, owner, snapshot[family]);
    }
  }

  snapshot(): CompileFactSnapshot {
    const values = {
      clockUpdatePlans: dedupeByJson(this.#facts('clockUpdatePlans')),
      componentCssAssets: dedupeByJson(this.#facts('componentCssAssets')),
      componentGraphFacts: dedupeByJson(this.#facts('componentGraphFacts')),
      fragmentTargetFacts: dedupeByJson(this.#facts('fragmentTargetFacts')),
      liveTargetFacts: dedupeByJson(this.#facts('liveTargetFacts')),
      outputContexts: dedupeOutputContextFacts(this.#facts('outputContexts')),
      platformSubstitutions: dedupeByJson(this.#facts('platformSubstitutions')),
      publishToClientFacts: dedupeByJson(this.#facts('publishToClientFacts')),
      queryUpdateCoverage: dedupeByJson(this.#facts('queryUpdateCoverage')),
      queryUpdatePlans: mergeQueryUpdatePlans(this.#facts('queryUpdatePlans')),
      stateDerives: dedupeByKey(this.#facts('stateDerives'), (derive) => derive.exportName),
      styleRuleUsages: dedupeByJson(this.#facts('styleRuleUsages')),
      viewTransitions: dedupeByKey(this.#facts('viewTransitions'), (stamp) => stamp.name),
    } satisfies {
      readonly [Family in CompileFactFamily]: readonly CompileFactFamilyMap[Family][];
    };
    const familyHashes = Object.fromEntries(
      compileFactFamilies.map((family) => [family, factHash(values[family])]),
    ) as Record<CompileFactFamily, string>;

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
    return this.#entries[family].map((entry) => entry.fact);
  }

  #owners(): CompileFactOwner[] {
    return dedupeByKey(
      compileFactFamilies.flatMap((family) => this.#entries[family].map((entry) => entry.owner)),
      (owner) => `${owner.phase}\0${owner.pass}`,
    );
  }
}

export function createCompileFactLedger(): CompileFactLedger {
  return new CompileFactLedger();
}

function emptyEntries(): {
  [Family in CompileFactFamily]: CompileFactEntry<Family>[];
} {
  return Object.fromEntries(compileFactFamilies.map((family) => [family, []])) as unknown as {
    [Family in CompileFactFamily]: CompileFactEntry<Family>[];
  };
}

function dedupeByJson<Value>(values: readonly Value[]): Value[] {
  return dedupeByKey(values, (value) => JSON.stringify(value));
}
