---
title: Why Kovo?
description: How Kovo makes the safe thing the default — owner-scoped reads, escaped output, parameterized queries are what you write, and the unsafe version fails the build or the database refuses it.
order: 1
---

# Why Kovo?

Most of a web app's security is a discipline you have to remember. Scope every query to the current
user. Escape every string before it reaches the page. Parameterize every SQL statement. Miss one —
one forgotten `WHERE user_id = ?` — and it isn't a bug that renders blank. It's a stranger reading
someone else's orders.

Kovo's bet is that human memory is the wrong place to keep a security boundary. So the safe shape is
the one you write by default, the unsafe shape is a build error, and where the compiler can't prove
it, the database itself refuses.

Here's the whole idea in one line. You mark who owns a row:

```ts
orders = pgTable(
  'orders',
  {
    /* … */
  },
  kovo({ owner: (t) => t.userId }),
);
```

Now every read of `orders` is scoped to the signed-in user — enforced by Postgres, at the
connection, not by a `WHERE` clause you remembered to add. Delete the filter, write the query wrong,
reach the table through a different handle: the database still returns only that user's rows. Forget
to scope an owned table at all, and the build fails at the query with `KV414` before it ships.

This page shows that pattern applied to the three mistakes that leak data: reading another user's
rows (IDOR), SQL injection, and XSS. Real code, both sides — what you write, and what Kovo won't let
you write.

## Safe by construction, then defense in depth

Three things have to hold for "you can't hold it wrong" to mean anything:

1. **The safe shape is the default.** Ordinary code — a plain query, `{user.name}` in your markup —
   is already scoped, already escaped. There's no separate "secure" variant to reach for.
2. **The unsafe shape doesn't compile.** Where static analysis can prove a trust-boundary mistake —
   an unescaped sink, a raw SQL string, an owned table read with no scope — it's a build error, not
   a lint you can wave through.
3. **Where it can't prove it, it fails closed.** Authorization is a runtime fact — does _this_ user
   own _this_ row? — so it's enforced at runtime, by the database, default-deny. The engine says no
   without needing a proof.

And every deliberate exception is visible. When you genuinely need raw HTML or raw SQL, you pass a
branded value — `trustedHtml(...)`, a branded `sql` — and it shows up in `kovo explain`. There is no
silent way to opt out of a guarantee. The opt-outs are enumerable.

## IDOR: reading another user's rows

Orders are owned by `userId`, so this loader is already scoped to the caller. There is no `userId`
in the query, and it doesn't need one:

```ts
orders = pgTable(
  'orders',
  {
    /* … */
  },
  kovo({ owner: (t) => t.userId }),
);

orderHistory = query({
  guard: guards.authed(),
  load: (_input, { db }) => db.select().from(orders), // returns only the caller's orders
});
```

The Postgres role this query runs as can only see rows where `userId` matches the session. Kovo sets
the principal per request; the database does the filtering. (Our own commerce example keeps an
explicit `.where(eq(orders.userId, userId))` — for readers, not for safety. Deleting it changes
nothing about who can see what.)

Now the version that leaks in most stacks — an owned table read with no way to scope it:

```ts
db.select().from(orders); // ✗ build: KV414 — read of an owned table is not owner-scoped
```

At build, that's `KV414`. At runtime, if you route around the check somehow, the database returns
zero rows — not everyone's. Reading across users on purpose (an admin report) is a named capability,
`crossOwnerRead`, which requires an admin role and is logged. The wide read exists. It just can't
happen by accident.

## Injection: SQL from a string

The query builder binds values. User input is a parameter, never concatenated into text:

```ts
db.select().from(products).where(eq(products.id, input.id)); // input.id is bound
```

When you need raw SQL, it only reaches the database as a branded `sql` value, which parameterizes
every interpolation for you:

```ts
db.select()
  .from(products)
  .where(sql`id = ${input.id}`); // ${input.id} is a bound parameter, not text
```

A hand-built string doesn't carry that brand, so it can't reach a managed handle (`KV422`). Truly
unsafe SQL — building the statement text yourself — means calling `trustedSql(...)` on purpose, the
audited escape that appears in `kovo explain`.

## XSS: a string that's really markup

Output is escaped. A name with a `<script>` in it renders as characters, not as a tag:

```tsx
<span>{user.name}</span> // user.name = '<img onerror=…>' renders as literal text
```

There's no string-accepting raw-HTML prop to slip markup through. To emit real HTML you build a
`trustedHtml` value deliberately, which carries provenance the compiler can audit (`KV426`):

```tsx
<div>{comment.body}</div>; // escaped — safe by default
<div>{trustedHtml(comment.body)}</div>; // you opted in, on the record
```

The dangerous form is longer to write than the safe one, and it leaves a trace. That's the point.

## Secrets that can't reach the browser

Mark a column `secret` and its value can't be serialized to the client — even if a query selects it:

```ts
session = pgTable('session', { token: text('token') /* … */ }, kovo({ secret: ['token'] }));
```

A session token, a password hash, an OAuth secret: tag it once, and `KV435` keeps it off every wire
frame. Select it into a loader by accident and the value is dropped at the boundary, not shipped and
hoped-unused.

## Where the guarantee actually comes from

"Safe by construction" is a claim you should distrust until you've seen the door. So here's the
mechanism, plainly.

