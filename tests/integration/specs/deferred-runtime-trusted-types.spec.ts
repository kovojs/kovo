import { expect, test } from '@kovojs/test/internal/integration';

test.use({ kovoFixture: 'manual-touches-raw-write' });

test('default Trusted Types CSP permits the versioned deferred runtime to install', async ({
  page,
}) => {
  // C186 / SPEC §6.6: createApp's default document CSP requires TrustedHTML on Chromium. The
  // navigation-control self-witness runs during versioned runtime evaluation, before Kovo lazily
  // creates its policy, and must not reject the import back into the tiny bootstrap fallback.
  const trustedTypeViolations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes("requires 'TrustedHTML' assignment")) {
      trustedTypeViolations.push(message.text());
    }
  });
  const runtimeResponsePromise = page.waitForResponse((candidate) =>
    candidate.url().includes('/kovo-runtime.client.js'),
  );

  const documentResponse = await page.goto('/');
  const runtimeResponse = await runtimeResponsePromise;
  const csp = (await documentResponse?.allHeaders())?.['content-security-policy'];
  expect(csp).toContain("require-trusted-types-for 'script'");
  expect(csp).toContain('trusted-types kovo');
  expect(runtimeResponse.status()).toBe(200);

  // The tiny bootstrap's apply function closes over `streamQueue`; the deferred runtime replaces
  // it with the real wire-apply function only after `installKovoDeferredRuntime()` completes.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const apply = (globalThis as { __kovo_a?: (body: string) => void }).__kovo_a;
        return (
          typeof apply === 'function' &&
          !Function.prototype.toString.call(apply).includes('streamQueue')
        );
      }),
    )
    .toBe(true);
  expect(trustedTypeViolations).toEqual([]);
});
