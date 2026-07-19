import type { Ast, CharRange } from './linear-regex/index.js';
import {
  decideContainment,
  determinizeAst,
  type DeterministicFiniteAutomaton,
  type FiniteAutomataOptions,
  type LanguageDecision,
} from './linear-regex/automata.js';

/** Version of the reviewed IPv4 host-token languages used by the analysis gate. */
export const IPV4_GRAMMAR_VERSION = 'kovo.ipv4-grammar/v1' as const;

function char(ranges: readonly CharRange[]): Ast {
  return { kind: 'char', matcher: { kind: 'class', negated: false, ranges } };
}

function sequence(...nodes: readonly Ast[]): Ast {
  return nodes.length === 0 ? { kind: 'empty' } : { kind: 'concat', nodes };
}

function alternate(...branches: readonly Ast[]): Ast {
  if (branches.length === 0) throw new TypeError('IPv4 grammar alternation cannot be empty');
  return branches.length === 1 ? branches[0]! : { kind: 'alt', branches };
}

function repeat(node: Ast, min = 0, max: number | null = null): Ast {
  return { kind: 'repeat', max, min, node };
}

function literal(value: string): Ast {
  return sequence(
    ...Array.from(value, (character) => {
      const code = character.charCodeAt(0);
      return char([{ from: code, to: code }]);
    }),
  );
}

const dot = literal('.');
const zero = literal('0');

function radixDigit(value: number, radix: 8 | 10 | 16): Ast {
  if (!Number.isInteger(value) || value < 0 || value >= radix) {
    throw new TypeError(`digit ${value} is outside radix ${radix}`);
  }
  if (value < 10) return literal(String(value));
  const lower = 0x61 + value - 10;
  const upper = 0x41 + value - 10;
  return char([
    { from: upper, to: upper },
    { from: lower, to: lower },
  ]);
}

function radixDigitRange(from: number, to: number, radix: 8 | 10 | 16): Ast {
  if (from < 0 || from > to || to >= radix) {
    throw new TypeError('IPv4 grammar digit range is outside its radix');
  }
  const ranges: CharRange[] = [];
  const decimalTo = Math.min(to, 9);
  if (from <= decimalTo) ranges.push({ from: 0x30 + from, to: 0x30 + decimalTo });
  if (to >= 10) {
    const alphaFrom = Math.max(from, 10) - 10;
    const alphaTo = to - 10;
    ranges.push(
      { from: 0x41 + alphaFrom, to: 0x41 + alphaTo },
      { from: 0x61 + alphaFrom, to: 0x61 + alphaTo },
    );
  }
  return char(ranges);
}

function digitsOf(value: number, radix: 8 | 10 | 16): number[] {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('IPv4 numeric grammar bounds must be positive safe integers');
  }
  return value
    .toString(radix)
    .split('')
    .map((digit) => Number.parseInt(digit, radix));
}

/** Canonical, no-leading-zero positive integers in `radix`, bounded by `maximum`. */
function canonicalPositiveAtMost(maximum: number, radix: 8 | 10 | 16): Ast {
  const maximumDigits = digitsOf(maximum, radix);
  const anyDigit = radixDigitRange(0, radix - 1, radix);
  const branches: Ast[] = [];

  for (let length = 1; length < maximumDigits.length; length += 1) {
    branches.push(
      sequence(radixDigitRange(1, radix - 1, radix), repeat(anyDigit, length - 1, length - 1)),
    );
  }

  const equalPrefix: Ast[] = [];
  for (let index = 0; index < maximumDigits.length; index += 1) {
    const upper = maximumDigits[index]! - 1;
    const lower = index === 0 ? 1 : 0;
    if (lower <= upper) {
      const remaining = maximumDigits.length - index - 1;
      branches.push(
        sequence(
          ...equalPrefix,
          radixDigitRange(lower, upper, radix),
          repeat(anyDigit, remaining, remaining),
        ),
      );
    }
    equalPrefix.push(radixDigit(maximumDigits[index]!, radix));
  }
  branches.push(sequence(...equalPrefix));
  return alternate(...branches);
}

function boundedDecimal(maximum: number): Ast {
  return alternate(zero, canonicalPositiveAtMost(maximum, 10));
}

function boundedOctal(maximum: number): Ast {
  return alternate(repeat(zero, 2), sequence(repeat(zero, 1), canonicalPositiveAtMost(maximum, 8)));
}

function boundedHex(maximum: number): Ast {
  const prefix = sequence(
    zero,
    char([
      { from: 0x58, to: 0x58 },
      { from: 0x78, to: 0x78 },
    ]),
  );
  return sequence(
    prefix,
    alternate(repeat(zero, 1), sequence(repeat(zero), canonicalPositiveAtMost(maximum, 16))),
  );
}

/** The exact numeric-token syntax and range checks implemented by `parseLooseIpv4`. */
function kovoPart(maximum: number): Ast {
  return alternate(boundedDecimal(maximum), boundedOctal(maximum), boundedHex(maximum));
}

