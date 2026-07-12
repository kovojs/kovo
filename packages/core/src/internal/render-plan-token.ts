import { Buffer } from 'node:buffer';
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
export const RENDER_PLAN_GRAMMAR_VERSION = 'kovo-render-plan/2';

/**
 * Encode one render-plan grammar value without relying on delimiter characters
 * being absent from app-authored query or field names. Byte lengths make the
 * encoding canonical across ASCII, control characters, and Unicode (SPEC
 * §5.2.1 rule 1).
 *
 * @internal Shared by the compiler's structural query-shape encoder and this
 * module's query-name encoder so both layers use the same collision-resistant
 * framing contract.
 */
export function encodeRenderPlanFrame(tag: string, value: string): string {
  return `${Buffer.byteLength(tag, 'utf8')}:${tag}${Buffer.byteLength(value, 'utf8')}:${value}`;
}

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
    .map((name) =>
      encodeRenderPlanFrame(
        'query',
        encodeRenderPlanFrame('name', name) +
          encodeRenderPlanFrame('shape', input[name] ?? ''),
      ),
    )
    .join('');
  return createHash('sha256')
    .update(encodeRenderPlanFrame('grammar', RENDER_PLAN_GRAMMAR_VERSION))
    .update(encodeRenderPlanFrame('queries', entries))
    .digest('hex')
    .slice(0, 16);
}
