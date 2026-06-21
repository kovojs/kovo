import { createHash } from 'node:crypto';

/**
 * The render-plan grammar version folded into every render-plan token so that a
 * module-less (no islands) app still produces a non-empty token (DEPLOY-3), and so
 * that a grammar-only change produces a different token even when no client-module
 * versions changed (SPEC §5.2.1 rule 1).
 *
 * This is the single source of truth shared by `@kovojs/server` (which seeds every
 * build token with it) and `@kovojs/compiler` (which uses it for KV416 token
 * monotonicity, SPEC §5.2.2). Bump this string whenever the update-plan grammar
 * changes in a way that breaks wire compatibility.
 */
export const RENDER_PLAN_GRAMMAR_VERSION = 'kovo-render-plan/1';

/**
 * Input to {@link computeRenderPlanFingerprint}: a map of query name to an opaque
 * string that captures the projected shape (field names, nesting, and order) for
 * that query. The values are stable within a build and must change whenever the
 * projected shape changes (SPEC §5.2.1 rule 1).
 */
export type RenderPlanFingerprintInput = Record<string, string>;

/**
 * Compute an opaque fingerprint that covers the projected query shapes and the
 * render-plan grammar version (SPEC §5.2.1 rule 1). Both the server build token and
 * the compiler's KV416 monotonicity check (SPEC §5.2.2) derive from this one
 * implementation so the two packages cannot drift.
 */
export function computeRenderPlanFingerprint(input: RenderPlanFingerprintInput): string {
  const entries = Object.keys(input)
    .sort()
    .map((name) => `${name}:${input[name]}`);
  return createHash('sha256')
    .update(RENDER_PLAN_GRAMMAR_VERSION)
    .update('\0')
    .update(entries.join('\n'))
    .digest('hex')
    .slice(0, 16);
}
