// L0 platform fixture: native dialog invoker attributes are ordinary light DOM
// and need no Kovo client handler import (SPEC §4.2, §5.2).
import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

const homeRoute = route('/', {
  page: () => `<main>
    <button type="button" commandfor="account-dialog" command="show-modal">Open dialog</button>
    <dialog id="account-dialog" aria-label="Account dialog">
      <p>Account settings</p>
      <button type="button" commandfor="account-dialog" command="close">Close dialog</button>
    </dialog>
  </main>`,
});

const app = createApp({ routes: [homeRoute] });

export default defineFixture({ app });
