// L0 platform fixture: native details/summary disclosure works as light DOM with
// no Kovo client handler (SPEC §7).
import { createApp, publicAccess, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>
    <details>
      <summary>Shipping details</summary>
      <p>Ships in two business days.</p>
    </details>
  </main>`,
});

const app = createApp({ routes: [homeRoute] });

export default defineFixture({ app });
