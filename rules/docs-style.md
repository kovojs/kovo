# Docs Style Rule

Kovo's public docs must be task-first, proof-backed, and progressively
disclosed. The reader is building or evaluating an app. Help them get one real
thing working first, then show the guarantees that make the path reliable.

This rule applies to authored docs under `site/content/**/*.md`. Generated API
reference, diagnostic reference, and SPEC text may stay reference-dense, but
cross-links from authored docs should keep that density out of the main path.

## Audience and posture

The primary reader is a senior engineer evaluating whether Kovo helps them ship
less stale, less fragile apps. They reward directness and proof, but they still
arrive with a concrete job: scaffold, route, fetch data, submit a form, secure a
page, test a behavior, or deploy.

Docs should feel like Next.js, Rails, or other excellent framework docs in one
specific way: the page starts from the developer's task, not from the framework's
internal theory. Kovo's proof model is the reason the task is safe; it is not the
first thing every page needs to prove.

## Main rule

Lead with the user's job. Show the smallest useful working path. Explain why it
is safe, inspectable, and compiler-checked only after the reader can see what
they are doing.

## Voice

Write the way Simon Willison blogs: simple, direct, easy to understand. You are
explaining something you just got working to a competent colleague — not writing
a spec, a sales page, or a lecture.

- Short sentences, one idea each. If a sentence joins two clauses with "which
  means" or "in order to", split it.
- Say "you" and "I". "You declare the query once" beats "the query is declared
  once."
- Lead with the concrete thing. "Here's the mutation that adds to the cart:" then
  the code — not three sentences of preamble.
- Show it working. Paste the command, the output, the View Source, the wire
  bytes. Real artifacts beat description.
- Name things exactly. `vp check`, `kovo-csrf`, the `/cart` route — never "the
  relevant command" or "the framework".
- Be honest about rough edges. "The catch is…" and "this part is fiddly…" read as
  trustworthy. Pretending everything is smooth does not.
- Cut throat-clearing. Delete "It's worth noting that", "As you can see",
  "Simply", "In order to". Just say the thing.
- Plain words over jargon — until you're in a reference section where the precise
  term is the point. "The page goes stale" beats "the view diverges from server
  truth" on a guide.
- Earn enthusiasm. One genuine "what's nice here is…" lands; a paragraph of
  adjectives doesn't.

Before and after:

> ✗ "Kovo's mutation system provides a declarative mechanism whereby form
> submissions are validated against a schema and subsequently dispatched to a
> handler in a manner that preserves type safety end-to-end."
>
> ✓ "A mutation is a named form post with a typed input. You write the input
> schema once; Kovo checks the form fields against it and hands your handler a
> typed object. Here's one:"

## Page skeletons (by mode)

Pick the skeleton for the page's mode. Headings are verbs the reader performs.
Every page collapses its SPEC/KV pointers into a `Spec & diagnostics` `<details>`
at the end — except reference pages, where that density is the point and may sit
inline. Do not let reference density leak into guide or tutorial pages.

### Guide — solves one task (reader already has an app)

A guide is skimmable. The arc is: job → smallest code → run it → production shape
→ failure → next, with deeper mechanics collapsed at the end.

```markdown
---
title: <The task, in plain words — e.g. "Mutations & forms">
description: <One sentence: what you can do after reading this.>
---

# <The task>

<One or two sentences: the job in app terms (add to cart, sign in, deploy), and
when to reach for this — and when another feature is the better path.>

## <Verb the smallest path>   <!-- e.g. "Add the mutation" -->

<!-- Smallest runnable code: <=8 lines, one new idea, no forward-referenced
     identifiers. Do not open with the full production object. -->

## Run it

<How to see it work: a command, a View Source, or a click and what changes.>

## <Verb the production shape>   <!-- e.g. "Add CSRF, a guard, and optimism" -->

<Layer one new idea per sub-section. Name anything you leave out.>

## Handle failure

<The typed error, the edge case, what the user actually sees.>

## Next

- [<The next task>](/guides/<slug>/) — <why you'd go there>

<details>
<summary>Spec & diagnostics</summary>

<SPEC §… and KV codes — pointers only. Everything spec/KV lives here, not above.>

</details>
```

