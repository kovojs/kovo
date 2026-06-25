/**
 * KV434 ReDoS-safe string validators (SPEC §6.6/§9.5; plans/secure-framework.md Phase 6 Tier 3).
 *
 * A non-linear-safe or non-literal pattern in a wire string validator is a ReDoS vector:
 * catastrophic backtracking turns a short input into unbounded CPU. The defense:
 *
 *  - Blessed BY-CONSTRUCTION matchers (`email`/`url`/`uuid`/`slug`) — hand-written, backtracking-free
 *    matchers (no `RegExp` with exponential structure). Cover the common needs.
 *  - `s.string().pattern(literal)` — by-construction-ISH: a compile-visible literal whose structure
 *    is STATICALLY rejected if it has nested quantifiers or quantified overlapping alternatives
 *    (the common catastrophic-backtracking class). Runtime also has an input-size cap, but that cap
 *    is NOT a CPU bound. A non-literal (dynamic) pattern is unanalyzable → KV434.
 *  - `unsafeRegex(re, justification)` — the audited escape, surfaced in `kovo explain --capabilities`.
 *
 * Honesty (SPEC §6.6): the blessed formats ARE by-construction; `pattern()` is by-construction-ISH
 * (static reject + input-size cap) — NOT labelled by-construction; the full RE2/DFA linear engine
 * is deferred.
 */

/** A blessed, backtracking-free format matcher and its name (for error messages / capability facts). */
export interface BlessedFormat {
  readonly name: string;
  test(value: string): boolean;
}

// --- Blessed by-construction matchers (no RegExp; single linear pass, no backtracking). ---

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}
function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}
function isHex(code: number): boolean {
  return isDigit(code) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);
}

/** A `slug`: one-or-more lowercase-alnum groups joined by single hyphens (`my-post-2`). Linear. */
export const slugFormat: BlessedFormat = {
  name: 'slug',
  test(value) {
    if (value.length === 0 || value.length > 256) return false;
    let prevHyphen = true; // leading hyphen disallowed
    for (let i = 0; i < value.length; i += 1) {
      const c = value.charCodeAt(i);
      const isLowerAlnum = isDigit(c) || (c >= 0x61 && c <= 0x7a);
      if (isLowerAlnum) {
        prevHyphen = false;
      } else if (c === 0x2d /* - */) {
        if (prevHyphen) return false; // no leading / doubled hyphen
        prevHyphen = true;
      } else {
        return false;
      }
    }
    return !prevHyphen; // no trailing hyphen
  },
};

/** A UUID (any version): 8-4-4-4-12 hex with hyphens. Fixed-length linear scan. */
export const uuidFormat: BlessedFormat = {
  name: 'uuid',
  test(value) {
    if (value.length !== 36) return false;
    for (let i = 0; i < 36; i += 1) {
      const c = value.charCodeAt(i);
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        if (c !== 0x2d) return false;
      } else if (!isHex(c)) {
        return false;
      }
    }
    return true;
  },
};

/**
 * A pragmatic `email`: `local@domain.tld`. One `@`, a non-empty local part of permitted chars, and a
 * dotted domain of alnum/hyphen labels with a TLD. Single linear scan, no backtracking. Deliberately
 * conservative (rejects exotic-but-valid RFC 5322 forms) — the blessed common case.
 */
export const emailFormat: BlessedFormat = {
  name: 'email',
  test(value) {
    if (value.length === 0 || value.length > 254) return false;
    const at = value.indexOf('@');
    if (at <= 0 || at !== value.lastIndexOf('@')) return false; // exactly one @, non-empty local
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    if (local.length > 64 || domain.length === 0) return false;
    // Local part: alnum and a conservative set of specials, no leading/trailing/doubled dot.
    let prevDot = true;
    for (let i = 0; i < local.length; i += 1) {
      const c = local.charCodeAt(i);
      if (c === 0x2e /* . */) {
        if (prevDot) return false;
        prevDot = true;
      } else if (isAsciiLetter(c) || isDigit(c) || "!#$%&'*+/=?^_`{|}~-".includes(local[i] ?? '')) {
        prevDot = false;
      } else {
        return false;
      }
    }
    if (prevDot) return false; // trailing dot in local
    return isValidDomain(domain);
  },
};

