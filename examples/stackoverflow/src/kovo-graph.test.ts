import '../../../tests/example-generated-graphs.setup.js';

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { KovoExplainInput } from '@kovojs/core/internal/graph';
import { kovoCheck } from '@kovojs/cli';
import { describe, expect, it } from 'vitest';

const soRoot = fileURLToPath(new URL('..', import.meta.url));
const soGraph = JSON.parse(
  execFileSync(process.execPath, [join(soRoot, 'scripts/emit-graph.mjs'), '--print-graph-json'], {
    cwd: soRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
) as KovoExplainInput;

describe('stackoverflow graph', () => {
  it('connects the demo mutations to the queries they refresh', () => {
    expect((soGraph.mutations ?? []).map((mutation) => mutation.key)).toEqual([
      'postQuestion',
      'postAnswer',
      'voteUp',
    ]);
    expect((soGraph.queries ?? []).map((query) => query.query)).toEqual([
      'questionList',
      'answerList',
      'questionDetail',
      'questionAnswers',
      'questionScore',
    ]);

    const result = kovoCheck(soGraph);
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(
      /^kovo-check\/v1\nNOTICE KV409 examples\/stackoverflow\/src\/mutations\.ts:\d+ Non-eq predicate degraded to table-level invalidation\.\nNOTICE KV409 examples\/stackoverflow\/src\/mutations\.ts:\d+ Non-eq predicate degraded to table-level invalidation\.\n$/,
    );
  });
});
