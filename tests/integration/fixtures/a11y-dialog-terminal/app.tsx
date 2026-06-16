// SPEC §12.1: terminal dialog state keeps role/name/focus semantics in light DOM.
import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

const homeRoute = route('/', {
  page: () => `<main>
    <h1>Dialog terminal state</h1>
    <button type="button" commandfor="settings-dialog" command="show-modal">Open settings</button>
    <dialog id="settings-dialog" aria-labelledby="settings-title">
      <h2 id="settings-title">Account settings</h2>
      <p>Review account preferences.</p>
      <button type="button" autofocus commandfor="settings-dialog" command="close">Close settings</button>
    </dialog>
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
