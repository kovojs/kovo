/**
 * KV434 ReDoS-safe string validators (SPEC §6.6/§9.5; plans/secure-framework.md Phase 6 Tier 3).
 *
 * A non-linear-safe or non-literal pattern in a wire string validator is a ReDoS vector:
 * catastrophic backtracking turns a short input into unbounded CPU. The defense:
 *
 *  - Blessed BY-CONSTRUCTION matchers (`email`/`url`/`uuid`/`slug`) — hand-written, backtracking-free
 *    matchers (no `RegExp` with exponential structure). Cover the common needs.
 *  - `s.string().pattern(literal)` — compiled to Kovo's bounded Thompson-NFA/Pike VM subset, so
 *    matching is linear in `program size × input length`. Unsupported regex features are rejected
 *    with KV434 and routed to the audited escape.
 *  - `unsafeRegex(re, justification)` — the audited escape, surfaced in `kovo explain --capabilities`.
 *
 * Honesty (SPEC §6.6): blessed formats and `pattern()` subset matching are by-construction at their
 * sinks; `unsafeRegex(re, justification)` is the explicit audited JS RegExp escape.
 */
import { createBoundedRuntimeAuditCollector } from '@kovojs/core/internal/security-markers';

import {
  compileLinearRegex as compileLinearRegexProgram,
  LinearRegexError,
  linearRegexMatch,
  type LinearRegexProgram,
} from './internal/linear-regex/index.js';

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

// --- pattern() linear matcher (KV434). ---

/** Thrown when `pattern(...)` uses regex syntax outside the linear matcher subset (KV434). */
export class RedosPatternError extends Error {
  readonly code = 'KV434' as const;

  constructor(message: string) {
    super(`KV434 ${message}`);
    this.name = 'RedosPatternError';
  }
}

export type { LinearRegexProgram };

export function compileLinearPattern(source: string, flags = ''): LinearRegexProgram {
  try {
    return compileLinearRegexProgram(source, flags);
  } catch (error) {
    if (error instanceof LinearRegexError) {
      throw new RedosPatternError(`${error.message}. Use unsafeRegex(...).`);
    }
    throw error;
  }
}

export function testLinearPattern(program: LinearRegexProgram, input: string): boolean {
  return linearRegexMatch(program, input);
}

/**
 * Runtime input-size budget (SPEC §6.6). Linear matching bounds CPU, while this keeps memory and
 * validation work for request strings inside the documented schema budget.
 */
export const PATTERN_MAX_INPUT_LENGTH = 4096;

/** A recorded `unsafeRegex()` capability fact for `kovo explain --capabilities`. */
export interface UnsafeRegexFact {
  readonly justification: string;
  readonly source: string;
}

const unsafeRegexFacts = createBoundedRuntimeAuditCollector<UnsafeRegexFact>();

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
  unsafeRegexFacts.record({ justification, source: regex.source });
  return { justification, regex, unsafe: true };
}

/**
 * Drain the recorded `unsafeRegex()` capability facts (SPEC §6.6/§9.5).
 *
 * `kovo explain --capabilities` surfaces every `unsafeRegex(...)` escape STATICALLY: the build-time
 * producer `collectCapabilityEscapesFromProject` (packages/drizzle/src/trust-escapes-static.ts,
 * threat-matrix-plan.md M3) detects each call SITE and emits a `CapabilityExplain{ kind:'unsafeRegex' }`
 * into `graph.capabilities`, so a merely-built (not run) app already lists every audited ReDoS-risk
 * pattern for a reviewer. This runtime drain is retained only as defense-in-depth / test observation
 * of the newest 256 patterns accepted during a live run; it is NOT the audit's source of truth.
 */
export function drainUnsafeRegexFacts(): readonly UnsafeRegexFact[] {
  return unsafeRegexFacts.drain();
}
