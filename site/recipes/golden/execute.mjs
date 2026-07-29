import assert from 'node:assert/strict';

import { createSigningKeyRing, publicScopedKey } from '@kovojs/server';

import { accountRoute } from './auth.js';
import { receiptRoute } from './capability-link.js';
import { SaveButton } from './component.js';
import { deployConfig } from './deploy.js';
import { sendReceiptEmail } from './email.js';
import { healthEndpoint } from './endpoint.js';
import { invoiceDownload } from './file.js';
import { defineProfileForm } from './form.js';
import { defineCreateContact } from './mutation.js';
import { contactQuery } from './query.js';
import { articleBody } from './raw-html.js';
import { contactRoute } from './route.js';
import { avatarStorage, saveAvatar } from './storage.js';
import { rebuildSearch } from './task.js';
import { avatarUpload } from './upload.js';
import { defineOrderWebhook } from './webhook.js';

const signingKeys = createSigningKeyRing({
  keys: [
    {
      id: 'golden-recipes',
      secret: 'golden-recipe-signing-secret-at-least-32-bytes',
      state: 'active',
    },
  ],
});
const csrf = { anonymousCookie: false, secret: signingKeys, sessionId: () => undefined };

assert.equal(
  String(SaveButton.definition.render({ label: 'Save' }, undefined, {})),
  '<button type="submit">Save</button>',
);
assert.equal(contactRoute.path, '/contacts/:contactId');
assert.deepEqual(await contactQuery.load({ contactId: 'contact-1' }), {
  displayName: 'Ada Lovelace',
  id: 'contact-1',
});

const created = [];
const createContact = defineCreateContact(csrf);
await createContact.handler(
  { email: 'ada@example.test', name: 'Ada' },
  { contacts: { create: async (input) => created.push(input) } },
  undefined,
);
assert.deepEqual(created, [{ email: 'ada@example.test', name: 'Ada' }]);

const ProfileForm = defineProfileForm(csrf);
assert.equal(
  String(
    ProfileForm.definition.render({}, undefined, {
      forms: { updateProfile: { failure: null, submitted: { name: 'Ada' } } },
    }),
  ),
  '<form><input name="name" value="Ada"><input name="email" type="email"><button type="submit">Save profile</button></form>',
);

const health = await healthEndpoint.handler(new Request('https://app.example/healthz'));
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true });

assert.equal(accountRoute.path, '/account');
assert.equal(
  String(
    accountRoute.page(
      { params: {}, search: {} },
      { session: { id: 'session-1', user: { email: 'ada@example.test', id: 'user-1' } } },
    ),
  ),
  '<main>Signed in as ada@example.test</main>',
);

const avatarBytes = new Uint8Array([137, 80, 78, 71]);
await saveAvatar(avatarBytes);
const storedAvatar = await avatarStorage.get(publicScopedKey('avatars/current.png'));
assert.deepEqual(storedAvatar?.body, avatarBytes);

assert.deepEqual(rebuildSearch.run({ index: 'contacts' }, undefined), {
  rebuilt: 'contacts',
});
assert.equal(
  defineOrderWebhook('provider-webhook-secret-at-least-32-bytes').path,
  '/webhooks/orders',
);

const emailCalls = [];
const delivered = await sendReceiptEmail.run(
  { orderId: 'order-42', to: 'ada@example.test' },
  {
    fetch: async (url, init) => {
      emailCalls.push({ init, url });
      return new Response(null, { status: 202 });
    },
  },
);
assert.deepEqual(delivered, { delivered: 'ada@example.test' });
assert.equal(emailCalls[0].url, 'https://api.resend.com/emails');

assert.equal(invoiceDownload.contentDisposition, 'attachment; filename="invoice-42.csv"');
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
assert.equal(String(articleBody.value), '<p>Hello <strong>reader</strong>.</p>');

const capabilityLink = await receiptRoute.page({
  params: { receiptId: 'receipt-42' },
  search: {},
  signUrl: async ({ key }) => ({
    expiresAt: Date.now() + 300_000,
    key,
    url: '/downloads/receipt-42?token=opaque',
  }),
});
assert.equal(
  String(capabilityLink),
  '<a href="/downloads/receipt-42?token=opaque">Download receipt</a>',
);
assert.equal(Object.isFrozen(deployConfig.preset), true);

process.stdout.write('golden-recipes/v1 tasks=16 OK\n');
