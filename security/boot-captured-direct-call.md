# Threat model: `Reflect.apply` indirection vs boot-captured direct calls

Status: decided (plans/good-perf.md D8, 2026-08-07 — binding). Written 2026-08-08 as the
prerequisite deliverable for O8, before the implementation change.

Normative anchor: `spec/06-type-system.md` §6.6 security-soundness rule 6 (the framework security
bootstrap evaluates before any caller-controlled module; the bootstrap eagerly captures the ambient
bindings and prototypes used by later security decisions; ordinary late replacement of captured
controls affects only unused public bindings). This note changes the **dispatch mechanism** for
already-captured controls. It does not change the trust boundary, the capture window, or the
fail-closed posture.

## 1. What the per-call `Reflect.apply` indirection actually defends

The server-realm intrinsic membranes (`packages/server/src/security-witness-intrinsics.ts`,
`packages/server/src/response-security-intrinsics.ts`,
`packages/server/src/jsx-form-helper-intrinsics.ts`,
`packages/core/src/internal/security-witness-intrinsics.ts`) capture native functions at module
init and, before this change, routed **every** post-boot invocation through a shared helper whose
whole body was `return nativeReflectApply(fn, receiver, args)`.

Given that `fn` itself is boot-captured, the indirection defends exactly three things, all of them
"no observable lookup at invocation time" properties:

- **T1 — poisoned `Function.prototype.apply` / `Function.prototype.call`.** Writing
  `fn.apply(receiver, args)` or `fn.call(receiver, …)` performs a property lookup on `fn`'s
  prototype chain *at every invocation*. App code that replaces `Function.prototype.apply`/`call`
  after boot would intercept every security-relevant call: read secret arguments, forge return
  values, skip the native entirely. `Reflect.apply` invokes `fn` with no property lookup.
- **T2 — poisoned method on the receiver's prototype.** Writing `value.slice(…)` looks `slice` up
  on `String.prototype` per call. Capturing `nativeStringSlice` closes this, but only if the
  *invocation* of the captured function also avoids lookups — which is T1 again.
- **T3 — poisoned iterator protocol.** Spreading (`fn(...args)`) drives
  `%Array.prototype%[Symbol.iterator]` / `%ArrayIteratorPrototype%.next`, both mutable.
  `Reflect.apply` materializes arguments via `CreateListFromArrayLike` (length + indexed reads on
  the framework-built dense array literal), never the iterator protocol.

What the indirection does **not** defend: pre-bootstrap poisoning. If `Reflect.apply` itself was
replaced before the framework evaluated, the capture is a forgery. The membranes handle that today
by probing every captured control with positive and negative semantics at boot and failing closed
(`capturedControlsAreSound`), and SPEC rule 6 explicitly classifies probe-resistant pre-boot
forgeries as privileged host compromise outside the app-level claim.

## 2. The replacement mechanism

At module init — inside the same rule-6 bootstrap window every existing capture already relies on —
each membrane additionally reads `Function.prototype.call` and `Function.prototype.bind` and mints,
via the already-captured `Reflect.apply`:

- `uncurryThis = bind.bind(call)` — so `uncurryThis(fn)` is `call.bind(fn)`, and
  `uncurryThis(fn)(receiver, a, b)` ≡ `fn.call(receiver, a, b)` with the lookup done **once, at
  mint time**. This is the pattern Node.js core uses for its own `primordials`.
- One module-private direct caller per captured prototype method / accessor getter
  (`callWeakMapGet`, `callStringSlice`, …), minted at boot.
- Receiver-**insensitive** captured statics (`Array.isArray`, `Object.*`, `Reflect.*`,
  `JSON.parse`/`stringify`, `Math.*`, `Number.*`, `String.fromCharCode`/`fromCodePoint`,
  `String` as a conversion, `encodeURIComponent`/`decodeURI*`, `Buffer.from`/`concat`/
  `allocUnsafe`/`isBuffer`) are called **directly** (`nativeArrayIsArray(value)`); the ECMAScript /
  Node algorithm for each never reads `this`.
- Receiver-**sensitive** captured statics keep their receiver via a boot-minted bound form.
  The only one in the membranes is `Promise.resolve` (its algorithm uses `this` as the
  constructor): `boundPromiseResolve = bind(Promise.resolve, Promise)` minted at boot.

