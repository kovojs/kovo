// L0 platform fixture: native popover IDREF wiring remains light DOM and works
// without Kovo client handler imports (SPEC §4.6, §7).
import { createApp, publicAccess, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>
    <button type="button" popovertarget="account-popover" popovertargetaction="toggle">
      Toggle account menu
    </button>
    <section id="account-popover" popover="auto" aria-label="Account menu">
      <p>Account actions</p>
    </section>
  </main>`,
});

const app = createApp({ routes: [homeRoute] });

export default defineFixture({ app });
