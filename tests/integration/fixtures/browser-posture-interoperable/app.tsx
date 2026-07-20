/** @jsxImportSource @kovojs/server */
import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const home = route('/', {
  page: () => (
    <main>
      <h1>Interoperable browser posture</h1>
      <a href="/oauth-callback" target="_blank" rel="noopener">
        Open OAuth fixture
      </a>
      <iframe
        srcdoc="<main>Embedded fixture</main>"
        sandbox="allow-same-origin"
        title="Embed fixture"
      />
    </main>
  ),
});

const oauthCallback = route('/oauth-callback', {
  page: () => <main>OAuth callback fixture</main>,
});

export default defineFixture({
  app: createApp({ routes: [home, oauthCallback] }),
});
