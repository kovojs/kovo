// Browser shim for runtime bare specifiers used by compiled gallery client
// handler modules. `handler` is an identity function at runtime — it exists only
// for compile-time typing (SPEC §4.3) — so the shim mirrors that exactly.
export const derive = (inputs, run) => ({ inputs, run });
export const handler = (fn) => fn;
export const kovoStyleProperty = (name, value) =>
  value == null || value === false ? '' : `${name}: ${value}`;
