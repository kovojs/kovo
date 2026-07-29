---
title: Golden task recipes
description: Copy the smallest checked Kovo pattern for sixteen everyday app tasks, then follow the focused guide when you need the production shape.
order: 0.4
---

# Golden task recipes

Start here when you know the job but not the Kovo name. Each recipe is a real tracked source file.
The docs gate checks the displayed bytes and exported symbol, compiles every file from packed
packages, and runs the set through those same packages.

## Render a component

Use `component()` when a reusable view needs typed props, queries, state, or mutation slots.

<!-- kovo-recipe task="component" source="site/recipes/golden/component.tsx" export="SaveButton" -->

```tsx
import { component } from '@kovojs/core';

export const SaveButton = component({
  props: { label: String },
  render(props: { label: string }) {
    return <button type="submit">{props.label}</button>;
  },
});

export function saveButtonPreview() {
  return <SaveButton label="Save" />;
}
```

Call it as `<SaveButton label="Save" />`. A stale prop fails the rename drill below.

## Add a route

Declare the route on the app contract so its access posture and request type share one owner.

<!-- kovo-recipe task="route" source="site/recipes/golden/route.tsx" export="contactRoute" -->

```tsx
import { defineKovo, s } from '@kovojs/server';
import { renderRouteHtml } from '@kovojs/server/rendering';

const app = defineKovo({
  appId: 'ba3fd9ff-cf8e-4fea-89ea-188f88e8c915',
  egress: { allowInternal: [] },
  renderRoute: renderRouteHtml,
});

export const contactRoute = app.route('/contacts/:contactId', {
  access: app.publicAccess('the public directory is intentionally visible'),
  params: s.object({ contactId: s.string() }),
  page({ params }) {
    return <main>Contact {params.contactId}</main>;
  },
});

export const routeRecipeApp = app.assemble({ routes: [contactRoute] });
```

Use a guard such as `[app.authenticated]` when the page is private.

## Load a query

Put reads on the same app contract. The output schema becomes the result contract for every
consumer.

<!-- kovo-recipe task="query" source="site/recipes/golden/query.ts" export="contactQuery" -->

```ts
import { defineKovo, s } from '@kovojs/server';

const app = defineKovo({
  appId: '4109e077-a43d-4f42-bd6c-8b8a33981cd7',
});

export const contactQuery = app.query({
  access: app.publicAccess('the public directory is intentionally visible'),
  args: s.object({ contactId: s.string() }),
  output: s.object({ displayName: s.string(), id: s.string() }),
  load: ({ contactId }: { contactId: string }) => ({
    displayName: 'Ada Lovelace',
    id: contactId,
  }),
});
```

A production loader reads through the app-inferred read-only `context.db`. Add the handle to the
app's single `app.assemble({ queries })` call; the compiler supplies its source-derived identity.

## Write a mutation

Declare CSRF once on the app, then keep validation and the handler together.

<!-- kovo-recipe task="mutation" source="site/recipes/golden/mutation.ts" export="createContact" -->

```ts
import { defineKovo, s } from '@kovojs/server';

const app = defineKovo({
  appId: 'f68bd563-574a-42d4-af25-b1631e7937c4',
  csrf: {
    anonymousCookie: false,
    secret: 'golden-mutation-csrf-secret-at-least-32-bytes',
    sessionId: () => undefined,
  },
});

export const createContact = app.mutation({
  access: app.publicAccess('the public demo accepts contact submissions'),
  input: s.object({ email: s.string().email(), name: s.string() }),
  handler: (input) => ({ created: input.email, name: input.name }),
});
```

Load the signing secret from deployment configuration in a real app. Kovo emits CSRF and
idempotency fields for forms; do not hand-build them. Assemble the handle in the app root so the
compiler supplies its source-derived identity.

## Show a typed form error

Declare error payloads on the mutation and render them with the form helpers. The error code and
field names remain compiler-checked.