### Tutorial — teaches by building (one chapter)

A tutorial reveals concepts in the order the app needs them. Show the change
working before you explain it.

```markdown
# <Chapter N — the thing you'll build>

<One or two sentences: where we are in the app, and what this chapter adds.>

## <Verb the next slice>   <!-- e.g. "Add the cart query" -->

<The next small step, building on the previous chapter. One idea.>

## Run it

<Run the app and see the change — the payoff comes before the explanation.>

## What just happened

<Now that it works, the one concept it taught — in plain words.>

## Next

<One sentence handing off to the next chapter.>

<details>
<summary>Spec & diagnostics</summary>

<Pointers only.>

</details>
```

### Reference — enumerates behavior (density is fine)

A reference page can be dense, but it still opens with when you reach for the
surface and shows a minimal example before the full enumeration.

```markdown
# <The surface — e.g. "The kovo() Vite plugin">

<One sentence: when you reach for this surface.>

## <Verb a minimal use>   <!-- e.g. "Add the plugin" -->

<The smallest real example.>

## <What it does>

<Enumerate the behavior: options table, signatures, return shapes. Dense is fine.>

## Examples

<A couple of real, copy-paste uses.>

<!-- Reference is the dense layer: SPEC § and KV codes may appear inline here. -->
```

## Writing rules

Voice (above) is the register. These are the structural and content choices:

- Open with the user's job. The first paragraph should answer "what can I do
  after reading this?"
- Put the happy path first. Advanced options, lifecycle diagrams, audits, and
  edge cases come after a small working path.
- Use one running example per page whenever possible. Prefer concrete app
  examples such as add-to-cart, contact book, login, checkout, admin page, or
  deployment over abstract framework vocabulary.
- Explain payoff before mechanism. Say "the cart badge updates after the form
  submits" before "the touch graph intersects visible query-backed targets."
- Use proof as reassurance, not posture. Prefer "Run `vp check`; a missing field
  fails before deploy" in the main flow. Put "SPEC §..." and KV taxonomy in
  reference sections unless a diagnostic is the subject of the page.
- Prefer reader verbs in headings: Add, Render, Run, Check, Handle, Deploy,
  Secure, Test. Avoid headings that are only internal nouns unless the page is
  reference material.
- Introduce one new idea at a time. If the first code block needs guards, CSRF,
  queueing, optimistic transforms, transactions, typed errors, and graph
  metadata, it is too large for the first code block.
- Add a "when to use this" sentence for major guides. Also say when another Kovo
  feature is the better path.
- Keep practical checklists near the point of use, not buried after long
  reference sections.
- Code blocks must earn their size. Start with minimal runnable code, then layer
  the production shape. If details are omitted, name the omission in one short
  sentence.
- End with the next useful action. SPEC references may be present, but they
  should not be the emotional closer of a guide.

## SPEC, diagnostics, and proof language

Kovo's correctness story is a product feature. Do not hide it. Do control where
it appears.

- Main path: use plain outcomes and commands. "This fails under `vp check`" is
  usually better than "this violates the invariant."
- Diagnostic path: name KV codes when the reader is expected to recognize or fix
  that diagnostic.
- Reference path: cite SPEC sections, generated artifacts, and graph invariants
  freely.
- Collapsed details: keep "Spec & diagnostics" sections concise. They should
  point to authority, not re-state every proof.

## Before and after checks

Before publishing a docs change, scan the page for these failure signs:

- The first example is a complete production object instead of the smallest
  useful path.
- The page explains a guarantee before showing the user-visible problem it
  solves.
- SPEC/KV citations appear in the first screen without being the topic.
- The practical checklist appears after the reference material.
- The final section sends the reader to authority instead of the next task.
- A paragraph uses more framework nouns than app nouns.

If any are true, revise toward the task-first structure.
