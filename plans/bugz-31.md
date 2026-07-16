# Security Bug Ledger (`bugz-31`)

**Date:** 2026-07-16

**Baseline:** `e71f216829a8039b6bdd0cc77d328fa136e09b6c` (`origin/main` when this
ledger was reproduced).

**Scope:** Distinct request-classifier temporal/provenance findings from the post-`bugz-30`
adversarial pass. Rankings prioritize practical authority impact, then exploitability. `SPEC.md`
§6.6, §9.1, and §9.6 are normative: classifier-recognized intrinsics are pinned before
authored evaluation, uncertain provenance fails closed, and request/task authority may execute only
inside its owning settlement boundary.

## Severity summary

| Severity | Families | Items  |
| -------- | -------: | ------ |
| Critical |        3 | C1-C3  |
| High     |        1 | H1     |

## Critical

- [ ] **C1 - Exact global namespace-member replacement can turn reviewed intrinsic outcomes into
      authored late-authority thenables without KV424.**
  - A top-level `Object.defineProperty` replacement of `Promise.resolve`, `Response.json`,
    `Array.isArray`, or `JSON.stringify` is still accepted as the exact reviewed member. The
    replacement can return an authored class thenable whose hook settles first and performs network
    authority afterward.
  - **Representative repro:**

    ```ts
    import { s, task } from '@kovojs/server';
    class Deferred {
      static then(resolve: (value: { ok: true }) => void): void {
        resolve({ ok: true });
        queueMicrotask(() => { void fetch('https://example.test/late'); });
      }
    }
    Object.defineProperty(Promise, 'resolve', { value: () => Deferred });
    task('intrinsic-member', {
      input: s.object({}),
      async run() { return Promise.resolve(); },
    });
    ```

  - **Evidence:** bundling the e71 classifier and invoking
    `collectUnregisteredSinksFromProject` returned `[]` for the representative and for otherwise
    identical `Response.json`, `Array.isArray`, and `JSON.stringify` replacements. An ECMAScript
    trace produced `then -> framework-settled -> late-authority`. This contradicts the direct
    namespace-member lockdown required by SPEC §6.6 and crosses the request/task settlement model
    in §9.1/§9.6.
  - **Acceptance:** require one framework-owned, pre-authored-evaluation identity for every exact
    global member the classifier trusts; reject assignment, descriptor, alias, and cross-module
    replacement before granting the reviewed call result; add all four variants to the KV424
    corpus and the production-artifact paranoid gate.

- [ ] **C2 - Framework and native-Promise assimilation accept authored class thenables through
      aliases, carriers, and callback results, allowing authority after settlement.**
  - The classifier does not treat a returned class value as executable `then` authority when it is
    direct, const-aliased, selected through an array/object/helper carrier, or returned by a native
    Promise callback. Sync framework roots additionally omit the assimilation check entirely,
    including for imported/re-exported classes. Container helpers such as `.at()`, `.slice()`,
    `.find()`, `.map()`, and `Reflect.get()` expand the silent carrier set.
  - **Representative repro:**

    ```ts
    import { s, task } from '@kovojs/server';
    task('callback-carrier', { input: s.object({}), async run(_input, context) {
      class Deferred {
        static then(resolve: (value: { ok: true }) => void): void {
          resolve({ ok: true });
          queueMicrotask(() => { void context.fetch('https://example.test/late'); });
        }
      }
      return Promise.resolve(1).then(() => [Deferred].at(0));
    } });
    ```

  - **Evidence:** the e71 collector returned `[]` for direct `return Deferred`, a const alias,
    `[Deferred].at(0)`, and the Promise-callback repro. Independent matrices also reproduced
    sync-root imported/re-exported classes; helper aggregate/local/getter/assigned/rest/async/method
    returns; object/array projection, array spread, async-IIFE, conditional/logical/comma/equals and
    `||=`/`&&=`/`??=` carriers; `slice`/`find`/`map`, `Reflect.get`; and
    `then`/`catch`/`finally` callbacks. The same runtime trace places late authority after framework
    settlement. The async imported-class control already emits a generic `then` fact. SPEC §6.6,
    §9.1, §9.6.
  - **Acceptance:** make every framework/native-Promise assimilation site fail closed unless the
    value is proven non-thenable or is an exact framework/native outcome whose identity is pinned;
    cover sync and async request roots, promise settlement callbacks, imports/re-exports, dynamic
    then assignment/prototypes, and opaque container projections without regressing ordinary
    `Response`, redirect/not-found/respond, primitive, plain-data, or exact native-Promise outcomes.

- [ ] **C3 - Trusted root input/request provenance remains trusted after mutation and is assigned
      to call-derived outputs, laundering the same authored thenable.**
  - A root role survives whole/property assignment, array/object destructuring, `Object.assign`,
    `Object.defineProperty`, `Reflect.set`, loop assignment, and mutation through an aggregate
    helper. Separately, `map`, `reduce`, `reduceRight`, `flatMap`, and string protocol hooks can label
    callback-produced values as request input. Returning the contaminated value therefore bypasses
    the otherwise conservative opaque-carrier behavior.
  - **Representative repros:**

    ```ts
    import { s, task } from '@kovojs/server';
    class Deferred {
      static then(resolve: (value: { ok: true }) => void): void {
        resolve({ ok: true });
        queueMicrotask(() => { void fetch('https://example.test/late'); });
      }
    }

    task('x', { input: s.object({ value: s.string() }), async run(input) {
      Object.defineProperty(input, 'value', { value: Deferred });
      return input.value;
    } });

    task('y', { input: s.object({ values: s.array(s.string()) }), async run(input) {
      return input.values.map(() => Deferred)[0];
    } });
    ```

  - **Evidence:** on clean e71, an 18-case async-root matrix returned `[]` for property/whole
    assignment, both destructuring forms, `Object.assign`, `Reflect.set`, descriptor replacement,
    `for..of`, aggregate-helper mutation, `reduce`/`reduceRight`, `map`/`flatMap`,
    `Symbol.match`/`replace`/`split`, and Request descriptor replacement. Controls for a generic
    opaque call, mutable class alias, and module `Map.get` emitted KV424 facts, isolating stale
    trusted-role/call-result provenance as the failure. SPEC §6.6, §9.1, §9.6.
  - **Acceptance:** invalidate or recompute root roles across every write/escape edge and derive
    callback/protocol call results from the callback outputs rather than the receiver role; add the
    full assignment, aggregate, loop, map/reduce/flatMap, and symbol-hook matrix with safe immutable
    input projections as negative controls.

## High

- [x] **H1 - Direct request/capability calls could execute from deferred class instance
      initialization after the owning root settled.**
  - A returned class thenable could resolve first, instantiate itself in a queued microtask, and
    execute otherwise-reviewed request body, storage, DB, task composition/scheduling, webhook,
    invalidation/change-record, cookie, or failure authority from instance fields.
  - **Evidence:** e71's `rejects composition and scheduling across deferred class execution
    boundaries`, `rejects every exact root allowlist across deferred class execution boundaries`,
    and `rejects deferred root authority while keeping the same immediate calls accepted` tests
    passed 3/3. A same-session collector repro emitted `request-handler.opaque-call` for both
    `request.text` and `context.storage.get`, while the immediate controls remain accepted. SPEC
    §6.6, §9.1, §9.6.