Authorization runs at the storage engine. On Postgres, each request connects as a least-privilege
role — not a superuser — with the user's id set as a session variable, and owned tables carry
row-level security policies keyed to it. Every read and write through that connection is filtered by
the database, by the role, regardless of how the query is written. That's what makes "delete the
`WHERE` clause and it's still safe" true: the boundary sits one layer below your code, where a typo
can't reach it. At startup Kovo audits the database's actual grant graph and refuses to serve if it
finds anything the role can reach that isn't provably scoped.

The static checks are the early-warning layer, not the boundary. `KV414` tells you at build that a
read isn't scoped; it doesn't have to be complete, because the engine is what actually says no. Kovo
tests exactly this: a paranoid build mode turns off every static security check and runs the app, so
the runtime enforcement has to hold on its own. If switching off the compiler's help lets a leak
through, that's a bug we fix — not a guarantee we quietly rest on the compiler for.

## What you're still on the hook for

Installing Kovo does not make your app secure. The honest boundary:

- **The escapes are yours to justify.** `trustedHtml`, `trustedSql`, `crossOwnerRead` exist because
  sometimes you need them. Each is visible in `kovo explain`, but the framework can't know whether
  the HTML you vouched for is actually clean. It makes the exception loud, not correct.
- **Custom policies are your logic.** For rules `owner` can't express — team membership, sharing,
  roles — you write a SQL predicate with `authzPolicy`. Kovo guarantees the policy is attached and
  enforced. It can't guarantee your predicate says what you meant.
- **The types are guardrails, not the proof.** Branded values make the unsafe call awkward to write;
  the enforcement is the runtime and the engine. Don't read a green typecheck as "proven safe."
- **The strong guarantees are on Postgres.** That's where engine-level enforcement lives. SQLite is
  a dev-only, single-tenant convenience — it does not provide these authorization guarantees, and it
  says so out loud when you use it.

## The rest of Kovo

Security is why the constraints exist, but the same wiring the compiler tracks to hold a boundary
also catches ordinary breakage. Rename a column and the query that selected it, the element bound to
it, and the link that carried its id all fail the build at once — stale-UI bugs become compile
errors. What ships is a real multi-page app: interactive at first paint, little JS on the critical
path, its handler and query names legible in View Source and the Network panel. The
[mental model](/getting-started/mental-model/) and the [tutorial](/tutorial/) go through that side in
depth.

## How it compares

At the level that matters for security, the difference is where the boundary lives. Most frameworks
hand you the tools to be safe and trust you to use them every time — parameterize here, scope there,
escape that. Kovo moves the boundary off your memory and into the compiler and the database, so the
default is safe and the exception is loud. The rest of the shape is familiar:

| If you've used…     | What's familiar                                   | What Kovo changes                                                                                                                                                          |
| ------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Next / Remix**    | Server-rendered React, file-based routing         | No hydration and no client-state library; the server↔client wiring is typechecked end-to-end, not runtime-discovered                                                       |
| **htmx / LiveView** | HTML over the wire, server-rendered fragments     | Same wire philosophy, but the fragment/query contracts are statically typed; no stateful socket tier (htmx has none either; unlike LiveView, no per-client server session) |
| **Qwik**            | Resumability, lazy handler loading on interaction | Borrows resumability, but compiles to near-zero client runtime and stays a true MPA — no resumable client app graph                                                        |
| **Astro**           | Islands, MPA, ship-little-JS                      | Same islands-on-an-MPA shape, but Kovo owns the typed data/mutation/authorization graph across the stack, where Astro stays framework-agnostic and content-first           |

## The trade-offs (read this part)

Kovo makes sharp choices, and they cost you things. Where it's the wrong tool:

- **Long-lived, single-heap client apps.** Figma-class canvases, video editors, DAWs — anything
  built around one mutable client session that lives across navigations. Islands can host a rich
  widget, but the app shell is the document, not a persistent runtime.
- **Offline-first.** The server is unconditionally authoritative. There's no sync engine and no
  local-first story.
- **Escape-hatch-heavy code.** The static guarantees hold because app code stays in TypeScript's
  sound subset: `strict` on, no `any`, no `as` casts, no non-null `!`. Those are lint errors here,
  not warnings.
- **Pick-your-own-database freedom, today.** The authorization and invalidation guarantees ride on
  Postgres plus Drizzle metadata. Other stacks can work, but you own the metadata the extractor
  would otherwise give you.

And the status line: **Kovo is pre-v1 and not published to npm.** You can build with it today inside
the repository (the [Tutorial](/tutorial/) does exactly that), but it isn't a `pnpm add` away yet,
and the widget ecosystem is still thin.

## Next steps

- [Quickstart](/getting-started/quickstart/) — get a page rendering and see the checks fire.
- [Thinking in Kovo](/getting-started/mental-model/) — the mental model, built through one small app.
- [Tutorial](/tutorial/) — build a real commerce app end to end.

<details>
<summary>Spec & diagnostics</summary>

Security by construction is the Prime Principle: SPEC §2. Owner-scoping and authorization at the
storage engine — the least-privilege runtime and closure audit, `KV414`, `crossOwnerRead`,
`authzPolicy` — plus secret classification and branded SQL (`KV435`, `KV422`): SPEC §10 /
`spec/10-data-plane.md`. Escaped output and trusted-output escapes (`KV426`): SPEC §6 /
`spec/06-type-system.md`. Non-goals (Figma-class apps, offline-first, pick-your-own-database):
SPEC §1.4.

</details>