<!-- kovo-recipe task="form error" source="site/recipes/golden/form-error.tsx" export="ProfileForm" -->

```tsx
import { component, FieldError, FormError } from '@kovojs/core';
import { defineKovo, s } from '@kovojs/server';

const app = defineKovo({
  appId: '425ca355-d01e-434a-86fc-3697ca21c0b7',
  csrf: {
    anonymousCookie: false,
    secret: 'golden-form-error-csrf-secret-at-least-32-bytes',
    sessionId: () => undefined,
  },
});

export const updateProfile = app.mutation({
  access: app.publicAccess('the demo profile form is intentionally public'),
  errors: { EMAIL_TAKEN: s.object({ email: s.string() }) },
  input: s.object({ email: s.string().email(), name: s.string() }),
  handler(input, _request, context) {
    if (input.email === 'taken@example.test') {
      return context.fail('EMAIL_TAKEN', { email: input.email });
    }
    return { updated: input.email };
  },
});

export const ProfileForm = component({
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
```

Validation errors use the same helpers. Application errors stay named and payload-typed.

## Guard an account page

Declare the session provider once. `app.authenticated` refines the request for the page.

<!-- kovo-recipe task="auth" source="site/recipes/golden/auth.tsx" export="accountRoute" -->

```tsx
import { defineKovo } from '@kovojs/server';
import { renderRouteHtml } from '@kovojs/server/rendering';

const app = defineKovo({
  appId: '2afc9fe5-730d-486a-89d8-1f4c166103a4',
  auth: () => ({
    id: 'session-1',
    user: { email: 'ada@example.test', id: 'user-1' },
  }),
  egress: { allowInternal: [] },
  renderRoute: renderRouteHtml,
});

export const accountRoute = app.route('/account', {
  access: [app.authenticated],
  page(_input, request) {
    return <main>Signed in as {request.session.user.email}</main>;
  },
});

export const authRecipeApp = app.assemble({ routes: [accountRoute] });
```

Use the Better Auth binding for production credentials and session rotation.

## Add inline optimism

Bind the prediction to the query it updates. The mutation accepts only bindings owned by the same
app and the same input schema.

<!-- kovo-recipe task="inline optimism" source="site/recipes/golden/inline-optimism.ts" export="addItem" -->

```ts
import { defineKovo, s } from '@kovojs/server';

const app = defineKovo({
  appId: '0c27a49f-2779-46cf-9b72-34478869ccb8',
  csrf: {
    anonymousCookie: false,
    secret: 'golden-inline-optimism-secret-at-least-32-bytes',
    sessionId: () => undefined,
  },
});

export const cartCountQuery = app.query({
  access: app.publicAccess('the anonymous cart count is intentionally visible'),
  output: s.object({ count: s.number().int().min(0) }),
  load: () => ({ count: 1 }),
});

const addItemInput = s.object({ quantity: s.number().int().min(1) });

export function predictCartCount(
  current: Readonly<{ count: number }>,
  input: { quantity: number },
) {
  return { count: current.count + input.quantity };
}

export const addItem = app.mutation({
  access: app.publicAccess('the anonymous cart write is protected by app CSRF'),
  input: addItemInput,
  optimistic: [cartCountQuery.optimistic(addItemInput, predictCartCount)],
  handler: ({ quantity }) => ({ quantity }),
});
```

Use `query.optimistic('await-fragment')` when server truth cannot be predicted safely.

## Render trusted output

Prefer a validating constructor. `safeRichHtml()` sanitizes CMS markup before minting the
framework-owned output carrier.

<!-- kovo-recipe task="trusted output" source="site/recipes/golden/trusted-output.ts" export="trustedArticleBody" -->

```ts
import { safeRichHtml } from '@kovojs/server';

export const trustedArticleBody = safeRichHtml('<p>Hello <strong>reader</strong>.</p>', {
  source: 'CMS rich-text field',
});
```

