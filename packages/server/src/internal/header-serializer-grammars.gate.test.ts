import { describe, expect, it } from 'vitest';

import { createContentDispositionWithFilename } from '../content-disposition.js';
import { forwardSetCookie } from '../cookies.js';
import {
  contentDispositionSerializerDfa,
  DANGEROUS_HEADER_DFA_STATE_COUNT,
  dangerousHeaderDfa,
  decideHeaderSerializerDisjointness,
  forwardedSetCookieSerializerDfa,
  HEADER_SERIALIZER_GRAMMAR_VERSION,
  serializerLanguageMutant,
} from './header-serializer-grammars.js';
import {
  decideDisjointness,
  dfaAccepts,
  FiniteAutomataStateBudgetError,
} from './linear-regex/automata.js';

const contentDispositionWithFilename = createContentDispositionWithFilename({
  charCodeAt: (value, index) => value.charCodeAt(index),
  encodeURIComponent: (value) => encodeURIComponent(value),
  slice: (value, start, end) => value.slice(start, end),
  trim: (value) => value.trim(),
});

function assertModeledContentDisposition(input: string): void {
  for (const disposition of ['attachment', 'inline'] as const) {
    const output = contentDispositionWithFilename(disposition, input);
    if (!dfaAccepts(contentDispositionSerializerDfa, output)) {
      throw new Error(`Content-Disposition model rejected ${JSON.stringify({ input, output })}`);
    }
    if (dfaAccepts(dangerousHeaderDfa, output)) {
      throw new Error(
        `Content-Disposition danger DFA accepted ${JSON.stringify({ input, output })}`,
      );
    }
  }
}

function assertModeledForwardedCookie(raw: string): void {
  const output = forwardSetCookie(raw, { class: 'session', source: 'session-provider' });
  if (!dfaAccepts(forwardedSetCookieSerializerDfa, output)) {
    throw new Error(`Set-Cookie model rejected ${JSON.stringify({ output, raw })}`);
  }
  if (dfaAccepts(dangerousHeaderDfa, output)) {
    throw new Error(`Set-Cookie danger DFA accepted ${JSON.stringify({ output, raw })}`);
  }
}

describe('header serializer grammar-containment gate', () => {
  it('proves both declared serializer envelopes disjoint from the five-state danger DFA', () => {
    expect(HEADER_SERIALIZER_GRAMMAR_VERSION).toBe('kovo.header-serializer-grammar/v1');
    expect(DANGEROUS_HEADER_DFA_STATE_COUNT).toBe(5);
    expect(dangerousHeaderDfa.transitions).toHaveLength(5);
    expect(decideHeaderSerializerDisjointness()).toEqual({
      contentDisposition: { exploredStates: expect.any(Number), holds: true },
      forwardedSetCookie: { exploredStates: expect.any(Number), holds: true },
      version: 'kovo.header-serializer-grammar/v1',
    });
  });

  it('binds every single UTF-16 input unit and boundary-state pair to the Content-Disposition model', () => {
    for (let code = 0; code <= 0xffff; code += 1) {
      const character = String.fromCharCode(code);
      assertModeledContentDisposition(character);
      assertModeledContentDisposition(`a${character}b`);
    }

    const stateRepresentatives = [
      '\0',
      '\n',
      '\r',
      ' ',
      '"',
      '/',
      '\\',
      'a',
      '\x7f',
      '\u061c',
      '\u202e',
      '\ud800',
      '\udc00',
      '\udfff',
      '\uffff',
    ];
    for (const left of stateRepresentatives) {
      for (const right of stateRepresentatives) assertModeledContentDisposition(left + right);
    }
  });

  it('binds exhaustive ASCII component classes to the forwarded Set-Cookie model', () => {
    const cookieOctet = (code: number) =>
      code === 0x21 ||
      (code >= 0x23 && code <= 0x2b) ||
      (code >= 0x2d && code <= 0x3a) ||
      (code >= 0x3c && code <= 0x5b) ||
      (code >= 0x5d && code <= 0x7e);
    const attributeOctet = (code: number) =>
      code >= 0x20 && code <= 0x7e && code !== 0x22 && code !== 0x3b && code !== 0x5c;

    for (let code = 0; code <= 0x7f; code += 1) {
      const character = String.fromCharCode(code);
      const valueRaw = `sid=a${character}b; Path=/`;
      if (cookieOctet(code)) assertModeledForwardedCookie(valueRaw);
      // A semicolon in raw syntax is a segment delimiter, not a value code unit; the structural
      // parser re-emits it only as the fixed `; ` separator covered by the model.
      else if (code === 0x3b) assertModeledForwardedCookie(valueRaw);
      else
        expect(
          () => assertModeledForwardedCookie(valueRaw),
          `value U+${code.toString(16)}`,
        ).toThrow();

      const attributeRaw = `sid=tok; Path=/a${character}b`;
      if (attributeOctet(code)) assertModeledForwardedCookie(attributeRaw);
      else if (code === 0x3b) assertModeledForwardedCookie(attributeRaw);
      else
        expect(
          () => assertModeledForwardedCookie(attributeRaw),
          `attribute U+${code.toString(16)}`,
        ).toThrow();
    }

    for (const raw of [
      'sid=tok; Path=/; SameSite=None; Priority=High; Partitioned; SameParty',
      'sid=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
      'sid=a%20b%2Cc%3Dd; Domain=example.test; Path=/auth',
    ]) {
      assertModeledForwardedCookie(raw);
    }
  });

  it.each([
    ['NUL', 0x00],
    ['LF', 0x0a],
    ['CR', 0x0d],
  ])('kills the planted %s serializer-language mutant with a minimized witness', (_name, code) => {
    const range = [{ from: code, to: code }];
    const mutants = serializerLanguageMutant({
      contentDispositionFallbackExtra: range,
      cookieValueExtra: range,
    });
    for (const mutant of [mutants.contentDisposition, mutants.forwardedSetCookie]) {
      const decision = decideDisjointness(mutant, dangerousHeaderDfa);
      expect(decision).toMatchObject({ counterexample: expect.any(String), holds: false });
      if (!decision.holds) {
        expect(decision.counterexample).toContain(String.fromCharCode(code));
        expect(dfaAccepts(mutant, decision.counterexample)).toBe(true);
        expect(dfaAccepts(dangerousHeaderDfa, decision.counterexample)).toBe(true);
      }
    }
  });

  it.each([
    ['unescaped DQUOTE', 0x22],
    ['dangling reverse solidus', 0x5c],
  ])('kills the planted %s quote-confusion mutant', (_name, code) => {
    const mutant = serializerLanguageMutant({
      contentDispositionFallbackExtra: [{ from: code, to: code }],
    }).contentDisposition;
    const decision = decideDisjointness(mutant, dangerousHeaderDfa);
    expect(decision).toMatchObject({ counterexample: expect.any(String), holds: false });
  });

  it('fails closed on the planted containment state-budget mutant', () => {
    expect(() =>
      decideDisjointness(contentDispositionSerializerDfa, dangerousHeaderDfa, { stateBudget: 1 }),
    ).toThrow(FiniteAutomataStateBudgetError);
  });
});
