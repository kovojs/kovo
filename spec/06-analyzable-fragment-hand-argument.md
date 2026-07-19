# SPEC §6.6 analyzable-fragment hand argument

Status: reviewed non-mechanized hand argument.

This is not a mechanized proof. It is the repository's explicit, reviewable argument for why the
finite transfer rules in SPEC §6.6 compose and what they are adequate to claim. The generated
prohibition table and compiler witnesses make its boundary falsifiable; they do not turn this prose
into a proof assistant result or a proof of the implementation.

## Claim and classification vocabulary

The claim is intentionally narrow: if a semantic root receives a `proved` verdict, every
authority-bearing value on that root's recorded traces was introduced by a recognized root
parameter or reviewed finite operation, preserved only by the transfer rules named in SPEC §6.6,
and consumed only by an operation in the finite server operation vocabulary. Any transfer that the
relation cannot represent must produce KV449 before output.

The ledger classifications apply to the general prohibition, not to the difficulty of its minimal
witness:

- `FUNDAMENTAL` means sound and complete acceptance for the general JavaScript family would require
  information unavailable to this finite source-local decision procedure or would amount to a
  sound and complete decision over general mutable JavaScript behavior.
- `DELIBERATE` means a narrower exact subset could be implemented, but SPEC §6.6 intentionally
  excludes it to keep invocation identity, authority ownership, and review obligations explicit.
- `BUDGETED` means the transfer is in the finite language but evaluation stops at a deterministic
  resource ceiling. No prohibition row is currently `BUDGETED`; the four resource-contract rows are
  the budgeted boundary.

The `FUNDAMENTAL` label does not say every instance is impossible to analyze. For example, the
minimal `mutating-authority-alias` fixture is easy to reject. It says accepting the whole general
family while remaining both sound and complete is outside the claimed decision procedure.

## Compositionality hand argument

Take one semantic root and order its same-file helper summaries callee-first. The argument is by
structural induction over the finite transfer tree after unsupported constructs and exhausted
budgets have been replaced by closed leaves.

At a leaf, root parameters have the exact authority values assigned by the root contract. A finite
operation has a reviewed door and terminal kind. Its result is plain data, except the explicit
principal-scope acquisition whose returned scope is itself a named provenance value. A direct
unsupported use is therefore a closed leaf with one of the eight closed reasons rather than an
unrecorded authority transition.

For an internal expression step, an exact immutable alias preserves its lattice value. Static
destructuring applies the reviewed member transition to each named property. Those rules neither
invent authority nor erase it. `opaque-container`, `mutating-authority-alias`, and
`mutable-ambiguous-join` close precisely where that local substitution argument would stop being
valid.

For a helper step, an exact immutable same-file callable and exact positional arguments determine
the callee's complete authority-input vector. The context-sensitive summary is keyed by that vector,
computed before its caller, and merged back with the original root and ordered transfer prefix.
Assuming the callee summary satisfies the claim, substitution of its parameter provenances for the
caller's argument provenances preserves the claim. A repeated active key closes as `helper-cycle`;
the resource ceilings close before an unfinished summary can be treated as proved.
`unsummarized-nested-callable`, `arguments-rest-spread-recovery`, `call-apply-bind`, and
`foreign-callable` close the cases where callable identity or positional substitution is not exact.

The query no-managed-write posture is an invariant carried in the root state and copied through
every helper summary. It is not inferred again from a helper's name. Thus a proved callee cannot
silently relax its caller's posture.

By the induction hypothesis, every proved child is authority-preserving and every non-compositional
child is closed. The parent can therefore be proved only when all relevant children and summaries
are proved. This establishes the stated compositionality claim for the finite relation, subject to
the limits below.

## Adequacy hand argument

The relation is adequate for Kovo's claimed purpose only inside that finite language. Within it,
authority enters through enumerated root bindings or an explicit operation result, exact aliases and
member projections retain provenance, helper summaries retain the complete transfer prefix, and
terminal operations retain their reviewed kind and door. Those facts are sufficient for downstream
consumers to reconstruct the root-to-transfer-to-sink decision they own without treating an emitted
graph as runtime authority.

The prohibition ledger is complete with respect to the exact unsupported sentence in SPEC §6.6:
`returning-authority`, `throwing-authority`, `opaque-container`, `mutating-authority-alias`,
`mutable-ambiguous-join`, `unsummarized-nested-callable`,
`arguments-rest-spread-recovery`, `call-apply-bind`, and `foreign-callable` each have exactly one
classification, one of the eight closed reasons, and an app-authored source fixture. The focused
compiler test does not grep those fixtures; it compiles every one and requires both an emitted KV449
diagnostic with the named `verdict=closed:<reason>` and the corresponding closed semantic trace.

The four budgets are adequate as deterministic termination guards, not as semantic evidence. The
checked measurement compiles every tracked starter/example source file that currently declares a
shipping server root: 11 source files and 29 emitted semantic roots. None currently reaches
`budget-call-depth`, `budget-node-count`, `budget-operation-count`, or `budget-summary-count`. The
test recomputes that result from the real files and fails if either the root census or binding set
drifts.

## Limits and non-claims

- This hand argument is not a formal operational semantics, a machine-checked soundness theorem, or
  a proof that the TypeScript implementation faithfully realizes every stated transfer.
- The fixtures prove current compiler verdicts for representative authored programs. One witness
  per prohibition does not prove closure over every JavaScript spelling of that family.
- The argument is not a completeness claim. Deliberate and fundamental closures can reject programs
  whose behavior a stronger whole-program analyzer could prove safe.
- Foreign module behavior, proxies, getters, reflective calls, ambient mutation, and runtime code
  outside the compiler-owned sink doors remain outside the adequacy claim.
- The real-root measurement is a regression observation over the named repository corpus. Zero
  binding roots does not predict downstream application shape and does not justify widening or
  removing a budget.
- Emitted graphs and diagnostics are audit evidence only. Runtime capability ownership and C9 sink
  enforcement remain independent obligations.

Any future widening must update the normative transfer sentence, generated ledger, compiler
witnesses, and this argument together. A new accepted construct cannot be justified merely by
removing its KV449 diagnostic.