Invoking a bound function consults only internal slots (`[[BoundTargetFunction]]`,
`[[BoundThis]]`) plus the already-bound `Function.prototype.call` steps. **No observable property
lookup happens at invocation time, and fixed-arity calls never touch the iterator protocol.**
T1, T2 and T3 therefore remain closed with exactly the same strength as `Reflect.apply` gave them.

## 3. Residual cases, enumerated and handled

- **R1 — pre-boot poisoning of `Function.prototype.call`/`bind`.** New capture inputs, same trust
  class as the existing pre-boot capture set (`Reflect.apply`, every native method). Handled the
  same way: the boot soundness suites now run their positive/negative probe corpus **through the
  minted direct callers** (the exact functions used at runtime), so a poisoned `bind`/`call` that
  produces wrong-semantics callers fails closed at boot. A pre-boot forgery that passes the full
  probe corpus and misbehaves later is privileged host compromise per SPEC rule 6 — identical
  status before and after this change (probes were never accepted as provenance).
- **R2 — receiver-sensitivity review.** Calling a static directly passes `this = undefined`. Every
  captured static in the four membranes was reviewed against its spec algorithm; only
  `Promise.resolve` reads `this`, and it keeps a boot-bound receiver. **Standing review rule:**
  a newly captured static must be classified receiver-sensitive/insensitive before it may be
  called directly; when in doubt, mint the bound-receiver form.
- **R3 — genuinely dynamic invocation.** Sites whose target function or arity is caller-shaped
  (`witnessReflectApply`, `securityApply`, `formHelperApply`, the request-carrier proxy `apply`
  trap) **keep** dispatching through the boot-captured `Reflect.apply`. They cannot be proven
  boot-captured per D8 and stay on the indirection; they are off the fixed-shape hot path.
- **R4 — spread/rest ban.** Fixed-arity membrane dispatch must never use `fn(...args)` — that
  would reopen T3. The only variadic paths are R3's, which use `Reflect.apply`
  (`CreateListFromArrayLike`, iterator-free) on framework-built dense arrays.
- **R5 — explicit-`undefined` vs absent optional arguments.** A fixed-arity caller passes
  `undefined` where the old code omitted an argument (`slice(start)` vs `slice(start, undefined)`).
  Reviewed per method: every enrolled builtin branches on `undefined`
  (`ToIntegerOrInfinity(undefined)` → 0, `end === undefined` → length, `encoding === undefined` →
  `'utf8'`, `onRejected === undefined` → identity, comparator `undefined` → default sort), never on
  `arguments.length`. No behavioral difference. A future capture whose algorithm distinguishes
  argument presence must keep a conditional arity at the wrapper.
- **R6 — the frozen realm is defense-in-depth, not the premise.** Generated production servers
  additionally run the request-safe runtime realm lock before any generated/authored module:
  every locked callable's prototype chain — including `Function.prototype`, hence `call`, `apply`
  and `bind` — is made non-configurable/non-writable and sealed. In that posture even syntactic
  `fn.call(…)` could not be re-bound post-boot. The membranes deliberately do **not** rely on this:
  dev servers, vitest workers, and custom runners bootstrap capture-first without the full lock,
  and the membrane guarantee must hold there too.

## 4. Conclusion

For every enumerated threat, a boot-minted direct caller is exactly as strong as per-call
`Reflect.apply` on a boot-captured function. The blanket indirection was therefore not
load-bearing on the fixed-shape paths, and D8's ruling (boot-capture then direct-call, no
fast-vs-hardened flag) stands with **no weakened guarantee**. The load-bearing residue is R3 —
dynamic targets/arity — which explicitly keeps the `Reflect.apply` shape.

Measured motivation (plans/good-perf.md O8): 38.5–38.6% of all production server CPU at c=32 was
apply-shaped call indirection (`apply$12` 33.2–34.4% self, `invoke$1` ~4%, `apply$10` ~1%);
microbenchmarked 4.463 ns per megamorphic `Reflect.apply` call vs 0.516 ns direct at monomorphic
sites.

Pinned by: `packages/server/src/security-witness-intrinsics.test.ts` (post-boot poisoning of
`Function.prototype.call`/`apply`/`bind` + `Reflect.apply` has no effect; pre-import poisoning of
`Function.prototype.bind` fails closed), the pre-existing poisoned-prototype and pre-import
poisoning suites for all four membranes, and the O8 re-profile acceptance criterion (no
apply-shaped frame in the top-5 self-time frames under c=32 load).
