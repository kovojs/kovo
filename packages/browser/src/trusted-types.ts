// SF (secure-framework Tier 3, SPEC §6.6 runtime defense-in-depth): the single
// framework-owned Trusted Types policy. When an app opts into the strict CSP's
// `require-trusted-types-for 'script'` + `trusted-types kovo` directives (csp.ts,
// `trustedTypes: true`), Chromium turns every non-framework `innerHTML`/`script.src`
// DOM-write sink into a throw. That floor only holds because Kovo is the SOLE
// DOM-writer and routes its OWN internal raw-HTML sinks through THIS policy's
// `createHTML` — otherwise the strict CSP would brick Kovo's own hydration on Chromium.
//
// This is Chromium-only DiD, NOT a by-construction proof: every other browser (and any
// browser without the CSP header) silently ignores Trusted Types, so `kovoCreateHTML`
// MUST be a transparent passthrough there. The fallback path returns the raw string
// unchanged, so routing a sink through this helper is behavior-preserving everywhere TT
// is absent — which is what makes it safe to wire ahead of default-on enablement.

/**
 * The browser Trusted Types factory surface this module depends on. Declared locally
 * (the lib.dom TrustedTypes types are not guaranteed in this build) and narrowed to the
 * one method Kovo calls.
 *
 * @internal
 */
interface TrustedTypePolicyFactoryLike {
  createPolicy(
    name: string,
    rules: { createHTML?: (input: string) => string; createScriptURL?: (input: string) => string },
  ): KovoTrustedTypePolicy;
}

/** @internal The narrowed framework policy handle. */
interface KovoTrustedTypePolicy {
  createHTML(input: string): unknown;
  createScriptURL(input: string): unknown;
}

/**
 * SF (secure-framework Tier 3): the framework policy name. MUST match the CSP
 * `trusted-types <name>` directive (`KOVO_TRUSTED_TYPES_POLICY` in
 * `@kovojs/server` `csp.ts`) so the header and the runtime agree.
 */
const KOVO_POLICY_NAME = 'kovo';

/**
 * SF (secure-framework Tier 3): the shared global slot that holds Kovo's single `kovo`
 * Trusted Types policy. The always-on inline loader (`response-fragment-apply.ts`'s
 * inlined `trustedHtml` shim) and this module-side helper BOTH read/write this slot so
 * they reuse the SAME policy: `trusted-types kovo` admits no duplicates, so whichever
 * runs `createPolicy('kovo', …)` first wins and the other reuses the cached handle
 * instead of throwing on a second create. `undefined` = not yet attempted; `null` = TT
 * unavailable or create failed (transparent passthrough).
 *
 * @internal
 */
const KOVO_TT_GLOBAL_KEY = '__kovo_tt';

interface KovoTrustedTypeGlobal {
  __kovo_tt?: KovoTrustedTypePolicy | null;
}

function trustedTypesFactory(): TrustedTypePolicyFactoryLike | undefined {
  const tt = (globalThis as { trustedTypes?: TrustedTypePolicyFactoryLike }).trustedTypes;
  // Feature-detect: only Chromium exposes `window.trustedTypes` with `createPolicy`.
  return tt !== undefined && typeof tt.createPolicy === 'function' ? tt : undefined;
}

/**
 * Lazily create (once) Kovo's sole Trusted Types policy. Returns `null` when Trusted
 * Types is unavailable (every non-Chromium browser, or Chromium without the CSP
 * directive), in which case callers fall back to the raw string. The policy is created
 * at most once; a second `createPolicy('kovo', …)` would throw under the no-duplicates
 * `trusted-types kovo` directive, so the result is cached (including the `null` fallback).
 *
 * @internal
 */
function kovoTrustedTypePolicy(): KovoTrustedTypePolicy | null {
  const store = globalThis as KovoTrustedTypeGlobal;
  // Reuse the shared policy if either the inline loader's `trustedHtml` shim or a prior
  // call here already resolved it (created or proven unavailable). `undefined` = unattempted.
  const shared = store[KOVO_TT_GLOBAL_KEY];
  if (shared !== undefined) return shared;

  const factory = trustedTypesFactory();
  if (factory === undefined) {
    store[KOVO_TT_GLOBAL_KEY] = null;
    return null;
  }

  let policy: KovoTrustedTypePolicy | null;
  try {
    policy = factory.createPolicy(KOVO_POLICY_NAME, {
      // Kovo's raw HTML is framework-assembled (the server emits no inline app code and
      // is the sole HTML source); the policy is the identity transform — its value is the
      // unforgeable `TrustedHTML` brand it mints, which is what the strict CSP requires at
      // the sink. App/attacker raw-string writes that never pass through here still throw.
      createHTML: (input: string) => input,
      createScriptURL: (input: string) => input,
    });
  } catch {
    // A duplicate-policy or factory error must never break hydration: fall back to raw.
    // Note the inline `trustedHtml` shim only registers a `createHTML` rule, so a policy it
    // created lacks `createScriptURL`; `kovoCreateScriptURL` tolerates that (raw passthrough).
    policy = null;
  }
  store[KOVO_TT_GLOBAL_KEY] = policy;
  return policy;
}

/**
 * Route a framework-assembled raw HTML string through Kovo's Trusted Types policy so a
 * subsequent `innerHTML`/`insertAdjacentHTML` write satisfies a strict
 * `require-trusted-types-for 'script'` CSP on Chromium. Returns a `TrustedHTML` value
 * where Trusted Types is enforced, and the raw string verbatim everywhere else
 * (transparent passthrough — behavior-preserving).
 *
 * The return type is `string` so existing sinks (`el.innerHTML = kovoCreateHTML(html)`)
 * type-check unchanged; the `TrustedHTML` object stringifies to its text, and the DOM
 * sink accepts it directly when TT is active.
 *
 * @internal
 */
export function kovoCreateHTML(html: string): string {
  const policy = kovoTrustedTypePolicy();
  if (policy === null) return html;
  // The DOM sink accepts the TrustedHTML object; the `as string` keeps the existing
  // `string`-typed sink assignments compiling without threading TrustedHTML through.
  return policy.createHTML(html) as unknown as string;
}

/**
 * Route a framework-controlled script URL through Kovo's Trusted Types policy so a
 * subsequent `script.src = …` satisfies a strict `require-trusted-types-for 'script'`
 * CSP on Chromium. Transparent passthrough where Trusted Types is absent.
 *
 * @internal
 */
export function kovoCreateScriptURL(url: string): string {
  const policy = kovoTrustedTypePolicy();
  // The shared `kovo` policy may have been minted by the inline loader's `trustedHtml`
  // shim, which only registers a `createHTML` rule (the always-on loader writes no script
  // URLs). When `createScriptURL` is therefore absent, fall back to the raw URL rather than
  // throwing — behavior-preserving, and a strict CSP would block a bare `script.src` anyway.
  if (policy === null || typeof policy.createScriptURL !== 'function') return url;
  return policy.createScriptURL(url) as unknown as string;
}

/**
 * Reset the cached policy. Test-only seam — production creates the policy exactly once.
 *
 * @internal
 */
export function __resetKovoTrustedTypePolicyForTest(): void {
  delete (globalThis as KovoTrustedTypeGlobal)[KOVO_TT_GLOBAL_KEY];
}
