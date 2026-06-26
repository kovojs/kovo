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

## Page structure

Every guide or tutorial page should generally follow this order:

1. What you will build, fix, or decide on this page.
2. The smallest real code path.
3. How to run or verify it.
4. The common production shape.
5. Failure modes and edge cases.
6. Deeper mechanics, audits, diagnostics, and SPEC links.
7. The next useful action.

Reference pages may enumerate behavior earlier, but they should still start with
when the surface is used.

## Writing rules

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
- Keep bluntness, lose scolding. "Do not put per-user data behind an unguarded
  query" is useful. Making every paragraph sound like a conformance ruling is
  not.
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

## Tutorial, guide, and reference modes

- Tutorial teaches by building. It should reveal concepts in the order the app
  needs them.
- Guide solves a task. It should be skimmable by someone who already has an app.
- Reference enumerates behavior. It can be dense, but it still needs a short
  orientation sentence and examples.

Do not let reference density leak into tutorial and guide pages.

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
