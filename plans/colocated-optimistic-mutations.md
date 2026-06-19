# Colocated Optimistic Mutations (inline `optimistic` on `mutation()`)

Add an `optimistic` field to `mutation()` so a mutation's optimistic transforms are
declared **in the mutation call**, next to the write that causes them — replacing the
separate `... satisfies OptimisticFor<typeof form>` object, the `CrmDerivedSubset` merge
helper, and (for hand-written pairs) the `generated/optimistic/*` override file. Governed
by SPEC §10.4 (optimism keyed to queries), §10.5 (derivation algebra), §10.6
(exhaustiveness / KV310), and Constitution #2 (no global knowledge at local sites) / #3
(sugar lowers to authorable IR).

**Two design points are resolved (baked into the shape below):** `queue` is a **sibling
field** on the mutation (one knob per mutation, not per-query), and transforms are
**draft-style** `(draft, input) => void` — the author mutates a draft in place, no clone,
no return value.

## Current state (verified)

- `MutationDefinition` accepts sibling `queue` plus inline `optimistic`, typed from
  `InvalidationSets`, `QueryRegistry`, and the sibling input schema.
- The browser optimism runtime and Drizzle generated transforms are draft-style:
  `(draft, input) => void`; legacy returned values remain accepted during migration.
- CRM declares its mixed optimistic plans inline on the mutations; the
  `CrmDerivedSubset` helper and checked-in override files are gone. Commerce has no
  checked-in generated optimistic file; its script still derives the fully generated
  artifact on demand.
- Remaining work is compiler lowering/merge semantics for inline-plus-derived plans,
  KV310's missing non-derivable-key proof, and public docs.

## Target authoring shape

```ts
export const addContact = mutation('addContact', {
  input: s.object({ id: s.string(), name: s.string(), email: s.string(), ownerId: s.string() }),
  errors: { DUPLICATE_EMAIL: duplicateEmailError },
  guard: authed,
  queue: 'crm', // sibling field: per-mutation FIFO lane (§10.4)
  optimistic: {
    // key autocompletes to exactly the queries addContact invalidates (InvalidationSets);
    // `draft` typed as contactList's value, `input` typed from the input schema above.
    // Draft-style: mutate in place, no structuredClone, no return.
    contactList: (draft, input) => {
      draft.items.push({
        id: input.id,
        name: input.name,
        email: input.email,
        ownerId: input.ownerId,
        dealCount: 0,
      });
    },
    // a key may also be the explicit deferral marker:
    // contactDealCount: 'await-fragment',
  },
  handler: addContactHandler,
});
```

