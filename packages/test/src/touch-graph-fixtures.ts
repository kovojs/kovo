import { projectSourceLineFacts, type ProjectSourceLineFact } from './source-fixtures.ts';

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
