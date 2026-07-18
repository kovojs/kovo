import { describe, expect, it } from 'vitest';

import { compileComponentModule } from '@kovojs/compiler';
import {
  collectStaticBuildTrustFactsFromProject,
  type CompilerSecuritySemanticSource,
} from '@kovojs/drizzle/internal/static';

interface SourceFile {
  fileName: string;
  source: string;
}

function compilerSemanticSources(
  files: readonly SourceFile[],
): readonly CompilerSecuritySemanticSource[] {
  return files.map((file, index) => {
    const result = compileComponentModule({
      extraFiles: files.filter((_, candidate) => candidate !== index),
      fileName: file.fileName,
      source: file.source,
      sourceProvenance: 'app',
    });
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    return {
      fileName: file.fileName,
      graphs: result.componentGraphFacts.flatMap((fact) =>
        fact.securitySemanticGraph === undefined ? [] : [fact.securitySemanticGraph],
      ),
      source: file.source,
    };
  });
}

function semanticBridgeFixture(): readonly SourceFile[] {
  const source = `
    import { kovoAnalyzerSummary } from '@kovojs/drizzle';
    import { mutation, serverValue } from '@kovojs/server';
    import { eq } from 'drizzle-orm';
    import { account } from './schema.js';
    function exactGuard(context) { return context.guard.userId; }
    kovoAnalyzerSummary(exactGuard, { returns: { kind: 'guard', path: 'userId' } });
    export const update = mutation({
      async handler(input, request) {
        async function nestedWrite(db, carrier) {
          await db
            .update(account)
            .set({ userId: serverValue(exactGuard(carrier), 'claimed owner') })
            .where(eq(account.id, input.id));
        }
        await nestedWrite(request.db, input);
        return { ok: true };
      },
    });
  `;
  const schemaSource = `
    import { pgTable, text } from 'drizzle-orm/pg-core';
    export const account = pgTable('account', {
      id: text('id').notNull(),
      userId: text('user_id').notNull(),
    });
  `;
  return [
    { fileName: 'summary-carrier.ts', source },
    { fileName: 'schema.ts', source: schemaSource },
  ];
}

function hasRequestHandlerClosure(
  files: readonly SourceFile[],
  compilerSecuritySemanticSources?: readonly CompilerSecuritySemanticSource[],
): boolean {
  return collectStaticBuildTrustFactsFromProject({
    ...(compilerSecuritySemanticSources ? { compilerSecuritySemanticSources } : {}),
    files,
  }).unregisteredSinks.some((fact) => fact.sink.startsWith('request-handler.'));
}

function assertExactCarrierDischargesOnlyTheKnownLegacyNoise(
  files: readonly SourceFile[],
  semanticSources: readonly CompilerSecuritySemanticSource[],
): void {
  expect(hasRequestHandlerClosure(files)).toBe(true);
  expect(hasRequestHandlerClosure(files, semanticSources)).toBe(false);
}

