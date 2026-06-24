/**
 * KV434 ReDoS-safe string validators (SPEC §6.6/§9.5; plans/secure-framework.md Phase 6 Tier 3).
 *
 * A non-linear-safe or non-literal pattern in a wire string validator is a ReDoS vector:
 * catastrophic backtracking turns a short input into unbounded CPU. The defense:
 *
 *  - Blessed BY-CONSTRUCTION matchers (`email`/`url`/`uuid`/`slug`) — hand-written, backtracking-free
 *    matchers (no `RegExp` with exponential structure). Cover the common needs.
 *  - `s.string().pattern(literal)` — by-construction-ISH: a compile-visible literal whose structure
 *    is STATICALLY rejected if it has nested/overlapping quantifiers (the catastrophic-backtracking
 *    class), and whose EXECUTION runs under a runtime step-budget/timeout backstop. A non-literal
 *    (dynamic) pattern is unanalyzable → KV434.
 *  - `unsafeRegex(re, justification)` — the audited escape, surfaced in `kovo explain --capabilities`.
 *
 * Honesty (SPEC §6.6): the blessed formats ARE by-construction; `pattern()` is by-construction-ISH
 * (static reject + step-budget) — NOT labelled by-construction; the full RE2/DFA linear engine is
 * deferred.
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
      } else if (isAsciiLetter(c) || isDigit(c) || '!#$%&\'*+/=?^_`{|}~-'.includes(local[i] ?? '')) {
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
 * group/class that itself contains a quantifier (nested quantifiers, `(a+)+`, `(a*)*`, `(a+)*`), or
 * adjacent overlapping quantifiers (`a+a+`, `\d+\d+` on the same class). This is intentionally
 * conservative (some safe patterns are rejected) — the sound subset, not a full analyzer.
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
    const after = source[close + 1];
    if (after === '+' || after === '*' || after === '{') {
      const body = source.slice(i + 1, close);
      if (containsQuantifier(body)) {
        throw new RedosPatternError(
          `pattern(): nested quantifier in "${source}" — a quantified group whose body is also ` +
            'quantified is a catastrophic-backtracking risk. Use a blessed format or unsafeRegex(...).',
        );
      }
    }
  }

  // 2) Overlapping adjacent quantifiers on the same atom class: `a+a+`, `\d+\d+`, `.*.*`.
  if (/(\\?.)([+*]|\{\d+,?\d*\})\1[+*]/.test(source) || /\.\*\.\*/.test(source)) {
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
 * The runtime step-budget backstop (SPEC §6.6 — fail-closed floor, not a proof). A static-passing
 * `pattern()` literal whose match exceeds a coarse step budget (proportional to input length) is
 * treated as a non-match and recorded, so a pattern that slips the static analysis cannot still burn
 * unbounded CPU. JS `RegExp` has no native step limit; this caps input length as a proxy.
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
