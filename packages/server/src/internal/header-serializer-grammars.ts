import type { Ast, CharRange } from './linear-regex/index.js';
import {
  SERIALIZED_HEADER_SAFETY_START_STATE,
  SERIALIZED_HEADER_SAFETY_STATE_COUNT,
  serializedHeaderSafetyTransition,
  serializedHeaderTerminalIsDangerous,
} from '../serialized-header-safety.js';
import {
  decideDisjointness,
  defineDfa,
  determinizeAst,
  type DeterministicFiniteAutomaton,
  type FiniteAutomataOptions,
  type LanguageDecision,
} from './linear-regex/automata.js';

/** Version of the reviewed serializer-language declarations used by the analysis gate. */
export const HEADER_SERIALIZER_GRAMMAR_VERSION = 'kovo.header-serializer-grammar/v1' as const;

function char(ranges: readonly CharRange[]): Ast {
  return { kind: 'char', matcher: { kind: 'class', negated: false, ranges } };
}

function literal(value: string): Ast {
  const nodes: Ast[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    nodes.push(char([{ from: code, to: code }]));
  }
  return sequence(...nodes);
}

function sequence(...nodes: readonly Ast[]): Ast {
  return nodes.length === 0 ? { kind: 'empty' } : { kind: 'concat', nodes };
}

function alternate(...branches: readonly Ast[]): Ast {
  return branches.length === 1 ? branches[0]! : { kind: 'alt', branches };
}

function repeat(node: Ast, min = 0, max: number | null = null): Ast {
  return { kind: 'repeat', max, min, node };
}

function optional(node: Ast): Ast {
  return repeat(node, 0, 1);
}

// The ASCII fallback is non-empty and trimmed. Slash and backslash cannot survive normalization;
// DQUOTE is emitted only as the quoted-pair `\"`. The 255-input-unit cap is intentionally erased:
// this regular superlanguage is larger than the operational output, so disjointness remains sound
// without introducing a numeric grammar into the first obligation.
const fallbackOrdinary = char([
  { from: 0x20, to: 0x21 },
  { from: 0x23, to: 0x2e },
  { from: 0x30, to: 0x5b },
  { from: 0x5d, to: 0x7e },
]);
const fallbackNonSpaceOrdinary = char([
  { from: 0x21, to: 0x21 },
  { from: 0x23, to: 0x2e },
  { from: 0x30, to: 0x5b },
  { from: 0x5d, to: 0x7e },
]);
const escapedFallbackQuote = literal('\\"');
const fallbackAtom = alternate(fallbackOrdinary, escapedFallbackQuote);
const fallbackNonSpaceAtom = alternate(fallbackNonSpaceOrdinary, escapedFallbackQuote);
const escapedFallback = sequence(
  fallbackNonSpaceAtom,
  optional(sequence(repeat(fallbackAtom), fallbackNonSpaceAtom)),
);

const uppercaseHex = char([
  { from: 0x30, to: 0x39 },
  { from: 0x41, to: 0x46 },
]);
const extendedLiteral = char([
  { from: 0x21, to: 0x21 },
  { from: 0x2d, to: 0x2e },
  { from: 0x30, to: 0x39 },
  { from: 0x41, to: 0x5a },
  { from: 0x5f, to: 0x5f },
  { from: 0x61, to: 0x7a },
  { from: 0x7e, to: 0x7e },
]);
const extendedAtom = alternate(extendedLiteral, sequence(literal('%'), uppercaseHex, uppercaseHex));

/**
 * Reviewed whole-header envelope for `createContentDispositionWithFilename` (SPEC §6.6/§9.1).
 * Correlation between fallback and filename* bytes is conservatively erased; every actual output is
 * in this language, and the extra modeled strings can only make the safety proof harder.
 */
export const contentDispositionSerializerLanguage: Ast = sequence(
  alternate(literal('attachment'), literal('inline')),
  literal('; filename="'),
  escapedFallback,
  literal('"'),
  optional(sequence(literal("; filename*=UTF-8''"), repeat(extendedAtom, 1))),
);

const cookieToken = repeat(
  char([
    { from: 0x21, to: 0x21 },
    { from: 0x23, to: 0x27 },
    { from: 0x2a, to: 0x2b },
    { from: 0x2d, to: 0x2e },
    { from: 0x30, to: 0x39 },
    { from: 0x41, to: 0x5a },
    { from: 0x5e, to: 0x60 },
    { from: 0x61, to: 0x7a },
    { from: 0x7c, to: 0x7c },
    { from: 0x7e, to: 0x7e },
  ]),
  1,
);
const cookieOctet = char([
  { from: 0x21, to: 0x21 },
  { from: 0x23, to: 0x2b },
  { from: 0x2d, to: 0x3a },
  { from: 0x3c, to: 0x5b },
  { from: 0x5d, to: 0x7e },
]);
const forwardedAttributeOctet = char([
  { from: 0x20, to: 0x21 },
  { from: 0x23, to: 0x3a },
  { from: 0x3c, to: 0x5b },
  { from: 0x5d, to: 0x7e },
]);
const forwardedAttributeValue = repeat(forwardedAttributeOctet);
const separator = literal('; ');
const valuedAttribute = (name: string): Ast =>
  optional(sequence(separator, literal(`${name}=`), forwardedAttributeValue));
