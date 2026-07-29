---
title: Golden task recipes
description: Copy the smallest checked Kovo pattern for sixteen everyday app tasks, then follow the focused guide when you need the production shape.
order: 0.4
---

# Golden task recipes

Start here when you know the job but not the Kovo name. Each recipe below is one complete,
standalone source file. The docs gate checks the displayed bytes against that tracked file, compiles
them from packed packages, and runs the whole set.

## Render a component

Use `component()` when a reusable view needs typed props, query bindings, state, or mutation slots.

<!-- kovo-recipe task="component" source="site/recipes/golden/component.tsx" export="SaveButton" -->

```tsx
import { component } from '@kovojs/core';

export const SaveButton = component({
  props: { label: String },
  render(props: { label: string }) {
    return <button type="submit">{props.label}</button>;
  },
});
```

Call it as `<SaveButton label="Save" />`. Renaming `label` makes every stale call fail in the
component-prop drill below.

## Add a route

Use `route()` for an HTML page. Put path parameters in one schema.

<!-- kovo-recipe task="route" source="site/recipes/golden/route.tsx" export="contactRoute" -->

```tsx
import { route, s } from '@kovojs/server';

export const contactRoute = route('/contacts/:contactId', {
  params: s.object({ contactId: s.string() }),
  page({ params }) {
    return <main>Contact {params.contactId}</main>;
  },
});
```

A path rename and its param-schema rename travel together. `vp check` catches a stale
`params.contactId`.

## Load a query

Use `query()` for typed server data that a component may refresh after a write.

<!-- kovo-recipe task="query" source="site/recipes/golden/query.ts" export="contactQuery" -->

```ts
import { publicAccess, query, s } from '@kovojs/server';

export const contactQuery = query({
  access: publicAccess('the public directory is intentionally visible'),
  args: s.object({ contactId: s.string() }),
  output: s.object({ displayName: s.string(), id: s.string() }),
  load: ({ contactId }: { contactId: string }) => ({
    displayName: 'Ada Lovelace',
    id: contactId,
  }),
});
```

Use a guard instead of `publicAccess(...)` for private data. A real loader reads through the
framework-provided `context.db`; the [queries guide](/guides/queries/) adds that database shape.

## Write a mutation

Use `mutation()` for browser writes. Accept the app-owned CSRF posture once, then keep validation
and the write next to each other.

<!-- kovo-recipe task="mutation" source="site/recipes/golden/mutation.ts" export="defineCreateContact" -->

```ts
import { mutation, publicAccess, s, type CsrfOptions } from '@kovojs/server';

interface ContactsRequest {
  contacts: { create(input: { email: string; name: string }): Promise<void> };
}

export function defineCreateContact(csrf: CsrfOptions<ContactsRequest>) {
  return mutation({
    access: publicAccess('the public demo accepts contact submissions'),
    csrf,
    input: s.object({ email: s.string().email(), name: s.string() }),
    async handler(input, request: ContactsRequest) {
      await request.contacts.create(input);
      return { created: input.email };
    },
  });
}
```

Production apps normally get the CSRF and request types from their app contract. The factory keeps
this standalone recipe honest without hard-coding a signing secret.

## Render a typed form

Put the mutation on the component. The form field names and submitted values now come from the same
input schema.

<!-- kovo-recipe task="form" source="site/recipes/golden/form.tsx" export="defineProfileForm" -->

```tsx
import { component, FieldError, FormError } from '@kovojs/core';
import { mutation, publicAccess, s, type CsrfOptions } from '@kovojs/server';

export function defineProfileForm(csrf: CsrfOptions<unknown>) {
  const updateProfile = mutation({
    access: publicAccess('the demo profile form is intentionally public'),
    csrf,
    errors: { EMAIL_TAKEN: s.object({ email: s.string() }) },
    input: s.object({ email: s.string().email(), name: s.string() }),
    handler: (input) => ({ updated: input.email }),
  });

  return component({
    mutations: { updateProfile },
    render(_props, _state, { forms }) {
      return (
        <form mutation={updateProfile}>
          <input name="name" value={forms.updateProfile.submitted?.name ?? ''} />
          <input name="email" type="email" />
          <FieldError name="email" />
          <FormError code="EMAIL_TAKEN">That email is already registered.</FormError>
          <button type="submit">Save profile</button>
        </form>
      );
    },
  });
}
```