function unboundedTraditionalPart(): Ast {
  const decimal = alternate(
    zero,
    sequence(radixDigitRange(1, 9, 10), repeat(radixDigitRange(0, 9, 10))),
  );
  const octal = sequence(zero, repeat(radixDigitRange(0, 7, 8), 1));
  const hexadecimal = sequence(
    zero,
    char([
      { from: 0x58, to: 0x58 },
      { from: 0x78, to: 0x78 },
    ]),
    repeat(radixDigitRange(0, 15, 16), 1),
  );
  return alternate(decimal, octal, hexadecimal);
}

function address(...parts: readonly Ast[]): Ast {
  const nodes: Ast[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) nodes.push(dot);
    nodes.push(parts[index]!);
  }
  return sequence(...nodes);
}

/** RFC 3986 `IPv4address`, transcribed from its five `dec-octet` alternatives. */
const decimalDigit = radixDigitRange(0, 9, 10);
const rfc3986DecOctet = alternate(
  decimalDigit,
  sequence(radixDigitRange(1, 9, 10), decimalDigit),
  sequence(literal('1'), decimalDigit, decimalDigit),
  sequence(literal('2'), radixDigitRange(0, 4, 10), decimalDigit),
  sequence(literal('25'), radixDigitRange(0, 5, 10)),
);
export const rfc3986Ipv4AddressLanguage: Ast = address(
  rfc3986DecOctet,
  rfc3986DecOctet,
  rfc3986DecOctet,
  rfc3986DecOctet,
);

/**
 * Traditional `inet_aton` host-token envelope over decimal/octal/hex 1–4-part forms.
 *
 * The URL-host-token domain deliberately excludes surrounding whitespace. Some supported libc and
 * resolver implementations truncate an oversized one-part value to 32 bits, so the one-part arm is
 * an unbounded syntactic envelope. Multi-part widths retain the documented 8/16/24-bit limits. This
 * is a conservative cross-platform model, not a claim that every libc accepts every word in it.
 */
export const traditionalInetAtonLanguage: Ast = alternate(
  address(kovoPart(0xff), kovoPart(0xff), kovoPart(0xff), kovoPart(0xff)),
  address(kovoPart(0xff), kovoPart(0xff), kovoPart(0xffff)),
  address(kovoPart(0xff), kovoPart(0xffffff)),
  address(unboundedTraditionalPart()),
);

/** Exact accepted-language declaration for `parseLooseIpv4` before numeric canonicalization. */
export const kovoLooseIpv4Language: Ast = alternate(
  address(kovoPart(0xff), kovoPart(0xff), kovoPart(0xff), kovoPart(0xff)),
  address(kovoPart(0xff), kovoPart(0xff), kovoPart(0xffff)),
  address(kovoPart(0xff), kovoPart(0xffffff)),
  address(kovoPart(0xffffffff)),
);

export const rfc3986Ipv4AddressDfa = determinizeAst(rfc3986Ipv4AddressLanguage);
export const traditionalInetAtonDfa = determinizeAst(traditionalInetAtonLanguage);
export const kovoLooseIpv4Dfa = determinizeAst(kovoLooseIpv4Language);

/** Decide the reviewed IPv4 language relations and retain any shortest counterexample. */
export function decideIpv4GrammarRelations(options: FiniteAutomataOptions = {}): {
  readonly kovoWithinRfc3986: LanguageDecision;
  readonly kovoWithinTraditionalInetAton: LanguageDecision;
  readonly rfc3986WithinKovo: LanguageDecision;
  readonly traditionalInetAtonWithinKovo: LanguageDecision;
  readonly version: typeof IPV4_GRAMMAR_VERSION;
} {
  return {
    kovoWithinRfc3986: decideContainment(kovoLooseIpv4Dfa, rfc3986Ipv4AddressDfa, options),
    kovoWithinTraditionalInetAton: decideContainment(
      kovoLooseIpv4Dfa,
      traditionalInetAtonDfa,
      options,
    ),
    rfc3986WithinKovo: decideContainment(rfc3986Ipv4AddressDfa, kovoLooseIpv4Dfa, options),
    traditionalInetAtonWithinKovo: decideContainment(
      traditionalInetAtonDfa,
      kovoLooseIpv4Dfa,
      options,
    ),
    version: IPV4_GRAMMAR_VERSION,
  };
}

/** @internal A deliberately widened Kovo model used to prove the overflow witness is live. */
export function unboundedOnePartKovoMutant(): DeterministicFiniteAutomaton {
  return determinizeAst(
    alternate(
      address(kovoPart(0xff), kovoPart(0xff), kovoPart(0xff), kovoPart(0xff)),
      address(kovoPart(0xff), kovoPart(0xff), kovoPart(0xffff)),
      address(kovoPart(0xff), kovoPart(0xffffff)),
      address(unboundedTraditionalPart()),
    ),
  );
}
