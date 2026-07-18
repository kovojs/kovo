import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { browserSuiteAcceptance } from './tests/browser-acceptance.mjs';

export default defineConfig({
  plugins: [
    {
      name: 'kovo-browser-frame-fixture',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          // The opaque-origin sandbox probe imports the real modular browser guard. Let that
          // null-origin document fetch Vite's transformed module graph; authority is still denied
          // by the guard under test, not by an earlier CORS transport failure.
          response.setHeader('Access-Control-Allow-Origin', '*');
          if (request.url?.startsWith('/safe/account')) {
            response.statusCode = 200;
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(
              `<!doctype html><script>parent.postMessage({ type: 'kovo:safe-account' }, '*');</script>`,
            );
            return;
          }
          if (!request.url?.startsWith('/__kovo_inline_security_fixture')) {
            next();
            return;
          }
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          const fixtureUrl = new URL(request.url, 'http://localhost');
          if (fixtureUrl.searchParams.has('sandbox-origin-probe')) {
            response.end(`<!doctype html><html><head>
              <link data-kovo-module-allowlist="/c/allowed.js">
            </head><body>
              <form data-mutation="delete" action="/_m/delete" method="post"><button>delete</button></form>
              <a id="account" href="/account">account</a>
              <button id="handler" on:click="/c/allowed.js#run">handler</button>
              <script>
                addEventListener('message', (message) => {
                  const data = message.data;
                  if (!data || data.type !== 'kovo:sandbox-origin-probe') return;
                  let fetchCalls = 0;
                  let importCalls = 0;
                  globalThis.fetch = () => {
                    fetchCalls += 1;
                    return new Promise(() => {});
                  };
                  globalThis.__kovoSandboxImport = () => {
                    importCalls += 1;
                    return Promise.resolve({ run() {} });
                  };
                  globalThis.requestAnimationFrame = () => 1;
                  try {
                    if (data.mode === 'module') {
                      import('/packages/browser/src/dynamic-import-url.ts').then((module) => {
                        const moduleAllowed = module.isAllowedKovoDynamicImportUrl(
                          '/c/allowed.js',
                          { allowedModuleUrls: ['/c/allowed.js'] },
                        );
                        parent.postMessage({
                          effectiveOrigin: globalThis.origin,
                          id: data.id,
                          locationOrigin: location.origin,
                          moduleAllowed,
                          type: 'kovo:sandbox-origin-result',
                        }, '*');
                      }, (error) => {
                        parent.postMessage({
                          error: String(error && error.message || error),
                          id: data.id,
                          type: 'kovo:sandbox-origin-result',
                        }, '*');
                      });
                      return;
                    }
                    if (data.mode === 'module-form') {
                      import('/packages/browser/src/mutation-form.ts').then((module) => {
                        const form = document.querySelector('form');
                        form.setAttribute('action', 'http://localhost/_m/delete');
                        const transportAllowed =
                          module.readEligibleEnhancedMutationTransport(form) !== undefined;
                        parent.postMessage({
                          effectiveOrigin: globalThis.origin,
                          fetchCalls,
                          id: data.id,
                          locationOrigin: location.origin,
                          transportAllowed,
                          type: 'kovo:sandbox-origin-result',
                        }, '*');
                      }, (error) => {
                        parent.postMessage({
                          error: String(error && error.message || error),
                          id: data.id,
                          type: 'kovo:sandbox-origin-result',
                        }, '*');
                      });
                      return;
                    }
                    if (data.mode === 'paint') {
                      (0, eval)('(' + data.source + ")('/c/runtime.js',globalThis.__kovoSandboxImport);");
                    } else {
                      (0, eval)('(' + data.source + ')(globalThis.__kovoSandboxImport);');
                    }
                    const form = document.querySelector('form');
                    let submitPrevented;
                    form.addEventListener('submit', (event) => {
                      // Kovo's capture listener has already made its decision by the target phase.
                      // Snapshot that verdict, then cancel only the fixture's native navigation.
                      submitPrevented = event.defaultPrevented;
                      event.preventDefault();
                    }, { once: true });
                    const submit = new SubmitEvent('submit', { bubbles: true, cancelable: true });
                    form.dispatchEvent(submit);
                    const anchor = document.querySelector('#account');
                    let clickPrevented;
                    anchor.addEventListener('click', (event) => {
                      clickPrevented = event.defaultPrevented;
                      event.preventDefault();
                    }, { once: true });
                    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
                    anchor.dispatchEvent(click);
                    if (data.mode !== 'paint') {
                      document.querySelector('#handler').dispatchEvent(
                        new MouseEvent('click', { bubbles: true, cancelable: true }),
                      );
                    }
                    setTimeout(() => {
                      parent.postMessage({
                        clickPrevented,
                        effectiveOrigin: globalThis.origin,
                        fetchCalls,
                        id: data.id,
                        importCalls,
                        locationOrigin: location.origin,
                        submitPrevented,
                        type: 'kovo:sandbox-origin-result',
                      }, '*');
                    }, 0);
                  } catch (error) {
                    parent.postMessage({
                      error: String(error && error.message || error),
                      id: data.id,
                      type: 'kovo:sandbox-origin-result',
                    }, '*');
                  }
                });
              </script>
            </body></html>`);
            return;
          }
          response.end('<!doctype html><html><head></head><body></body></html>');
        });
      },
    },
  ],
  test: {
    browser: {
      enabled: true,
      headless: browserSuiteAcceptance.headless,
      instances: browserSuiteAcceptance.browsers.map((browser) => ({
        browser: browser as 'chromium' | 'firefox' | 'webkit',
      })),
      provider: playwright(),
    },
    include: browserSuiteAcceptance.include,
  },
});
