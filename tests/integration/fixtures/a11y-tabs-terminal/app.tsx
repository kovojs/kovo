// SPEC §12.1: terminal tab state exposes selected tab and panel relationships.
import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const homeRoute = route('/', {
  meta: { title: 'Tabs terminal state' },
  page: () => `<main>
    <h1>Tabs terminal state</h1>
    <section aria-label="Account sections">
      <div role="tablist" aria-label="Account sections">
        <button type="button" role="tab" id="tab-profile" aria-controls="panel-profile" aria-selected="true" data-state="active" on:click="/client.ts#selectProfile">Profile</button>
        <button type="button" role="tab" id="tab-billing" aria-controls="panel-billing" aria-selected="false" data-state="inactive" on:click="/client.ts#selectBilling">Billing</button>
      </div>
      <section role="tabpanel" id="panel-profile" aria-labelledby="tab-profile">Profile details</section>
      <section role="tabpanel" id="panel-billing" aria-labelledby="tab-billing" hidden>Billing history</section>
    </section>
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
