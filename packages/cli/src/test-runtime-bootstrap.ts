import { vi } from 'vitest';

// Vitest must retain mutable timer/global controls in its worker realm, so it cannot install Kovo's
// irreversible deployment lock. This non-deployable test runner replaces only the assertion at
// the classifier boundary; bootstrap ordering and poison resistance remain proved in isolated
// runtime/build processes (SPEC §6.6 rule 6, §12).
vi.mock(import('@kovojs/core/internal/classifier-verdict'), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    assertRequestSafeRuntimeRealmLocked: vi.fn(),
  };
});

// Install and seal the managed SQL parser before an authored test can import the server root.
import '@kovojs/server/internal/sql-parser-authority-bootstrap';

export {};