Kovo emits the CSRF and idempotency fields. Do not hand-build hidden mutation fields.

## Expose a machine endpoint

Use `endpoint()` when the caller needs raw HTTP rather than an HTML form.

<!-- kovo-recipe task="endpoint" source="site/recipes/golden/endpoint.ts" export="healthEndpoint" -->

```ts
import { endpoint } from '@kovojs/server';

export const healthEndpoint = endpoint('/healthz', {
  auth: { kind: 'none', justification: 'public uptime probe' },
  csrf: false,
  csrfJustification: 'GET health probes carry no browser write authority',
  handler: () => Response.json({ ok: true }),
  method: 'GET',
  reason: 'load balancer health probe',
  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
});
```

The reason, auth, CSRF, response body, and cache posture all appear in `kovo explain endpoints`.

## Guard an account page

Use `guards.authed()` for a page that needs a session. The page callback receives the refined
request.

<!-- kovo-recipe task="auth" source="site/recipes/golden/auth.tsx" export="accountRoute" -->

```tsx
import { guards, route } from '@kovojs/server';

interface AccountRequest {
  session?: { id: string; user: { email: string; id: string } } | null;
}

export const accountRoute = route('/account', {
  guard: guards.authed<AccountRequest>(),
  page(_input, request) {
    return <main>Signed in as {request.session.user.email}</main>;
  },
});
```

Use the Better Auth binding constructors for production sign-in, sign-out, and session loading.

## Store an object

Start tests with memory storage. Keep the server-minted scoped key instead of a client filename.

<!-- kovo-recipe task="storage" source="site/recipes/golden/storage.ts" export="saveAvatar" -->

```ts
import { createMemoryStorage, publicScopedKey } from '@kovojs/server';

export const avatarStorage = createMemoryStorage();

export async function saveAvatar(bytes: Uint8Array) {
  return avatarStorage.put(publicScopedKey('avatars/current.png'), bytes, {
    contentType: 'image/png',
  });
}
```

Swap in filesystem storage for local development or S3-compatible storage for deployment.

## Run a background task

Use `task()` when work should survive the request and retry after failure.

<!-- kovo-recipe task="task" source="site/recipes/golden/task.ts" export="rebuildSearch" -->

```ts
import { s, task } from '@kovojs/server';

export const rebuildSearch = task({
  input: s.object({ index: s.string() }),
  retry: { backoff: 'exponential', maxAttempts: 4 },
  run: ({ index }) => ({ rebuilt: index }),
});
```

Schedule it from a mutation with `request.schedule(rebuildSearch, { index: 'contacts' })`.

## Verify a webhook

Build the provider verifier from deployment secret material, then parse the body only after the
signature passes.

<!-- kovo-recipe task="webhook" source="site/recipes/golden/webhook.ts" export="defineOrderWebhook" -->

```ts
import { hmacSignature } from '@kovojs/core';
import { s, webhook } from '@kovojs/server';

export function defineOrderWebhook(secret: string) {
  return webhook('/webhooks/orders', {
    verify: hmacSignature({
      encoding: 'hex',
      header: 'x-provider-signature',
      payload: (request) => request.payload,
      secret,
    }),
    input: s.object({ id: s.string(), type: s.string() }),
    handler: ({ id }) => ({ accepted: id }),
  });
}
```

A webhook that writes app data also declares replay storage, idempotency, write domains, and an
explicit principal posture.

## Send an email

Email is durable work plus a bounded egress call. Put the provider call in a task.