- **Override-by-key model.** `optimistic` is the supplement/override surface. A key you
  provide overrides the compiler-derived transform for that pair (§10.4 "an app can
  override generated transforms pair by pair"); a key you omit falls to derivation; if
  derivation also punts and you omit it → **KV310** (inline type error + `kovo check`).
- **Identity inferred.** The mutation key (`'addContact'`, a string literal) resolves
  through `InvalidationSets[Key]` to the invalidated query names; `input` resolves from
  the sibling `input:` schema. No `satisfies`, no restated form identity.

## Resolved design points

- **`queue` is a sibling `queue?: string` field** on the mutation, leaving `optimistic` a
  pure query-keyed map. It is one knob per mutation (a named FIFO lane, §10.4), not
  per-query, so it does not belong inside the transform map.
- **Transforms are draft-style `(draft, input) => void`.** The author mutates a draft and
  returns nothing. The runtime already `structuredClone`s the affected query value before
  applying optimism (§10.4), so the draft _is_ that clone — the current
  `(current, input) => next` immutable form forces the author to write a redundant clone
  by hand. Apply/rebase reads the mutated draft instead of a return value; transforms stay
  pure and re-appliable, so the rebase protocol is unchanged in shape. (Generated derived
  transforms emit the same draft-style signature; this aligns with the draft-transform
  direction in `plans/authoritative-invalidation-graph.md`.)

## Open work

- [ ] **Add `optimistic` (+ `queue`) to `MutationDefinition` with inferred typing.** The
      value type computed from the mutation's own type params, roughly
      `{ [Q in InvalidationSets[Key]]?: ((draft: QueryRegistry[Q], input: InferSchema<InputSchema>) => void) | 'await-fragment' }`,
      plus a sibling `queue?: string`. The load-bearing risk: today
      `OptimisticFor<typeof form>` infers _after_ the form value exists; here the field is
      contextually typed _within_ the same `mutation()` literal. Feasible because
      `mutation<Key, InputSchema, …>` already carries `Key` and `InputSchema`. Evidence
      target: type tests in `packages/server` proving `draft` (mutable, query-value typed)
      and `input` are correctly typed and a missing non-derivable key is a compile error.
  - [x] Base inline field typing and queue metadata are accepted on `mutation()`.
    - Evidence 2026-06-19:
      `npx vitest --run packages/server/src/mutation.test.ts packages/browser/src/optimism-apply.test.ts packages/browser/src/optimism-rebase.test.ts packages/browser/src/optimism-typing.test.ts`
      covers `queue`, invalid optimistic query-key rejection, and contextual
      `draft`/`input` typing from `InvalidationSets`, `QueryRegistry`, and the
      sibling input schema; `corepack pnpm exec tsc --noEmit --pretty false`
      passed.
  - [ ] KV310-backed missing non-derivable key type/error coverage remains open.
- [x] **Draft-style apply in the optimism runtime.** Adjust the optimistic apply/rebase
      loop (`packages/browser/src/optimism.ts`) to hand each transform the
      already-cloned query value as a mutable draft and read the mutated draft back, rather
      than using a returned value. The snapshot/`structuredClone`, per-query pending log,
      rebase ordering, and reconcile are otherwise unchanged (§10.4). Evidence target:
      optimism runtime tests pass with draft-style transforms; a wrong-prediction case
      still silently corrects on server truth.
  - Evidence 2026-06-19:
    `npx vitest --run packages/browser/src/optimism-apply.test.ts packages/browser/src/optimism-rebase.test.ts`
    covers draft mutation during optimistic apply, restore, keyed query instances,
    rebase over server truth, and pagehide discard. Legacy returned values remain
    accepted during migration.
  - [x] Generated derivation codegen emits draft-style transforms.
    - Evidence 2026-06-19:
      `npx vitest --run packages/drizzle/src/derive-codegen.test.ts packages/browser/src/optimism-apply.test.ts packages/browser/src/optimism-rebase.test.ts`
      covers generated `(draft, input) => void` transform source and interpreter parity;
      `corepack pnpm exec tsc --noEmit --pretty false` passed.
- [ ] **Lower the inline field to the optimistic transform IR.** The compiler extracts
      inline transforms into the same transform module the generated/hand-written path
      emits (now draft-style), so `kovo explain --optimistic` and the §5.2 fixpoint hold
      (Constitution #3). Evidence target: compiler fixture showing inline `optimistic` and
      an equivalent standalone draft-style plan lower to byte-identical transform IR;
      recompiling the output is a no-op.
- [ ] **Merge semantics: inline overrides derived, per key.** Define and test that
      provided keys override derived transforms, omitted keys fall to derivation, and the
      union must cover the invalidated set. This collapses the `CrmDerivedSubset` helper —
      the mutation module no longer hand-merges. Evidence target: a partially-derived
      mutation (some keys derived, one overridden inline) passes `kovo check optimistic`
      with the override taking effect and no helper type.
- [ ] **Keep KV310 exhaustiveness at both altitudes.** Inline missing-key type error AND
      `kovo check optimistic` (the CI/agent surface, SPEC §10.6) must both still fire off
      the same `InvalidationSets`-derived set. Evidence target: a mutation that omits a
      punted query fails `kovo check` and shows the editor error.
- [x] **Migrate examples; delete the boilerplate.** Move CRM + commerce optimistic consts
      inline; remove `examples/crm/src/optimistic-merge.ts` (`CrmDerivedSubset`) and the
      hand-written `generated/optimistic/*` override files those pairs produced. Keep
      compiler-derived generated transforms as-is. Synergy: `plans/no-checked-in-generated.md`.
      Evidence target: CRM/commerce compile, `kovo check optimistic` clean, optimistic
      browser/integration tests green, helper file gone.
  - Evidence 2026-06-19:
    `npx vitest --run examples/crm/src/optimistic.test.ts examples/crm/src/graph.test.ts packages/server/src/mutation.test.ts`
    covers CRM inline draft-style optimistic behavior and `kovo check` graph status;
    `find examples/commerce examples/crm -path '*generated/optimistic*' -type f -print`
    returned no checked-in files; `corepack pnpm exec vp check` passed.
- [x] **Docs.** Update `site/content/guides/mutations.md` (and optimistic guide) to teach
      the inline field as the default; keep standalone `OptimisticFor` documented as the
      escape hatch for the rare case a transform cannot be inlined.
  - Evidence 2026-06-19:
    `site/content/guides/mutations.md` and `site/content/guides/optimistic.md`
    teach inline `mutation.optimistic` and draft transforms;
    `npx vitest --run site/tutorial/steps/05-optimistic/src/app.test.ts` passed for the updated
    tutorial snippets; `corepack pnpm exec vp check` passed.

## Risks / notes

- **Type inference is the whole risk.** Self-referential contextual typing within one
  object literal, driven by a string-literal key through the generated `InvalidationSets`
  registry. If TS can't infer cleanly, fall back to a single explicit type param
  (`mutation<'addContact'>(...)` already fixes `Key`), not to re-stating the query set.
- **Draft-style apply is the one runtime change.** The wire, snapshot/`structuredClone`,
  per-query pending log, rebase ordering, reconcile, and `queue` FIFO (§10.4) are all
  unchanged; the only delta is that the apply step reads the mutated draft instead of a
  returned value. Transforms must stay pure (mutate only the draft, no external side
  effects) so rebase re-application is deterministic. Guard with the existing optimism
  runtime tests plus a wrong-prediction correction case.
- **Form vs mutation identity.** Optimism is keyed off the form today; `mutation()` and
  `form()` share the key, so `InvalidationSets[Key]` bridges them. Confirm the form-side
  consumers still resolve when the transform source moves onto the mutation.
- **Standalone `OptimisticFor` stays.** It remains the escape hatch (and the type the
  inline field is sugar over), so external/edge cases are unaffected.

## Latest verification

2026-06-19 latest slice:
`npx vitest --run site/tutorial/steps/05-optimistic/src/app.test.ts`;
`corepack pnpm exec tsc --noEmit --pretty false`; `corepack pnpm exec vp check`;
`git diff --check`.

2026-06-19 previous slice:
`npx vitest --run examples/crm/src/optimistic.test.ts examples/crm/src/graph.test.ts packages/server/src/mutation.test.ts`;
`corepack pnpm exec tsc --noEmit --pretty false`; `corepack pnpm exec vp check`;
`git diff --check`.

2026-06-19 earlier slice:
`npx vitest --run packages/drizzle/src/derive-codegen.test.ts packages/browser/src/optimism-apply.test.ts packages/browser/src/optimism-rebase.test.ts`;
`corepack pnpm exec tsc --noEmit --pretty false`; `git diff --check`;
`corepack pnpm exec vp check`.