/** A hostname: dot-separated labels of alnum/hyphen (no leading/trailing hyphen), at least 2 labels. */
function isValidDomain(domain: string): boolean {
  if (domain.length > 253) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
    for (let i = 0; i < label.length; i += 1) {
      const c = label.charCodeAt(i);
      if (!isAsciiLetter(c) && !isDigit(c) && c !== 0x2d) return false;
    }
  }
  // Final label (TLD) must be all-letters.
  const tld = labels[labels.length - 1] ?? '';
  for (let i = 0; i < tld.length; i += 1) {
    if (!isAsciiLetter(tld.charCodeAt(i))) return false;
  }
  return true;
}

/** An http(s) `url`: scheme `://` host (valid domain or `localhost`) with optional path/query. Linear. */
export const urlFormat: BlessedFormat = {
  name: 'url',
  test(value) {
    if (value.length === 0 || value.length > 2048) return false;
    const lower = value.toLowerCase();
    const scheme = lower.startsWith('https://') ? 8 : lower.startsWith('http://') ? 7 : -1;
    if (scheme === -1) return false;
    const rest = value.slice(scheme);
    if (rest.length === 0) return false;
    // Authority ends at the first `/`, `?`, or `#`.
    let end = rest.length;
    for (let i = 0; i < rest.length; i += 1) {
      const ch = rest[i];
      if (ch === '/' || ch === '?' || ch === '#') {
        end = i;
        break;
      }
    }
    const authority = rest.slice(0, end);
    // Strip an optional `:port`.
    const colon = authority.lastIndexOf(':');
    const host = colon === -1 ? authority : authority.slice(0, colon);
    if (colon !== -1) {
      const port = authority.slice(colon + 1);
      if (port.length === 0 || port.length > 5) return false;
      for (let i = 0; i < port.length; i += 1) if (!isDigit(port.charCodeAt(i))) return false;
    }
    return host === 'localhost' || isValidDomain(host);
  },
};

/** The blessed-format registry, keyed by name. */
export const BLESSED_FORMATS = {
  email: emailFormat,
  slug: slugFormat,
  url: urlFormat,
  uuid: uuidFormat,
} as const;

/** The name of a blessed, backtracking-free string format. */
export type BlessedFormatName = keyof typeof BLESSED_FORMATS;

// --- pattern() static ReDoS analysis (KV434). ---

/** Thrown when `pattern(...)` receives structure that is a catastrophic-backtracking risk (KV434). */
export class RedosPatternError extends Error {
  readonly code = 'KV434' as const;

  constructor(message: string) {
    super(`KV434 ${message}`);
    this.name = 'RedosPatternError';
  }
}

/**
 * Conservatively reject regex source whose structure admits catastrophic backtracking: a quantified
 * group whose body contains a quantifier (`(a+)+`, `(a*)*`, `(a+)*`), a quantified group with
 * overlapping alternatives (`(a|a)*`, `(a|aa)+`, `([a-z]|a)+`), or adjacent overlapping quantified
 * atoms (`a+a+`, `\d+\d+`, `[a-z]+[a-z]*`). This is intentionally conservative — the sound subset,
 * not a full analyzer or a replacement for an RE2-class engine.
 *
 * @param source - The regex source string (the literal body of `pattern(...)`).
 */
export function assertLinearSafePattern(source: string): void {
  // 1) Nested quantifiers: a group closing `)` immediately followed by a quantifier, where the group
  //    body itself contains a quantifier. e.g. `(a+)+`, `(ab*)*`, `(a|b+)+`.
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== '(') continue;
    const close = matchGroupClose(source, i);
    if (close === -1) continue;
    if (quantifierAt(source, close + 1) !== null) {
      const body = stripGroupPrefix(source.slice(i + 1, close));
      if (containsQuantifier(body)) {
        throw new RedosPatternError(
          `pattern(): nested quantifier in "${source}" — a quantified group whose body is also ` +
            'quantified is a catastrophic-backtracking risk. Use a blessed format or unsafeRegex(...).',
        );
      }
      if (hasOverlappingAlternatives(body)) {
        throw new RedosPatternError(
          `pattern(): overlapping alternatives in "${source}" — a quantified group has branches ` +
            'that can start with the same input. Use a blessed format or unsafeRegex(...).',
        );
      }
    }
  }

  // 2) Overlapping adjacent quantifiers on the same atom class: `a+a+`, `\d+\d+`, `.*.*`.
  if (hasAdjacentOverlappingQuantifiers(source)) {
    throw new RedosPatternError(
      `pattern(): overlapping adjacent quantifiers in "${source}" — repeated quantified atoms that ` +
        'can match the same input are a backtracking risk. Use a blessed format or unsafeRegex(...).',
    );
  }
}