<!-- kovo-recipe task="email" source="site/recipes/golden/email.ts" export="sendReceiptEmail" -->

```ts
import { s, task } from '@kovojs/server';

export const sendReceiptEmail = task({
  input: s.object({ orderId: s.string(), to: s.string().email() }),
  async run({ orderId, to }, context) {
    const response = await context.fetch('https://api.resend.com/emails', {
      body: JSON.stringify({ orderId, to }),
      method: 'POST',
    });
    if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
    return { delivered: to };
  },
});
```

Add `https://api.resend.com` to the app egress allowlist. A missing allowlist stays a loud runtime
failure.

## Return a file

Use `respond.file()` for route-owned bytes. Name interpretation-changing metadata explicitly.

<!-- kovo-recipe task="file" source="site/recipes/golden/file.ts" export="invoiceDownload" -->

```ts
import { respond } from '@kovojs/server';

export const invoiceDownload = respond.file(new TextEncoder().encode('invoice,paid\n42,true\n'), {
  contentType: 'text/csv; charset=utf-8',
  filename: 'invoice-42.csv',
  headers: { 'Cache-Control': 'private, no-store' },
});
```

Return this value from a route page. Kovo owns `Content-Disposition` and adapter framing.

## Accept an upload

Use `s.file()` in a mutation input. Cap bytes, verify the content type, and store under a server
key.

<!-- kovo-recipe task="upload" source="site/recipes/golden/upload.ts" export="avatarUpload" -->

```ts
import { createMemoryStorage, s } from '@kovojs/server';

const uploads = createMemoryStorage();

export const avatarUpload = s
  .file()
  .maxBytes(2_000_000)
  .accept(['image/png'])
  .store({ keyPrefix: 'avatars', storage: uploads });
```

Put `avatar: avatarUpload` in the mutation schema. The generated form becomes multipart
automatically.

## Render rich HTML

Use `safeRichHtml()` for CMS-style markup. It sanitizes the fragment before minting the raw-HTML
carrier.

<!-- kovo-recipe task="raw HTML" source="site/recipes/golden/raw-html.ts" export="articleBody" -->

```ts
import { safeRichHtml } from '@kovojs/server';

export const articleBody = safeRichHtml('<p>Hello <strong>reader</strong>.</p>', {
  source: 'CMS rich-text field',
});
```

Use `trustedHtml()` only for already reviewed renderer output and keep its reason and source inline.

## Mint a capability link

A route receives `signUrl` from the request shell. Mint a short-lived URL for one scoped object.

<!-- kovo-recipe task="capability link" source="site/recipes/golden/capability-link.tsx" export="receiptRoute" -->

```tsx
import { publicScopedKey, route, s } from '@kovojs/server';

export const receiptRoute = route('/receipts/:receiptId', {
  params: s.object({ receiptId: s.string() }),
  async page({ params, signUrl }) {
    const signed = await signUrl!({
      expiresIn: 5 * 60_000,
      key: publicScopedKey(`receipts/${params.receiptId}.pdf`),
    });
    return <a href={signed.url}>Download receipt</a>;
  },
});
```

Mount `createStorageDownloadEndpoint()` with the matching signing ring and storage capability. The
endpoint verifies the token before reading the object.

## Declare deploy retention

Pick a preset and state the retention your serving layer really provides.

<!-- kovo-recipe task="deploy" source="site/recipes/golden/deploy.ts" export="deployConfig" -->

```ts
import { defineConfig, node } from '@kovojs/server/build';

export const deployConfig = defineConfig({
  preset: node({
    retention: {
      hours: 24,
      immutableClientModules: 'retained',
      priorTokenQueryReads: 'retained',
    },
  }),
});
```

Do not copy the retention claim until the platform keeps both artifact classes for that window.

## Run the recipes

```sh
pnpm run check:golden-recipes
```

The quick gate verifies the task set, source bytes, public imports, and exported symbols. The
publish gate repeats the compile from freshly packed packages and executes all sixteen recipes.

