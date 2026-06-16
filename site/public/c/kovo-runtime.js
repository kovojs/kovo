// Browser shim for the `@kovojs/runtime` bare specifier used by compiled gallery
// client handler modules (`import { handler } from '@kovojs/runtime'`). The site
// maps `@kovojs/runtime` to this file via an import map (see chrome.mjs). `handler`
// is an identity function at runtime — it exists only for compile-time typing
// (SPEC §4.3) — so the shim mirrors that exactly. Extend if gallery demos start
// importing more client-facing runtime exports.
export const handler = (fn) => fn;
