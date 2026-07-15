import { vi } from 'vitest';

// Better Auth's public graph is runtime-only and requires the irreversible
// bootstrap lock before evaluation (SPEC.md §6.6 rule 6). Vitest must retain
// mutable timers in its shared worker realm, so external API conformance uses a
// privileged classifier-boundary mock. Bootstrap ordering and poison resistance
// are proved separately in packed child processes.
// Mock the workspace-resolved source id, not only the package specifier: Vite
// resolves workspace exports before Vitest registers setup-file mocks.
vi.mock(
  import('../../../packages/core/src/internal/classifier-verdict.ts'),
  async (importOriginal) => {
    const original = await importOriginal();
    return {
      ...original,
      assertRequestSafeRuntimeRealmLocked: vi.fn(),
    };
  },
);
