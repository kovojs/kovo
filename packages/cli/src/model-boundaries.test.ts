import { describe, expect, it } from 'vitest';

import { parseExplainArgs } from './graph-args.js';
import { kovoExplain } from './graph-output.js';

describe('kovo explain --model-boundaries (Plan 3 §6 C13 anchor)', () => {
  it('parses as a graph-independent exclusive explain mode', () => {
    expect(parseExplainArgs(['--model-boundaries'])).toEqual({
      inputPath: undefined,
      ok: true,
      options: { modelBoundaries: true },
    });
    expect(parseExplainArgs(['--model-boundaries', 'graph.json'])).toMatchObject({ ok: false });
    expect(parseExplainArgs(['--model-boundaries', '--trust'])).toMatchObject({ ok: false });
  });

  it('prints the human atomicity assumption, exact bounds, and both action partitions', () => {
    const result = kovoExplain({}, { modelBoundaries: true } as never);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      'kovo-explain/v1\nMODEL-BOUNDARY replay-reservation/v1 status=registered-not-model-checked\n',
    );
    expect(result.output).toContain(
      'AXIOM postgres-cte-atomicity classification=human-assumption verified=false\n',
    );
    expect(result.output).toContain(
      'BOUND replicas=2 slots=2 identities=2 backwardClockSteps=1 crashPoints=1\n',
    );
    expect(result.output).toContain('MODELED replay.reserve\n');
    expect(result.output).toContain('NOT-MODELED-ACTION jobs.claimDue\n');
    expect(result.output).toContain('NOT-MODELED-ACTION replay.auditPrivileges\n');
    expect(result.output).toContain('NOT-MODELED-PHENOMENON postgres-lock-implementation ');
    expect(result.output).toContain(
      'SUMMARY modeledActions=7 notModeledActions=22 notModeledPhenomena=6\n',
    );
    expect(result.output).not.toContain('verified=true');
  });
});
