---
title: File uploads & storage
description: Accept a file from a form, store it, and serve it back with a scoped download URL.
order: 2.2
---

# File uploads & storage

Use this when a browser form needs to accept bytes that should stay on the server: avatars,
receipts, imports, or support attachments. Reach for a mutation with `s.file()` when the upload is
part of a normal app workflow. Reach for a raw endpoint only when the client cannot be a form.

## Accept a file

Start with the field and let the mutation own the upload:

```ts
import { mutation, publicAccess, s } from '@kovojs/server';
declare const avatarStorage: any;
export const uploadAvatar = mutation({
  access: publicAccess('signed-in users can upload an avatar'),
  input: s.object({
    avatar: s.file().maxBytes(2_000_000).accept(['image/png']).store({ storage: avatarStorage }),
  }),
  async handler({ avatar }) {
    return { key: avatar.key };
  },
});
```

That one field does three jobs:

- It switches the form to multipart upload mode.
- It checks the size and the verified content type.
- It stores the bytes under a server-minted key instead of trusting the filename.

Render it as a normal form:

```tsx
import { component } from '@kovojs/core';

declare const uploadAvatar: unknown;

export const AvatarForm = component({
  render: () => (
    <form mutation={uploadAvatar}>
      <input name="avatar" type="file" accept="image/png" />
      <button type="submit">Upload avatar</button>
    </form>
  ),
});
```

The served HTML stays a real multipart form:

```html
<form method="post" action="/_m/upload/avatar" enctype="multipart/form-data">
  <input name="avatar" type="file" accept="image/png" />
  <button type="submit">Upload avatar</button>
</form>
```

## Run it

Use a filesystem store in local development so you can see the bytes land:

```text
// Source-verified shape from packages/core/src/storage.ts
import { createFileSystemStorage } from '@kovojs/server';

export const avatarStorage = createFileSystemStorage({
  root: '.kovo/storage',
});
```

Upload a file, then check the storage directory:

```sh
ls -R .kovo/storage
```

You should see a server-minted key under the `avatars/` prefix, not the original client filename.

## Add the production shape

The storage capability is the swap point:

```text
// Source-verified shape from packages/core/src/storage.ts
import {
  createFileSystemStorage,
  createMemoryStorage,
  createS3CompatibleStorage,
} from '@kovojs/server';

declare const s3Client: any;

export const devStorage = createFileSystemStorage({ root: '.kovo/storage' });
export const testStorage = createMemoryStorage();
export const prodStorage = createS3CompatibleStorage({
  bucket: 'app-uploads',
  client: s3Client,
  prefix: 'avatars',
});
```

Use the filesystem adapter in local dev, the memory adapter in tests, and the S3-compatible
adapter in deployed apps.

To serve the file back, mount a storage download endpoint and mint the URL from request context:

```ts
import { createStorageDownloadEndpoint, route } from '@kovojs/server';

declare const avatarStorage: any;

export const avatarDownloads = createStorageDownloadEndpoint({
  basePath: '/downloads/avatars',
  secret: process.env.KOVO_CSRF_SECRET!,
  storage: avatarStorage,
});

export const profileRoute = route('/account/avatar', {
  page: async ({ signUrl }) => {
    const signed = await signUrl!({ key: 'avatars/example.png', expiresIn: 60_000 });
    return <a href={signed.url}>Download avatar</a>;
  },
});
```

This is the important boundary. You do not hand out raw bucket paths or disk paths. The app mints
a short-lived bearer URL, and the framework verifies it before the storage read happens.

## Limit it

Keep the file checks close to the field:

- `s.file().maxBytes(...)` caps the upload size at the schema.
- `accept([...])` checks the verified content type.
- `keyPrefix` lets you namespace objects without trusting client-controlled names.

The request shell still owns the coarse body limit. If your app uses a small global
`requestLimits.maxBodyBytes`, the file schema can raise the effective limit for that mutation up to
the file field's declared max size.

## Handle failure

When the upload is too large or the content type is wrong, the mutation returns the same typed 422
path as any other form validation failure. That means the no-JS path re-renders the form and the
enhanced path patches the form in place.

Storage failures are not converted into form validation. If `storage.put(...)` throws, the
mutation fails loudly and you should treat it like an operational error: log it, show a generic
retry message, and keep the object key out of user-visible copy.

## Next

- [Mutations & forms](/guides/mutations/) — add guards, redirects, and typed form errors.
- [Security](/guides/security/) — review capability URLs and the download surface.

<details>
<summary>Spec & diagnostics</summary>

File fields and stored uploads: `packages/server/src/schema.ts` (`s.file()`, `.accept(...)`,
`.store(...)`). Storage adapters: `packages/core/src/storage.ts`, re-exported from
`packages/server/src/index.ts`. Download endpoint and `ctx.signUrl(...)` mint:
`packages/server/src/capability-route.ts`. Request-shell body limits: `packages/server/src/app.ts`
and `packages/server/src/app-load-shed.ts`. The server-minted opaque-key contract and verified file
type path are the main diagnostics behind KV428.

</details>