/** Whether `source` contains a quantifier (`+`, `*`, or `{n,m}`) outside an escape. */
function containsQuantifier(source: string): boolean {
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1; // skip escaped char
      continue;
    }
    if (ch === '+' || ch === '*' || ch === '{') return true;
  }
  return false;
}

/** Return the end index of a quantifier at `index`, or `null` when none starts there. */
function quantifierAt(source: string, index: number): number | null {
  const ch = source[index];
  if (ch === '+' || ch === '*' || ch === '?') return index + 1;
  if (ch !== '{') return null;
  let i = index + 1;
  if (!isAsciiDigitCode(source.charCodeAt(i))) return null;
  while (isAsciiDigitCode(source.charCodeAt(i))) i += 1;
  if (source[i] === ',') {
    i += 1;
    while (isAsciiDigitCode(source.charCodeAt(i))) i += 1;
  }
  return source[i] === '}' ? i + 1 : null;
}

function isAsciiDigitCode(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** Drop non-capturing/lookaround group prefixes before analyzing the group's first token. */
function stripGroupPrefix(body: string): string {
  if (!body.startsWith('?')) return body;
  if (body.startsWith('?:') || body.startsWith('?=') || body.startsWith('?!')) return body.slice(2);
  if (body.startsWith('?<=') || body.startsWith('?<!')) return body.slice(3);
  return body;
}

function hasOverlappingAlternatives(body: string): boolean {
  const alternatives = splitTopLevelAlternatives(body);
  if (alternatives.length < 2) return false;
  const firstSets = alternatives.map((alternative) => firstTokenSet(alternative));
  for (let i = 0; i < firstSets.length; i += 1) {
    for (let j = i + 1; j < firstSets.length; j += 1) {
      const left = firstSets[i];
      const right = firstSets[j];
      if (left && right && setsOverlap(left, right)) return true;
    }
  }
  return false;
}

function splitTopLevelAlternatives(source: string): string[] {
  const alternatives: string[] = [];
  let depth = 0;
  let classDepth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (classDepth > 0) {
      if (ch === ']') classDepth -= 1;
      continue;
    }
    if (ch === '[') {
      classDepth += 1;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === '|' && depth === 0) {
      alternatives.push(source.slice(start, i));
      start = i + 1;
    }
  }
  alternatives.push(source.slice(start));
  return alternatives;
}

type TokenSet = ReadonlySet<string> | 'unknown';

function firstTokenSet(source: string): TokenSet {
  const atom = readAtom(source, 0);
  return atom?.set ?? 'unknown';
}

function hasAdjacentOverlappingQuantifiers(source: string): boolean {
  let previousQuantified: TokenSet | null = null;
  for (let i = 0; i < source.length; ) {
    const atom = readAtom(source, i);
    if (!atom) {
      previousQuantified = null;
      i += 1;
      continue;
    }
    const quantifierEnd = quantifierAt(source, atom.end);
    if (quantifierEnd === null) {
      previousQuantified = null;
      i = atom.end;
      continue;
    }
    if (previousQuantified && setsOverlap(previousQuantified, atom.set)) return true;
    previousQuantified = atom.set;
    i = quantifierEnd;
  }
  return false;
}

function readAtom(source: string, start: number): { end: number; set: TokenSet } | null {
  const ch = source[start];
  if (!ch || ch === '^' || ch === '$' || ch === '|') return null;
  if (ch === '\\') return readEscapedAtom(source, start);
  if (ch === '[') return readClassAtom(source, start);
  if (ch === '(') {
    const close = matchGroupClose(source, start);
    if (close === -1) return { end: start + 1, set: 'unknown' };
    return { end: close + 1, set: firstTokenSet(stripGroupPrefix(source.slice(start + 1, close))) };
  }
  if (ch === '.') return { end: start + 1, set: 'unknown' };
  return { end: start + 1, set: new Set([ch]) };
}

function readEscapedAtom(source: string, start: number): { end: number; set: TokenSet } {
  const escaped = source[start + 1];
  if (!escaped) return { end: start + 1, set: 'unknown' };
  if (escaped === 'd') return { end: start + 2, set: asciiRange('0', '9') };
  if (escaped === 'w')
    return {
      end: start + 2,
      set: unionSets(
        asciiRange('0', '9'),
        asciiRange('A', 'Z'),
        asciiRange('a', 'z'),
        new Set(['_']),
      ),
    };
  if (escaped === 's') return { end: start + 2, set: new Set([' ', '\t', '\n', '\r', '\f', '\v']) };
  if (escaped === 'D' || escaped === 'W' || escaped === 'S' || escaped === 'p' || escaped === 'P') {
    return { end: start + 2, set: 'unknown' };
  }
  return { end: start + 2, set: new Set([escaped]) };
}

