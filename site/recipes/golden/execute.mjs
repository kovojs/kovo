import '@kovojs/server/runtime-bootstrap';

import assert from 'node:assert/strict';

import { createRequestHandler } from '@kovojs/server/custom-adapters';
import { renderRouteHtml } from '@kovojs/server/rendering';

import { accountRoute, authRecipeApp } from './auth.js';
import { saveButtonPreview } from './component.js';
import { customShellApp } from './custom-shell.js';
import { deployPosture } from './deploy-posture.js';
import { updateProfile } from './form-error.js';
import { addItem, predictCartCount } from './inline-optimism.js';
import { createContact } from './mutation.js';
import { contactQuery } from './query.js';
import { contactRoute, routeRecipeApp } from './route.js';
import { avatarKey, avatarStorage, saveAvatar } from './storage.js';
import { rebuildSearch } from './task.js';
import { createContactHarness } from './test-harness.js';
import { contactThemeCss } from './theme.js';
import { trustedArticleBody } from './trusted-output.js';
import { avatarUpload } from './upload.js';
import { defineOrderWebhook } from './webhook.js';

assert.equal(renderRouteHtml(await saveButtonPreview()), '<button type="submit">Save</button>');

assert.equal(contactRoute.path, '/contacts/:contactId');
const routeResponse = await createRequestHandler(routeRecipeApp)(
  new Request('https://app.example.test/contacts/contact-1'),
);
assert.equal(routeResponse.status, 200);
assert.match(await routeResponse.text(), /Contact contact-1/u);

assert.deepEqual(await contactQuery.load({ contactId: 'contact-1' }), {
  displayName: 'Ada Lovelace',
  id: 'contact-1',
});

assert.deepEqual(
  await createContact.handler({ email: 'ada@example.test', name: 'Ada' }, undefined, undefined),
  { created: 'ada@example.test', name: 'Ada' },
);

const profileFailure = await updateProfile.handler(
  { email: 'taken@example.test', name: 'Ada' },
  undefined,
  {
    fail: (code, payload) => ({ error: { code, payload }, ok: false }),
  },
);
assert.deepEqual(profileFailure, {
  error: { code: 'EMAIL_TAKEN', payload: { email: 'taken@example.test' } },
  ok: false,
});

assert.equal(accountRoute.path, '/account');
const authResponse = await createRequestHandler(authRecipeApp)(
  new Request('https://app.example.test/account'),
);
assert.equal(authResponse.status, 200);
assert.match(await authResponse.text(), /Signed in as ada@example\.test/u);

assert.deepEqual(predictCartCount({ count: 1 }, { quantity: 2 }), { count: 3 });
assert.deepEqual(await addItem.handler({ quantity: 2 }, undefined, undefined), { quantity: 2 });

assert.equal(String(trustedArticleBody.value), '<p>Hello <strong>reader</strong>.</p>');

const avatarBytes = new Uint8Array([137, 80, 78, 71]);
await saveAvatar(avatarBytes);
const storedAvatar = await avatarStorage.get(avatarKey);
assert.deepEqual(storedAvatar?.body, avatarBytes);

const uploadedAvatar = await avatarUpload.parseAsync(
  new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02])],
    'avatar.png',
    { type: 'image/png' },
  ),
);
assert.equal(uploadedAvatar.storage.contentType, 'image/png');
assert.equal(uploadedAvatar.storage.metadata.filename, 'avatar.png');
assert.match(uploadedAvatar.storage.key, /^avatars\//u);

assert.equal(
  defineOrderWebhook('provider-webhook-secret-at-least-32-bytes').path,
  '/webhooks/orders',
);

assert.deepEqual(rebuildSearch.run({ index: 'contacts' }, undefined), {
  rebuilt: 'contacts',
});

const shellResponse = await createRequestHandler(customShellApp)(
  new Request('https://app.example.test/'),
);
assert.equal(shellResponse.status, 200);
const shellHtml = await shellResponse.text();
assert.match(shellHtml, /<body class="app-shell">/u);
assert.match(shellHtml, /<a href="#main">Skip to content<\/a>/u);
assert.match(shellHtml, /<main id="main">Contacts<\/main>/u);

assert.match(contactThemeCss, /--kovo-theme-sys-color-primary/u);

await assert.rejects(
  createContactHarness('relative-graph.json', new URL('.', import.meta.url)),
  /absolute/u,
);

assert.equal(Object.isFrozen(deployPosture.preset), true);

process.stdout.write('golden-recipes/v1 tasks=16 OK\n');
