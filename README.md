# Kovo

**The web framework that turns security bugs into build errors.**

> [!WARNING]
> **Technical preview — not ready for production.** Breaking changes and rough edges
> to be expected. We'd love your [feedback](https://github.com/kovojs/kovo/issues).
> Pre-v1, under active implementation; nothing here is published to npm yet.

Make security holes a build error — not a 2AM incident. The Kovo compiler catches the
most common vulnerabilities — **SQL injection**, **XSS**, **CSRF**, **IDOR** — as soon
as your coding agent writes them. It builds multi-page applications that are
**interactive at first paint, legible at every layer, and statically verifiable end-to-end.**

> An application's complete behavior — every handler wiring, navigation target, form field, mutation contract, data dependency, and optimistic prediction — should be provable by TypeScript static checking plus static graph queries, and auditable by reading the page source and the Network panel.

One organizing constraint governs everything: every artifact the system produces (compiled output, HTML, wire traffic, dependency graphs) must be readable by a human in devtools and checkable by a machine without executing a browser.

## What Kovo proves at compile time

**Secure by construction — the unsafe line never compiles.** The compiler traces
untrusted input to its dangerous sink and answers before the code runs: the exact line,
the rule, and the fix. SQL injection (`KV422`), XSS (`KV424`), CSRF (`KV418`), and IDOR
(`KV414`) become build errors instead of incidents.

**Your UI can't disagree with itself.** Declare what a view reads, and the compiler
invalidates exactly the views a mutation touches — the read set _is_ the invalidation
set. No cache tags, no `invalidateQueries`, no `useEffect`. A view that could drift out
of date is a compile error, not a bug your users find later.

**Interactive at first paint — no uncanny valley.** No hydration means no window where
the page looks ready but ignores your clicks. The JavaScript you do use loads on first
interaction, not on load. Turn JavaScript off and every page still renders, every form
still posts.

**Batteries included — everything from the database to the DOM.** Kovo owns the whole
path: a Drizzle row becomes a DOM node, and the types follow it the entire way. It
stands on libraries you already trust — Drizzle, Better Auth, TypeScript — and
type-checks the seams between them, with components and styling inspired by shadcn/ui
and StyleX (own-your-source components; compile-time atomic CSS).

## Who builds this

Kovo comes from the team behind [Dyad](https://github.com/dyad-sh/dyad), the
open-source, local AI app builder with 20k+ stars on GitHub. We built Kovo because we
wanted a target our own agents could generate and verify without guessing — generated
apps fail `tsc` when wiring is wrong, and `kovo check` returns the exact line, the
reason, and candidate fixes.

## Contributing

Kovo is pre-v1 and built in the open. [`CONTRIBUTING.md`](CONTRIBUTING.md) is the
reference for working in the repo — the authoritative documents, the prior art it
composes, the package layout, and how to build and test. The normative source of truth
for framework behavior is [`SPEC.md`](SPEC.md).