function readClassAtom(source: string, start: number): { end: number; set: TokenSet } {
  const set = new Set<string>();
  let negated = false;
  let i = start + 1;
  if (source[i] === '^') {
    negated = true;
    i += 1;
  }
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (!ch) return { end: source.length, set: 'unknown' };
    if (ch === ']') return { end: i + 1, set: negated ? 'unknown' : set };
    if (ch === '\\') {
      const escaped = readEscapedAtom(source, i);
      if (escaped.set === 'unknown') return { end: i + 2, set: 'unknown' };
      for (const value of escaped.set) set.add(value);
      i = escaped.end - 1;
      continue;
    }
    const rangeEnd = source[i + 2];
    if (source[i + 1] === '-' && rangeEnd && rangeEnd !== ']') {
      for (let code = ch.charCodeAt(0); code <= rangeEnd.charCodeAt(0); code += 1) {
        set.add(String.fromCharCode(code));
      }
      i += 2;
      continue;
    }
    set.add(ch);
  }
  return { end: source.length, set: 'unknown' };
}

function asciiRange(first: string, last: string): Set<string> {
  const set = new Set<string>();
  for (let code = first.charCodeAt(0); code <= last.charCodeAt(0); code += 1) {
    set.add(String.fromCharCode(code));
  }
  return set;
}

function unionSets(...sets: ReadonlySet<string>[]): Set<string> {
  const union = new Set<string>();
  for (const set of sets) for (const value of set) union.add(value);
  return union;
}

function setsOverlap(a: TokenSet, b: TokenSet): boolean {
  if (a === 'unknown' || b === 'unknown') return true;
  for (const value of a) if (b.has(value)) return true;
  return false;
}

/** Index of the `)` closing the group opened at `open`, accounting for nesting and escapes; -1 if none. */
function matchGroupClose(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Runtime input-size backstop (SPEC §6.6 — fail-closed floor, not a proof). A static-passing
 * `pattern()` literal whose input exceeds this cap is treated as a non-match. JS `RegExp` has no
 * native step limit; this is explicitly NOT a CPU bound.
 */
export const PATTERN_MAX_INPUT_LENGTH = 4096;

/** A recorded `unsafeRegex()` capability fact for `kovo explain --capabilities`. */
export interface UnsafeRegexFact {
  readonly justification: string;
  readonly source: string;
}

const unsafeRegexFacts: UnsafeRegexFact[] = [];

/** A regex brand carrying the audited ReDoS-risk acceptance from {@link unsafeRegex}. */
export interface UnsafeRegexBrand {
  readonly justification: string;
  readonly regex: RegExp;
  readonly unsafe: true;
}

/**
 * The audited escape (SPEC §6.6/§9.5): accept the ReDoS risk of an arbitrary `RegExp` explicitly.
 * Records a capability fact surfaced in `kovo explain --capabilities` so a reviewer sees every place
 * a potentially-catastrophic pattern is trusted. Use only when a blessed format and a linear-safe
 * `pattern()` literal cannot express the need.
 *
 * @param regex - The (potentially unsafe) regular expression.
 * @param justification - Why the ReDoS risk is acceptable here (required, audited).
 */
export function unsafeRegex(regex: RegExp, justification: string): UnsafeRegexBrand {
  if (!justification || justification.trim().length === 0) {
    throw new Error('unsafeRegex(...) requires a justification (KV434, SPEC §6.6/§9.5).');
  }
  unsafeRegexFacts.push({ justification, source: regex.source });
  return { justification, regex, unsafe: true };
}

/**
 * Drain the recorded `unsafeRegex()` capability facts (SPEC §6.6/§9.5).
 *
 * SF-WIRE(graph-output): render --capabilities unsafeRegex escapes — wire {@link drainUnsafeRegexFacts}
 * into `kovo explain --capabilities` so each audited ReDoS-risk pattern is surfaced in the audit a
 * reviewer runs.
 */
export function drainUnsafeRegexFacts(): readonly UnsafeRegexFact[] {
  return unsafeRegexFacts.splice(0, unsafeRegexFacts.length);
}