Reserve `trustedHtml()` for already reviewed renderer output and keep the reason at the call site.

## Store an object

Keep the server-minted scoped key instead of accepting a client filename.

<!-- kovo-recipe task="storage" source="site/recipes/golden/storage.ts" export="saveAvatar" -->

```ts
import { createMemoryStorage } from '@kovojs/core/storage';
import { publicScopedKey } from '@kovojs/core';

export const avatarStorage = createMemoryStorage();
export const avatarKey = publicScopedKey('avatars/current.png');

export async function saveAvatar(bytes: Uint8Array) {
  return avatarStorage.put(avatarKey, bytes, {
    contentType: 'image/png',
  });
}
```

Use memory storage in tests, filesystem locally, and a validated S3-compatible adapter in
deployment.

## Accept an upload

Cap bytes, accept a narrow media type, and store under a server-owned prefix.

<!-- kovo-recipe task="upload" source="site/recipes/golden/upload.ts" export="avatarUpload" -->

```ts
import { createMemoryStorage } from '@kovojs/core/storage';
import { s } from '@kovojs/server';

const uploads = createMemoryStorage();

export const avatarUpload = s
  .file()
  .maxBytes(2_000_000)
  .accept(['image/png'])
  .store({ keyPrefix: 'avatars', storage: uploads });
```

Put this schema in a mutation input. Kovo makes its form multipart automatically.

## Verify a webhook

Build the verifier from deployment secret material, then parse the body only after verification.

<!-- kovo-recipe task="webhook" source="site/recipes/golden/webhook.ts" export="defineOrderWebhook" -->

```ts
import { hmacSignature } from '@kovojs/core/webhooks';
import { s } from '@kovojs/server';
import { webhook } from '@kovojs/server/webhooks';

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

A webhook that writes also declares replay storage, idempotency, write domains, and principal
posture.

## Run a task

Declare durable work on the app so its input and runtime owner stay in the same graph.

<!-- kovo-recipe task="task" source="site/recipes/golden/task.ts" export="rebuildSearch" -->

```ts
import { defineKovo, s } from '@kovojs/server';

const app = defineKovo({
  appId: '7719fe41-b5b2-44c8-81da-0d8ff0ce35b0',
});

export const rebuildSearch = app.task({
  input: s.object({ index: s.string() }),
  retry: { backoff: 'exponential', maxAttempts: 4 },
  run: ({ index }) => ({ rebuilt: index }),
});
```

Add the handle to the app root's task inventory, then schedule it from a mutation through the
framework-provided request context.

## Customize the document shell

Compose the framework-owned document with structured primitives. This keeps scripts, URLs, CSP,
and shell attributes auditable.

<!-- kovo-recipe task="custom shell" source="site/recipes/golden/custom-shell.tsx" export="customShellApp" -->

```tsx
import { BodyAttrs, BodyStart, defineKovo, Document, Head, Meta } from '@kovojs/server';
import { renderRouteHtml } from '@kovojs/server/rendering';

const appDocument = Document({
  lang: 'en',
  title: 'Kovo contacts',
  children: [
    Head({ children: Meta({ content: 'width=device-width, initial-scale=1', name: 'viewport' }) }),
    BodyAttrs({ class: 'app-shell' }),
    BodyStart({ children: <a href="#main">Skip to content</a> }),
  ],
});

const app = defineKovo({
  appId: '7f55ad66-6ec7-4bd0-995c-34747b7a09dd',
  document: appDocument,
  egress: { allowInternal: [] },
  renderRoute: renderRouteHtml,
});

const homeRoute = app.route('/', {
  access: app.publicAccess('the landing page is intentionally public'),
  page: () => <main id="main">Contacts</main>,
});

