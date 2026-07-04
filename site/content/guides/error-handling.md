---
title: Error handling
description: Catch render failures, render the right shell, and understand how mutation, route, and request-shell failures differ.
order: 3.2
---

# Error handling

Use this page when you need to answer "what does the user actually see when this fails?" Kovo has
different paths for a query-backed region, a typed mutation failure, a route outcome, and an
unexpected request-shell exception.

## Wrap a region

Start with the smallest region-level fallback:

```text
// Source-verified shape from packages/core/src/index.ts
import { ErrorBoundary, component } from '@kovojs/core';

declare function ProductGrid(): string;
declare function ProductGridError(): string;

export const CatalogPage = component({
  render: () => <ErrorBoundary fallback={<ProductGridError />}><ProductGrid /></ErrorBoundary>,
});
```

This is the right tool when one part of the page can fail without taking down the whole document.

## Run it

Make the loader or render path throw inside that region. The boundary fallback renders in the same
spot, and the rest of the document keeps its ordinary shell.

Use route-level outcomes when the whole page should change shape instead:

```ts
import { notFound, route } from '@kovojs/server';

export const accountRoute = route('/account/:id', {
  async page({ params }) {
    if (params.id === 'missing') return notFound();
    return <main>Account</main>;
  },
});
```

## Add the production shape

Mutation failures are their own path. Expected form errors stay typed and local to the submitted
form; they are not exceptions:

```text
// Source-verified shape from packages/core/src/index.ts
import { FieldError, FormError, component } from '@kovojs/core';

declare const saveProfile: unknown;

export const ProfileForm = component({
  render: () => (
    <form mutation={saveProfile}>
      <input name="displayName" />
      <FieldError name="displayName" />
      <FormError code="DUPLICATE_NAME">That name is taken.</FormError>
    </form>
  ),
});
```

Unexpected enhanced-mutation failures use the browser runtime's response posture:

- 401 with `Kovo-Reauth` redirects through the re-auth path.
- 403 stays an authorization failure.
- 500 becomes a render error, not a fake typed form failure.

For document-level shells, configure them once on the app:

```ts
import { createApp } from '@kovojs/server';

declare const ErrorShell: any;
declare const ForbiddenShell: any;
declare const NotFoundShell: any;

export default createApp({
  errorShells: { forbidden: ForbiddenShell, notFound: NotFoundShell, serverError: ErrorShell },
});
```

## Handle failure

Choose the narrowest failure surface that matches the app:

- Use `<ErrorBoundary>` for one query-backed or render-heavy region.
- Use `context.fail(...)`, `<FieldError>`, and `<FormError>` for expected form failures.
- Use `notFound()` or a guard outcome when the whole route should change shell.
- Use app `errorShells` and `onError` for unexpected request-shell failures.

## Observe it in production

The request shell gives you one hook for unexpected exceptions:

```ts
import { createApp } from '@kovojs/server';

export default createApp({
  onError(error, context) {
    console.error('request failed', context.phase, error);
  },
});
```

Keep that hook for logging and reporting. It is not the place to invent alternate response bodies.

## Next

- [Mutations & forms](/guides/mutations/) — build the typed 422 path in detail.
- [Request shell](/guides/request-shell/) — wire document-level error shells and request hooks.

<details>
<summary>Spec & diagnostics</summary>

`ErrorBoundary`, `FieldError`, and `FormError`: `packages/core/src/index.ts` and
`packages/server/src/jsx-runtime.ts`. Route outcomes such as `notFound()`: `site/content/guides/routing.md`
and the server routing surface. App error shells and `onError`: `packages/server/src/app-types.ts`,
`packages/server/src/app.ts`, and `site/content/guides/request-shell.md`. Enhanced mutation reauth
handling lives in `packages/browser/src/mutation-fetch.ts` and the wire contract in `spec/09-wire-protocol.md`.

</details>
