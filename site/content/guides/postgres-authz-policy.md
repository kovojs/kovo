---
title: Team access with Postgres RLS
description: Use a custom Postgres authzPolicy predicate when a table is visible through team or org membership.
order: 2.6
---

# Team access with Postgres RLS

Use this when a document belongs to a team and every member of that team can read or write it. A
direct `owner:` column fits one principal per row. `ownerVia` fits a one-hop parent row. A
many-to-many membership table needs a custom Postgres predicate.

## Model the membership table

Start with the join table. Membership is tenant data, not global reference data. Model the row with
an explicit owner or custom policy so a user can only read the memberships they are allowed to see:

```ts
import { kovo } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';

export const teamMemberships = pgTable(
  'team_memberships',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id').notNull(),
    userId: text('user_id').notNull(),
  },
  kovo({ domain: 'team-membership', key: 'id', owner: 'userId' }),
);
```

Use `owner: 'userId'` when each user may see and manage their own membership rows. If admins manage
membership for other users, put an `authzPolicy` on this table instead. Do not use `reference: true`
for membership graphs; `reference` is for immutable global lookup rows with no tenant data.

## Add the document policy

Annotate the document table with ``kovo({ authzPolicy: sql`...` })``. The predicate should answer:
"does the current database principal have a membership row for this document's team?"

```ts
import { kovo, sql } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';

export const teamMemberships = pgTable(
  'team_memberships',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id').notNull(),
    userId: text('user_id').notNull(),
  },
  kovo({ domain: 'team-membership', key: 'id', owner: 'userId' }),
);

export const teamDocuments = pgTable(
  'team_documents',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
  },
  kovo({
    domain: 'team-document',
    key: 'id',
    authzPolicy: sql`EXISTS (
      SELECT 1 FROM ${teamMemberships}
      WHERE ${teamMemberships.teamId} = "team_documents"."team_id"
        AND ${teamMemberships.userId} = current_setting('kovo.principal', true)
    )`,
  }),
);
```

Keep referenced tables in the predicate as Drizzle interpolations like `${teamMemberships}`. That
lets Kovo provision the grants the policy needs. Raw string table names are harder for the framework
to see and may fail closed at the database engine instead.

## Provision and check it

Run provision with an admin connection. Run check with the same least-privilege connection the app
uses at request time:

```sh
KOVO_ADMIN_DATABASE_URL=postgres://admin@db/app KOVO_DATABASE_URL=postgres://app@db/app \
  kovo db provision
KOVO_DATABASE_URL=postgres://app@db/app kovo db check
```

The command derives the table posture from `src/schema.ts`. For the document table, the important
shape is:

```sql
ALTER TABLE "team_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_documents" FORCE ROW LEVEL SECURITY;

CREATE POLICY kovo_authz_policy ON "team_documents"
  USING (EXISTS (...))
  WITH CHECK (EXISTS (...));
```

You do not write that policy by hand. `kovo db provision` creates or reasserts it, and `kovo db
check` fails non-zero when the table is missing forced RLS, the policy, or a reachable object falls
outside the safe closure audit.

## Check member and non-member behavior

With this seed data:

```sql
INSERT INTO team_memberships (id, team_id, user_id)
VALUES ('m1', 'team-a', 'user-a');

INSERT INTO team_documents (id, team_id, title, body)
VALUES ('d1', 'team-a', 'Alpha plan', '...');
```

`user-a` is a member of `team-a`, so a scoped read sees the row:

```txt
as user-a:
id  title
d1  Alpha plan
```

`user-b` has no matching membership row, so the same read returns nothing:

```txt
as user-b:
(0 rows)
```

A cross-team write fails at the database boundary too:

```txt
as user-b inserting team_id = 'team-a':
ERROR: new row violates row-level security policy for table "team_documents"
```

That failure is the point of the custom predicate path. The app can still run guards and typed
mutation errors for a better user experience, but the database is the last line of defense.

## Run it

Provision once, then check with the app credential and a member/non-member seed:

```sh
KOVO_ADMIN_DATABASE_URL=postgres://admin@db/app KOVO_DATABASE_URL=postgres://app@db/app kovo db provision
KOVO_DATABASE_URL=postgres://app@db/app kovo db check
```

Then run the two reads above. The member sees the row. The non-member gets zero rows, and a cross-team
write fails at the RLS boundary.

## Know the boundary

Kovo guarantees this table is enrolled in the authorization census, provisioned with forced RLS, and
covered by a present `kovo_authz_policy`. It also checks that posture before the app serves.

Kovo does not prove that your predicate expresses the right business rule. If the predicate says
"team members may edit archived documents," Kovo enforces that rule. If archived documents need a
second condition, put that condition in the predicate and test it with member and non-member cases.

## Handle failure

The failure mode to show explicitly is the provision-time unsupported posture:

```txt
KV433_AUTHZ_POLICY_UNSUPPORTED team_documents authzPolicy must stay inside the supported SQL subset.
```

If you hit that, simplify the predicate to the supported shape or move the business rule into a
reviewed database object the policy can reference directly.

## Next

- [Security & authorization](/guides/security/) - owner annotations, guards, and security review.
- [`kovo db` in the CLI guide](/guides/cli/) - provision and posture-check command options.
- [Testing with @kovojs/test](/guides/testing/) - exercise database behavior before deploy.

<details>
<summary>Spec & diagnostics</summary>

- `SPEC §10.3` covers the managed Postgres write boundary and the engine backstop for owner,
  owner-via, and authz-policy tables.
- `KV414` is the authorization census family that requires request-reachable tables to declare an
  ownership, custom authz, public, or reference posture.
- Postgres posture checks report missing forced RLS, missing `kovo_authz_policy`, or unsafe
  reachable objects through the database check output.

API reference: [@kovojs/drizzle](/api/drizzle/), [@kovojs/test](/api/test/).

</details>