export const customShellApp = app.assemble({ routes: [homeRoute] });
```

Do not replace the document with a free-form HTML template; the structured shell is the public
customization door.

## Define a theme

Seed the token system once. Components consume typed system tokens; the built stylesheet receives
deterministic light and dark values.

<!-- kovo-recipe task="theme" source="site/recipes/golden/theme.ts" export="contactTheme" -->

```ts
import { defineTheme } from '@kovojs/style';

export const contactTheme = defineTheme({
  colors: {
    success: '#047857',
  },
  seed: '#2563eb',
  shape: {
    cornerMedium: '8px',
  },
});

export const contactThemeCss = contactTheme.css;
```

Pass the theme through `stylesheet(..., { theme })`; Kovo does not add a client theme store.

## Open the app-scoped test harness

Import the opaque assembled app and point the harness at an exact successful-build artifact. The
artifact supplies graph facts; callers cannot manufacture them.

<!-- kovo-recipe task="test harness" source="site/recipes/golden/test-harness.tsx" export="createContactHarness" -->

```tsx
import { defineKovo } from '@kovojs/server';
import { renderRouteHtml } from '@kovojs/server/rendering';
import { createKovoTestHarness } from '@kovojs/test/harness';

const app = defineKovo({
  appId: '93378e19-6823-4e3b-ab23-400af6bd4748',
  egress: { allowInternal: [] },
  renderRoute: renderRouteHtml,
});

const healthRoute = app.route('/health', {
  access: app.publicAccess('the health page is intentionally visible'),
  page: () => <main>ok</main>,
});

export const harnessRecipeApp = app.assemble({ routes: [healthRoute] });

export function createContactHarness(artifact: string | URL, projectRoot: string | URL) {
  return createKovoTestHarness(harnessRecipeApp, { artifact, projectRoot });
}
```

Call `createContactHarness(new URL('../dist/.kovo/graph.json', import.meta.url), projectRoot)` after
`kovo build`. Relative, stale, partial, or wrong-app artifacts fail closed.

## Declare deploy posture

Pick a preset and state the retention the serving layer really provides.

<!-- kovo-recipe task="deploy posture" source="site/recipes/golden/deploy-posture.ts" export="deployPosture" -->

```ts
import { defineConfig, node } from '@kovojs/server/build';