const flagAttribute = (name: string): Ast => optional(sequence(separator, literal(name)));
const unknownAttribute = sequence(
  separator,
  cookieToken,
  optional(sequence(literal('='), forwardedAttributeValue)),
);

/**
 * Reviewed whole-header envelope for the framework-owned `forwardSetCookie` serializer
 * (SPEC §9.1.1). It preserves the exact stable output order while conservatively allowing any token
 * in the unknown-attribute slots. Component alphabets are the runtime validators' exact alphabets.
 */
export const forwardedSetCookieSerializerLanguage: Ast = sequence(
  cookieToken,
  literal('='),
  repeat(cookieOctet),
  valuedAttribute('Max-Age'),
  valuedAttribute('Domain'),
  separator,
  literal('Path='),
  forwardedAttributeValue,
  valuedAttribute('Expires'),
  flagAttribute('HttpOnly'),
  flagAttribute('Secure'),
  optional(
    sequence(
      separator,
      alternate(literal('SameSite=Lax'), literal('SameSite=None'), literal('SameSite=Strict')),
    ),
  ),
  repeat(unknownAttribute),
  valuedAttribute('Priority'),
  flagAttribute('Partitioned'),
);

export const contentDispositionSerializerDfa = determinizeAst(contentDispositionSerializerLanguage);
export const forwardedSetCookieSerializerDfa = determinizeAst(forwardedSetCookieSerializerLanguage);

/** The reviewed production postcondition has exactly five states; keep this mutation-visible. */
export const DANGEROUS_HEADER_DFA_STATE_COUNT = SERIALIZED_HEADER_SAFETY_STATE_COUNT;

/**
 * Five-state scanner for CR/LF/NUL and quote-escape confusion. A safe header has either no DQUOTE
 * field or exactly one balanced DQUOTE field whose only quoted-pairs are `\"` and `\\`.
 */
export const dangerousHeaderDfa: DeterministicFiniteAutomaton = defineDfa({
  accepting: Array.from(
    { length: SERIALIZED_HEADER_SAFETY_STATE_COUNT },
    (_unused, state) => state,
  ).filter(serializedHeaderTerminalIsDangerous),
  alphabet: [
    { from: 0x00, to: 0x00 },
    { from: 0x01, to: 0x09 },
    { from: 0x0a, to: 0x0a },
    { from: 0x0b, to: 0x0c },
    { from: 0x0d, to: 0x0d },
    { from: 0x0e, to: 0x21 },
    { from: 0x22, to: 0x22 },
    { from: 0x23, to: 0x5b },
    { from: 0x5c, to: 0x5c },
    { from: 0x5d, to: 0xffff },
  ],
  start: SERIALIZED_HEADER_SAFETY_START_STATE,
  stateCount: DANGEROUS_HEADER_DFA_STATE_COUNT,
  transition: serializedHeaderSafetyTransition,
});

/** Run both first-obligation proofs with the caller's hard state budget. */
export function decideHeaderSerializerDisjointness(options: FiniteAutomataOptions = {}): {
  readonly contentDisposition: LanguageDecision;
  readonly forwardedSetCookie: LanguageDecision;
  readonly version: typeof HEADER_SERIALIZER_GRAMMAR_VERSION;
} {
  return {
    contentDisposition: decideDisjointness(
      contentDispositionSerializerDfa,
      dangerousHeaderDfa,
      options,
    ),
    forwardedSetCookie: decideDisjointness(
      forwardedSetCookieSerializerDfa,
      dangerousHeaderDfa,
      options,
    ),
    version: HEADER_SERIALIZER_GRAMMAR_VERSION,
  };
}

/** @internal Test-only constructor for planted serializer-language mutants. */
export function serializerLanguageMutant(input: {
  readonly contentDispositionFallbackExtra?: readonly CharRange[];
  readonly cookieValueExtra?: readonly CharRange[];
}): {
  readonly contentDisposition: DeterministicFiniteAutomaton;
  readonly forwardedSetCookie: DeterministicFiniteAutomaton;
} {
  const mutantFallback = alternate(fallbackAtom, char(input.contentDispositionFallbackExtra ?? []));
  const mutantContentDisposition = sequence(
    literal('inline; filename="'),
    repeat(mutantFallback, 1),
    literal('"'),
  );
  const mutantCookieValue = alternate(cookieOctet, char(input.cookieValueExtra ?? []));
  const mutantCookie = sequence(literal('sid='), repeat(mutantCookieValue, 1), literal('; Path=/'));
  return {
    contentDisposition: determinizeAst(mutantContentDisposition),
    forwardedSetCookie: determinizeAst(mutantCookie),
  };
}
