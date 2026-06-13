import {
  projectSourceLineFacts,
  projectSourceSiteSummaryFact,
  type ProjectSourceLineFact,
  type ProjectSourceSiteSummaryFact,
} from './source-fixtures.ts';

export interface TouchGraphTouchFact {
  domain: string;
  keys?: string | null;
  predicate?: string;
  site?: string;
  via: string;
}

export interface TouchGraphEntryFact {
  reads?: readonly unknown[];
  touches?: readonly TouchGraphTouchFact[];
  unresolved?: readonly unknown[];
}

export type TouchGraphFixture = Readonly<Record<string, TouchGraphEntryFact>>;

export interface TouchGraphSourceFact extends ProjectSourceLineFact {
  domain: string;
  keys: string | null | undefined;
  mutation: string;
  predicate: string | undefined;
  via: string;
}

export interface TouchGraphTouchSummaryFact {
  domain: string;
  keys: string | null | undefined;
  predicate: string | undefined;
  sitePath: string;
  sourceLineIncludesVia: boolean;
  via: string;
}

export interface TouchGraphSummaryEntryFact {
  reads: readonly unknown[];
  touches: TouchGraphTouchSummaryFact[];
  unresolved: readonly unknown[];
}

export interface TouchGraphProvenanceTouchFact {
  domain: string;
  keys: string | null | undefined;
  predicate: string | undefined;
  sitePath: string;
  via: string;
}

export interface TouchGraphProvenanceEntryFact {
  reads: readonly unknown[];
  touches: TouchGraphProvenanceTouchFact[];
  unresolved: readonly unknown[];
}

export interface TouchGraphProvenanceFact {
  entries: Record<string, TouchGraphProvenanceEntryFact>;
  siteSummary: ProjectSourceSiteSummaryFact;
  sourceLineMismatches: string[];
  unresolvedMutations: string[];
}

export interface TouchGraphProvenanceHonestyFact {
  entryKeys: string[];
  sourceLineMismatches: string[];
  sourceSites: ProjectSourceSiteSummaryFact;
  touchCountsByMutation: Record<string, number>;
  unresolvedMutations: string[];
}

export function touchGraphSourceSites(touchGraph: TouchGraphFixture): string[] {
  return Object.values(touchGraph)
    .flatMap((entry) => entry.touches ?? [])
    .map((touch) => {
      if (!touch.site) {
        throw new Error(`Touch graph fact includes a source site: ${touch.domain}`);
      }
      return touch.site;
    });
}

export function touchGraphSourceSiteSummaryFact(
  touchGraph: TouchGraphFixture,
): ProjectSourceSiteSummaryFact {
  return projectSourceSiteSummaryFact(touchGraphSourceSites(touchGraph));
}

export async function touchGraphProvenanceFact(
  rootPath: string,
  touchGraph: TouchGraphFixture,
): Promise<TouchGraphProvenanceFact> {
  const summary = await touchGraphSummaryFacts(rootPath, touchGraph);

  return {
    entries: Object.fromEntries(
      Object.entries(summary).map(([mutation, entry]) => [
        mutation,
        {
          reads: entry.reads,
          touches: entry.touches.map(
            ({ sourceLineIncludesVia: _sourceLineIncludesVia, ...touch }) => touch,
          ),
          unresolved: entry.unresolved,
        },
      ]),
    ),
    siteSummary: touchGraphSourceSiteSummaryFact(touchGraph),
    sourceLineMismatches: Object.entries(summary).flatMap(([mutation, entry]) =>
      entry.touches
        .filter((touch) => !touch.sourceLineIncludesVia)
        .map((touch) => `${mutation}:${touch.sitePath}:${touch.via}`),
    ),
    unresolvedMutations: Object.entries(summary)
      .filter(([, entry]) => entry.unresolved.length > 0)
      .map(([mutation]) => mutation),
  };
}

export function touchGraphProvenanceHonestyFact(
  provenance: TouchGraphProvenanceFact,
): TouchGraphProvenanceHonestyFact {
  return {
    entryKeys: Object.keys(provenance.entries).sort(),
    sourceLineMismatches: provenance.sourceLineMismatches,
    sourceSites: provenance.siteSummary,
    touchCountsByMutation: Object.fromEntries(
      Object.entries(provenance.entries)
        .map(([mutation, entry]): [string, number] => [mutation, entry.touches.length])
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    unresolvedMutations: provenance.unresolvedMutations,
  };
}

export async function touchGraphSourceFacts(
  rootPath: string,
  touchGraph: TouchGraphFixture,
): Promise<TouchGraphSourceFact[]> {
  const touchFacts = Object.entries(touchGraph).flatMap(([mutation, entry]) =>
    (entry.touches ?? []).map((touch) => {
      if (!touch.site) {
        throw new Error(`Touch graph fact includes a source site: ${mutation} ${touch.domain}`);
      }

      return { mutation, touch };
    }),
  );
  const sourceFacts = await projectSourceLineFacts(
    rootPath,
    touchFacts.map((fact) => fact.touch.site!),
  );

  return sourceFacts.map((sourceFact, index) => {
    const touchFact = touchFacts[index]!;

    return {
      ...sourceFact,
      domain: touchFact.touch.domain,
      keys: touchFact.touch.keys,
      mutation: touchFact.mutation,
      predicate: touchFact.touch.predicate,
      via: touchFact.touch.via,
    };
  });
}

export async function touchGraphSummaryFacts(
  rootPath: string,
  touchGraph: TouchGraphFixture,
): Promise<Record<string, TouchGraphSummaryEntryFact>> {
  const sourceFacts = await touchGraphSourceFacts(rootPath, touchGraph);
  const sourceFactsByMutation = new Map<string, TouchGraphSourceFact[]>();
  for (const fact of sourceFacts) {
    const currentFacts = sourceFactsByMutation.get(fact.mutation) ?? [];
    currentFacts.push(fact);
    sourceFactsByMutation.set(fact.mutation, currentFacts);
  }

  return Object.fromEntries(
    Object.entries(touchGraph).map(([mutation, entry]) => {
      const mutationSourceFacts = sourceFactsByMutation.get(mutation) ?? [];
      let index = 0;

      return [
        mutation,
        {
          reads: entry.reads ?? [],
          touches: (entry.touches ?? []).map((touch) => {
            const sourceFact = mutationSourceFacts[index];
            index += 1;

            if (!sourceFact) {
              throw new Error(`Touch graph fact has a resolved source site: ${mutation}`);
            }

            return {
              domain: touch.domain,
              keys: touch.keys,
              predicate: touch.predicate,
              sitePath: sourceFact.path,
              sourceLineIncludesVia: sourceFact.sourceLine.includes(touch.via),
              via: touch.via,
            };
          }),
          unresolved: entry.unresolved ?? [],
        },
      ];
    }),
  );
}
