// @kovo-security-classifier-corpus kv424-request-process
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from '@kovojs/compiler';
import { analyzeCapabilityClosure } from '@kovojs/compiler/internal';
import { collectUnregisteredSinksFromProject } from '@kovojs/drizzle/internal/static';

const source = `
import { createApp, endpoint, layout, mutation, query, route, task, webhook } from '@kovojs/server';

export const app = createApp({});
export const api = endpoint('/api', { handler() { return { ok: true }; } });
export const chrome = layout({ render() { return null; } });
export const save = mutation('save', { handler() { return { ok: true }; } });
export const read = query('read', { load() { return { ok: true }; } });
export const page = route('/', { page() { return null; } });
export const job = task('job', { run() {} });
export const hook = webhook('/hook', { handler() {} });
`;

function routedFacts(options: { dropCapabilityRoot?: 'mutation'; dropSemanticRoot?: 'mutation' }) {
  const files = [{ fileName: 'app.tsx', source }] as const;
  const compiled = compileComponentModule({
    fileName: 'app.tsx',
    source,
    sourceProvenance: 'app',
  });
  const graphs = compiled.componentGraphFacts.flatMap((fact) =>
    fact.securitySemanticGraph ? [fact.securitySemanticGraph] : [],
  );
  const closure = analyzeCapabilityClosure({ files });
  return collectUnregisteredSinksFromProject({
    compilerSecuritySemanticSources: [
      {
        fileName: 'app.tsx',
        graphs:
          options.dropSemanticRoot === 'mutation'
            ? graphs.map((graph) => ({
                ...graph,
                roots: graph.roots.filter((root) => root.binding.factory !== 'mutation'),
              }))
            : graphs,
        source,
      },
    ],
    compilerTaskBClosure: {
      capabilityFacts:
        options.dropCapabilityRoot === 'mutation'
          ? closure.facts.filter((fact) => !(fact.kind === 'root' && fact.rootKind === 'mutation'))
          : closure.facts,
      dependencyManifest: closure.dependencyManifest,
      files,
      schema: 'kovo-task-b-closure/v1',
    },
    files,
  });
}

describe('Phase 3C TASK B compiler routing', () => {
  // @kovo-security-certifies KV424 task-b-production-composition
  it('routes the complete request-factory census through L1 and each compiler-owned handler through L2/L3', () => {
    expect(routedFacts({})).toEqual([]);
  });

  it('closes independently when either the L1 root or L2/L3 semantic root is omitted', () => {
    expect(routedFacts({ dropCapabilityRoot: 'mutation' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: expect.stringContaining('sink=capability-closure') }),
      ]),
    );
    expect(routedFacts({ dropSemanticRoot: 'mutation' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: expect.stringContaining('sink=finite-ir') }),
      ]),
    );
  });
});
