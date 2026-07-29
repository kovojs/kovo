import { describe, expect, it } from 'vitest';

import { parseExplainArgs } from './graph-args.js';
import { kovoExplain } from './graph-output.js';

describe('kovo explain --model-boundaries (Plan 3 §6 C13 anchor)', () => {
  it('parses as a graph-independent exclusive explain mode', () => {
    expect(parseExplainArgs(['model-boundaries'])).toEqual({
      artifact: false,
      format: 'human',
      inputPath: undefined,
      ok: true,
      options: { view: 'model-boundaries' },
    });
    expect(parseExplainArgs(['model-boundaries', 'graph.json'])).toMatchObject({ ok: false });
    expect(parseExplainArgs(['model-boundaries', 'trust'])).toMatchObject({ ok: false });
  });

  it('prints the human atomicity assumption, exact bounds, and both action partitions', () => {
    const result = kovoExplain({}, { view: 'model-boundaries' });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      'kovo-explain/v1\nMODEL-BOUNDARY replay-reservation/v1 status=bounded-model-checked\n',
    );
    expect(result.output).toContain(
      'AXIOM postgres-cte-atomicity classification=human-assumption verified=false\n',
    );
    expect(result.output).toContain(
      'BOUND replicas=2 slots=2 identities=2 backwardClockSteps=1 crashPoints=1\n',
    );
    expect(result.output).toContain(
      'MODEL-CHECKER TLC release=v1.7.4 sha256=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88 java=temurin-21.0.11+10 config=formal/ReplayReservation.cfg\n',
    );
    expect(result.output).toContain('INVARIANT NoDoubleExecute\n');
    expect(result.output).toContain('INVARIANT NoResurrection\n');
    expect(result.output).toContain('MODELED replay.reserve\n');
    expect(result.output).toContain('NOT-MODELED-ACTION jobs.claimDue\n');
    expect(result.output).toContain('NOT-MODELED-ACTION replay.auditPrivileges\n');
    expect(result.output).toContain('NOT-MODELED-ACTION replay.erasePrincipal\n');
    expect(result.output).toContain('NOT-MODELED-PHENOMENON postgres-lock-implementation ');
    expect(result.output).toContain(
      'SUMMARY modeledActions=7 notModeledActions=26 notModeledPhenomena=7\n',
    );
    expect(result.output).not.toContain('verified=true');
  });
});