describe('Phase 3C semantic carrier integrity', () => {
  // SPEC §5.2/§6.6: a compiler proof is bound to the exact declared root, not merely the
  // factory family. A same-source carrier relabelled from one mutation to a sibling must fall back
  // to the closed legacy verdict just like a byte/span/callable mismatch.
  it('rejects a same-family compiler carrier whose declared root identity was relabelled', () => {
    const files = semanticBridgeFixture();
    const semanticSources = compilerSemanticSources(files);
    assertExactCarrierDischargesOnlyTheKnownLegacyNoise(files, semanticSources);

    const relabelled = semanticSources.map((semanticSource) => ({
      ...semanticSource,
      graphs: semanticSource.graphs.map((graph) => ({
        ...graph,
        roots: graph.roots.map((root) => ({
          ...root,
          root: root.root.startsWith('mutation:') ? 'mutation:sibling' : root.root,
        })),
      })),
    }));
    expect(
      relabelled.some((semanticSource) =>
        semanticSource.graphs.some((graph) =>
          graph.roots.some((root) => root.root === 'mutation:sibling'),
        ),
      ),
    ).toBe(true);

    expect(hasRequestHandlerClosure(files, relabelled)).toBe(true);
  });

  it('rejects a synchronized root relabel across binding and trace facts', () => {
    const files = semanticBridgeFixture();
    const semanticSources = compilerSemanticSources(files);
    assertExactCarrierDischargesOnlyTheKnownLegacyNoise(files, semanticSources);

    const relabelled = semanticSources.map((semanticSource) => ({
      ...semanticSource,
      graphs: semanticSource.graphs.map((graph) => ({
        ...graph,
        roots: graph.roots.map((root) => {
          if (!root.root.startsWith('mutation:')) return root;
          const nextRoot = 'mutation:sibling';
          return {
            ...root,
            binding: { ...root.binding, root: nextRoot },
            root: nextRoot,
            traces: root.traces.map((trace) => ({ ...trace, root: nextRoot })),
          };
        }),
      })),
    }));

    expect(hasRequestHandlerClosure(files, relabelled)).toBe(true);
  });

  // SPEC §5.2/§6.6: the authority category is part of the proof key. `headers` cannot certify
  // the helper invocation that actually receives a database capability merely because both are
  // privileged categories.
  it('rejects a compiler carrier whose database authority was relabelled as headers', () => {
    const files = semanticBridgeFixture();
    const semanticSources = compilerSemanticSources(files);
    assertExactCarrierDischargesOnlyTheKnownLegacyNoise(files, semanticSources);
    let relabelledAuthority = false;
    const relabelled = semanticSources.map((semanticSource) => ({
      ...semanticSource,
      graphs: semanticSource.graphs.map((graph) => ({
        ...graph,
        roots: graph.roots.map((root) => ({
          ...root,
          summaries: root.summaries.map((summary) => ({
            ...summary,
            authorityInputs: summary.authorityInputs.map((authority) => {
              if (summary.callable === 'local:nestedWrite' && authority === 'arg0=database') {
                relabelledAuthority = true;
                return 'arg0=headers';
              }
              return authority;
            }),
          })),
        })),
      })),
    }));
    expect(relabelledAuthority).toBe(true);

    expect(hasRequestHandlerClosure(files, relabelled)).toBe(true);
  });

  it('rejects a synchronized authority relabel across summary, invocation, and trace paths', () => {
    const files = semanticBridgeFixture();
    const semanticSources = compilerSemanticSources(files);
    assertExactCarrierDischargesOnlyTheKnownLegacyNoise(files, semanticSources);
    const previousTransfer = 'local:nestedWrite[arg0=database]';
    const nextTransfer = 'local:nestedWrite[arg0=headers]';

    const relabelled = semanticSources.map((semanticSource) => ({
      ...semanticSource,
      graphs: semanticSource.graphs.map((graph) => ({
        ...graph,
        roots: graph.roots.map((root) => ({
          ...root,
          helperInvocations: root.helperInvocations.map((invocation) =>
            invocation.callable === 'local:nestedWrite'
              ? {
                  ...invocation,
                  authorityInputs: ['arg0=headers'],
                  transfers: invocation.transfers.map((transfer) =>
                    transfer === previousTransfer ? nextTransfer : transfer,
                  ),
                }
              : invocation,
          ),
          summaries: root.summaries.map((summary) =>
            summary.callable === 'local:nestedWrite'
              ? { ...summary, authorityInputs: ['arg0=headers'] }
              : summary,
          ),
          traces: root.traces.map((trace) => ({
            ...trace,
            transfers: trace.transfers.map((transfer) =>
              transfer === previousTransfer ? nextTransfer : transfer,
            ),
          })),
        })),
      })),
    }));

    expect(hasRequestHandlerClosure(files, relabelled)).toBe(true);
  });

  // SPEC §5.2/§6.6: terminal operationKinds are a closed semantic snapshot, not an optional
  // allowlist. Deleting the helper's database-write operation must invalidate the carrier.
  it('rejects a compiler carrier with an omitted terminal operation kind', () => {
    const files = semanticBridgeFixture();
    const semanticSources = compilerSemanticSources(files);
    assertExactCarrierDischargesOnlyTheKnownLegacyNoise(files, semanticSources);
    let omittedWrite = false;
    const omitted = semanticSources.map((semanticSource) => ({
      ...semanticSource,
      graphs: semanticSource.graphs.map((graph) => ({
        ...graph,
        roots: graph.roots.map((root) => ({
          ...root,
          summaries: root.summaries.map((summary) => ({
            ...summary,
            operationKinds: summary.operationKinds.filter((kind) => {
              const remove =
                summary.callable === 'local:nestedWrite' && kind === 'server.database.write';
              if (remove) omittedWrite = true;
              return !remove;
            }),
          })),
        })),
      })),
    }));
    expect(omittedWrite).toBe(true);

    expect(hasRequestHandlerClosure(files, omitted)).toBe(true);
  });

  it('rejects a synchronized terminal-operation relabel across summaries, invocations, and traces', () => {
    const files = semanticBridgeFixture();
    const semanticSources = compilerSemanticSources(files);
    assertExactCarrierDischargesOnlyTheKnownLegacyNoise(files, semanticSources);

    const relabelled = semanticSources.map((semanticSource) => ({
      ...semanticSource,
      graphs: semanticSource.graphs.map((graph) => ({
        ...graph,
        roots: graph.roots.map((root) => ({
          ...root,
          helperInvocations: root.helperInvocations.map((invocation) =>
            invocation.callable === 'local:nestedWrite'
              ? {
                  ...invocation,
                  operationKinds: invocation.operationKinds.map((kind) =>
                    kind === 'server.database.write' ? 'server.database.read' : kind,
                  ),
                }
              : invocation,
          ),
          summaries: root.summaries.map((summary) =>
            summary.callable === 'local:nestedWrite'
              ? {
                  ...summary,
                  operationKinds: summary.operationKinds.map((kind) =>
                    kind === 'server.database.write' ? 'server.database.read' : kind,
                  ),
                }
              : summary,
          ),
          traces: root.traces.map((trace) =>
            trace.verdict === 'proved' && trace.sink.kind === 'server.database.write'
              ? {
                  ...trace,
                  sink: { ...trace.sink, kind: 'server.database.read' as const },
                }
              : trace,
          ),
        })),
      })),
    }));

    expect(hasRequestHandlerClosure(files, relabelled)).toBe(true);
  });
});