export const deployPosture = defineConfig({
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

The quick gate validates the exact task set, tracked source bytes, app-facing imports, exported
symbols, and rename-drill pairs. The publish gate recompiles and executes all sixteen recipes from
fresh package tarballs.

## Check a rename

Each stale block must fail from packed types with the named diagnostic. The paired fix must compile.

### Component props

<!-- kovo-rename-drill target="component props" phase="stale" diagnostic="'text' does not exist" -->
<!-- kovo-sample: type-error -->

```tsx
// kovo-expected-error: 'text' does not exist
import { component } from '@kovojs/core';
const SaveButton = component({
  render: (props: { label: string }) => <button>{props.label}</button>,
});
SaveButton({ text: 'Save' });
```

<!-- kovo-rename-drill target="component props" phase="fix" -->

```tsx
import { component } from '@kovojs/core';
const SaveButton = component({
  render: (props: { label: string }) => <button>{props.label}</button>,
});
SaveButton({ label: 'Save' });
```

### Query results

<!-- kovo-rename-drill target="query results" phase="stale" diagnostic="Property 'name' does not exist" -->
<!-- kovo-sample: type-error -->

```ts
// kovo-expected-error: Property 'name' does not exist
import { defineKovo, s } from '@kovojs/server';
const app = defineKovo({});
const loadContact = () => ({ displayName: 'Ada' });
app.query({
  access: app.publicAccess('public rename drill'),
  output: s.object({ displayName: s.string() }),
  load: loadContact,
});
type ContactResult = Awaited<ReturnType<typeof loadContact>>;
declare const result: ContactResult;
result.name;
```

<!-- kovo-rename-drill target="query results" phase="fix" -->

```ts
import { defineKovo, s } from '@kovojs/server';
const app = defineKovo({});
const loadContact = () => ({ displayName: 'Ada' });
app.query({
  access: app.publicAccess('public rename drill'),
  output: s.object({ displayName: s.string() }),
  load: loadContact,
});
type ContactResult = Awaited<ReturnType<typeof loadContact>>;
declare const result: ContactResult;
result.displayName;
```

### Route params

<!-- kovo-rename-drill target="route params" phase="stale" diagnostic="Property 'id' does not exist" -->
<!-- kovo-sample: type-error -->

```tsx
// kovo-expected-error: Property 'id' does not exist
import { defineKovo, s } from '@kovojs/server';
const app = defineKovo({});
app.route('/contacts/:contactId', {
  access: app.publicAccess('public rename drill'),
  params: s.object({ contactId: s.string() }),
  page: ({ params }) => <main>{params.id}</main>,
});
```

<!-- kovo-rename-drill target="route params" phase="fix" -->

```tsx
import { defineKovo, s } from '@kovojs/server';
const app = defineKovo({});
app.route('/contacts/:contactId', {
  access: app.publicAccess('public rename drill'),
  params: s.object({ contactId: s.string() }),
  page: ({ params }) => <main>{params.contactId}</main>,
});
```

### Form fields

<!-- kovo-rename-drill target="form fields" phase="stale" diagnostic="Property 'fullName' does not exist" -->
<!-- kovo-sample: type-error -->

```ts
// kovo-expected-error: Property 'fullName' does not exist
import { defineKovo, s } from '@kovojs/server';
const app = defineKovo({});
app.mutation({
  access: app.publicAccess('public rename drill'),
  input: s.object({ name: s.string() }),
  handler: (input) => input.fullName,
});
```

<!-- kovo-rename-drill target="form fields" phase="fix" -->

```ts
import { defineKovo, s } from '@kovojs/server';
const app = defineKovo({});
app.mutation({
  access: app.publicAccess('public rename drill'),
  input: s.object({ name: s.string() }),
  handler: (input) => input.name,
});
```

### Mutation errors

<!-- kovo-rename-drill target="mutation errors" phase="stale" diagnostic="EMAIL_TAKEN" -->
<!-- kovo-sample: type-error -->

```ts
// kovo-expected-error: Argument of type '"EMAIL_TAKEN"'
import { defineKovo, s } from '@kovojs/server';
const app = defineKovo({});
app.mutation({
  access: app.publicAccess('public rename drill'),
  errors: { DUPLICATE_EMAIL: s.object({ email: s.string() }) },
  input: s.object({ email: s.string() }),
  handler: (_input, _request, context) => context.fail('EMAIL_TAKEN', { email: 'a@example.test' }),
});
```

<!-- kovo-rename-drill target="mutation errors" phase="fix" -->

```ts
import { defineKovo, s } from '@kovojs/server';
const app = defineKovo({});
app.mutation({
  access: app.publicAccess('public rename drill'),
  errors: { DUPLICATE_EMAIL: s.object({ email: s.string() }) },
  input: s.object({ email: s.string() }),
  handler: (_input, _request, context) =>
    context.fail('DUPLICATE_EMAIL', { email: 'a@example.test' }),
});
```

## Next

- [Build the first app](/getting-started/quickstart/) — put one recipe into a generated project.
- [Mutations & forms](/guides/mutations/) — add transactions and refresh.
- [Deployment](/guides/deployment/) — prove the platform posture behind the config.

<details>
<summary>Spec & diagnostics</summary>

Components and source-derived identity: SPEC §4.1. App contracts, routes, forms, uploads, and
webhooks: SPEC §6.2.1 and §9.1. Queries, mutations, storage, and optimism: SPEC §10.2–§10.4.
Durable tasks: SPEC §9.6. Output trust doors: SPEC §6.6. Testing: SPEC §12. Deploy-skew retention:
SPEC §14.

</details>