## Check a rename

These five drills model the stale side of a rename. Each block is expected to fail from packed
types; the block after it is the compiling fix.

### Component props

<!-- kovo-sample: type-error -->

```tsx
// kovo-expected-error: 'text' does not exist
import { component } from '@kovojs/core';
const SaveButton = component({
  render: (props: { label: string }) => <button>{props.label}</button>,
});
SaveButton({ text: 'Save' });
```

```tsx
import { component } from '@kovojs/core';
const SaveButton = component({
  render: (props: { label: string }) => <button>{props.label}</button>,
});
SaveButton({ label: 'Save' });
```

### Query results

<!-- kovo-sample: type-error -->

```ts
// kovo-expected-error: Property 'name' does not exist
import { query, s } from '@kovojs/server';
const contact = query({
  output: s.object({ displayName: s.string() }),
  load: () => ({ displayName: 'Ada' }),
});
contact.load().name;
```

```ts
import { query, s } from '@kovojs/server';
const contact = query({
  output: s.object({ displayName: s.string() }),
  load: () => ({ displayName: 'Ada' }),
});
contact.load().displayName;
```

### Route params

<!-- kovo-sample: type-error -->

```ts
// kovo-expected-error: Property 'id' does not exist
import { route, s } from '@kovojs/server';
route('/contacts/:contactId', {
  params: s.object({ contactId: s.string() }),
  page: ({ params }) => params.id,
});
```

```ts
import { route, s } from '@kovojs/server';
route('/contacts/:contactId', {
  params: s.object({ contactId: s.string() }),
  page: ({ params }) => params.contactId,
});
```

### Form fields

<!-- kovo-sample: type-error -->

```ts
// kovo-expected-error: Property 'fullName' does not exist
import { mutation, s } from '@kovojs/server';
const updateProfile = mutation({
  csrf: false,
  csrfJustification: 'signed non-browser rename drill',
  input: s.object({ name: s.string() }),
  handler: (input) => input.fullName,
});
```

```ts
import { mutation, s } from '@kovojs/server';
const updateProfile = mutation({
  csrf: false,
  csrfJustification: 'signed non-browser rename drill',
  input: s.object({ name: s.string() }),
  handler: (input) => input.name,
});
```

### Mutation errors

<!-- kovo-sample: type-error -->

```ts
// kovo-expected-error: Argument of type '"EMAIL_TAKEN"'
import { mutation, s } from '@kovojs/server';
mutation({
  csrf: false,
  csrfJustification: 'signed non-browser rename drill',
  errors: { DUPLICATE_EMAIL: s.object({ email: s.string() }) },
  input: s.object({ email: s.string() }),
  handler: (_input, _request, context) => context.fail('EMAIL_TAKEN', { email: 'a@example.test' }),
});
```

```ts
import { mutation, s } from '@kovojs/server';
mutation({
  csrf: false,
  csrfJustification: 'signed non-browser rename drill',
  errors: { DUPLICATE_EMAIL: s.object({ email: s.string() }) },
  input: s.object({ email: s.string() }),
  handler: (_input, _request, context) =>
    context.fail('DUPLICATE_EMAIL', { email: 'a@example.test' }),
});
```

## Next

- [Build the first app](/getting-started/quickstart/) — put the recipes into a generated project.
- [Mutations & forms](/guides/mutations/) — add transactions, typed failures, and refresh.
- [Deployment](/guides/deployment/) — prove the platform posture behind the config.

<details>
<summary>Spec & diagnostics</summary>

Components and source-derived identity: SPEC §4.1. Routes, forms, raw ingress, files, capability
links, and webhooks: SPEC §9.1. Queries, mutations, storage, and scoped writes: SPEC §10.2–§10.3.
Durable tasks: SPEC §9.6. Raw output and egress trust doors: SPEC §6.6. Deploy-skew retention:
SPEC §14.

</details>
