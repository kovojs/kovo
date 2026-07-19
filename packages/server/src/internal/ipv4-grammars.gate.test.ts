import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseLooseIpv4 } from '../egress.js';
import {
  decideIpv4GrammarRelations,
  IPV4_GRAMMAR_VERSION,
  kovoLooseIpv4Dfa,
  rfc3986Ipv4AddressDfa,
  traditionalInetAtonDfa,
  unboundedOnePartKovoMutant,
} from './ipv4-grammars.js';
import {
  decideContainment,
  dfaAccepts,
  FiniteAutomataStateBudgetError,
} from './linear-regex/automata.js';

const relationArtifact = JSON.parse(
  readFileSync(
    new URL('../../../../security/ipv4-grammar-relations.json', import.meta.url),
    'utf8',
  ),
) as {
  readonly domain: string;
  readonly relations: readonly {
    readonly counterexample?: string;
    readonly holds: boolean;
    readonly subset: string;
    readonly superset: string;
  }[];
  readonly schema: string;
};

function acceptedByKovo(input: string): boolean {
  return parseLooseIpv4(input) !== null;
}

function assertKovoModel(input: string): void {
  expect(dfaAccepts(kovoLooseIpv4Dfa, input), JSON.stringify(input)).toBe(acceptedByKovo(input));
}

function generatedStrings(seed: number, count: number): string[] {
  let state = seed >>> 0;
  const alphabet = '0123456789abcdefABCDEFxX.';
  const values: string[] = [];
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const length = state % 18;
    let value = '';
    for (let offset = 0; offset < length; offset += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      value += alphabet[state % alphabet.length];
    }
    values.push(value);
  }
  return values;
}

describe('IPv4 grammar-containment gate', () => {
  it('decides both directions and retains the non-empty resolver-envelope difference', () => {
    expect(IPV4_GRAMMAR_VERSION).toBe('kovo.ipv4-grammar/v1');
    expect(decideIpv4GrammarRelations()).toEqual({
      kovoWithinRfc3986: {
        counterexample: expect.any(String),
        exploredStates: expect.any(Number),
        holds: false,
      },
      kovoWithinTraditionalInetAton: { exploredStates: expect.any(Number), holds: true },
      rfc3986WithinKovo: { exploredStates: expect.any(Number), holds: true },
      traditionalInetAtonWithinKovo: {
        counterexample: '4294967296',
        exploredStates: expect.any(Number),
        holds: false,
      },
      version: 'kovo.ipv4-grammar/v1',
    });
  });

  it('keeps a diffable exact relation artifact synchronized with the decisions', () => {
    const decisions = decideIpv4GrammarRelations();
    expect(relationArtifact).toEqual({
      domain: 'ASCII URL host tokens without surrounding whitespace',
      relations: [
        {
          holds: decisions.rfc3986WithinKovo.holds,
          subset: 'rfc3986-IPv4address',
          superset: 'kovo-parseLooseIpv4',
        },
        {
          holds: decisions.kovoWithinTraditionalInetAton.holds,
          subset: 'kovo-parseLooseIpv4',
          superset: 'traditional-inet_aton-envelope',
        },
        {
          counterexample: decisions.traditionalInetAtonWithinKovo.holds
            ? undefined
            : decisions.traditionalInetAtonWithinKovo.counterexample,
          holds: decisions.traditionalInetAtonWithinKovo.holds,
          subset: 'traditional-inet_aton-envelope',
          superset: 'kovo-parseLooseIpv4',
        },
      ],
      schema: 'kovo.ipv4-grammar-relations/v1',
    });
  });

  it('binds the declared Kovo language to parser boundaries and a deterministic hostile corpus', () => {
    const cases = [
      '0',
      '00',
      '0000000000000000000000000000000000000000001',
      '08',
      '0x0',
      '0X0000000000000000000000000000000000000000000f',
      '0x',
      '255.255.255.255',
      '256.255.255.255',
      '1.16777215',
      '1.16777216',
      '1.2.65535',
      '1.2.65536',
      '4294967295',
      '4294967296',
      '037777777777',
      '040000000000',
      '0xffffffff',
      '0x100000000',
      '1.2.3.4.5',
      '1..2',
      '.1',
      '1.',
      '+1',
      ' 1',
      '1 ',
    ];
    for (const value of cases) assertKovoModel(value);
    for (const value of generatedStrings(0x4b4f564f, 50_000)) assertKovoModel(value);
  });

  it('pins the RFC 3986 no-leading-zero dotted-quad boundary', () => {
    for (const value of ['0.0.0.0', '1.2.3.4', '192.168.0.1', '255.255.255.255']) {
      expect(dfaAccepts(rfc3986Ipv4AddressDfa, value), value).toBe(true);
    }
    for (const value of ['0', '01.2.3.4', '1.2.3', '1.2.3.256', '0x7f.0.0.1']) {
      expect(dfaAccepts(rfc3986Ipv4AddressDfa, value), value).toBe(false);
    }
  });

  it('kills a widened one-part Kovo mutant with the minimized overflow witness', () => {
    const mutant = unboundedOnePartKovoMutant();
    expect(decideContainment(traditionalInetAtonDfa, mutant)).toMatchObject({ holds: true });
    expect(dfaAccepts(mutant, '4294967296')).toBe(true);
    expect(dfaAccepts(kovoLooseIpv4Dfa, '4294967296')).toBe(false);
  });

  it('fails closed on a planted product state-budget mutant', () => {
    expect(() => decideIpv4GrammarRelations({ stateBudget: 1 })).toThrow(
      FiniteAutomataStateBudgetError,
    );
  });
});
