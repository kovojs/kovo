// SPEC §12.1: terminal menu state exposes expanded trigger and active menu item.
import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

const homeRoute = route('/', {
  page: () => `<main>
    <h1>Menu terminal state</h1>
    <button type="button" id="menu-trigger" aria-haspopup="menu" aria-expanded="false" aria-controls="account-menu" on:click="/client.ts#openMenu">Account actions</button>
    <div role="menu" id="account-menu" aria-labelledby="menu-trigger" hidden>
      <button type="button" role="menuitem" data-state="active">View profile</button>
      <button type="button" role="menuitem" data-state="inactive">Sign out</button>
    </div>
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
