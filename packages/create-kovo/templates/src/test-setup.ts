import { vi } from 'vitest';

// SPEC §6.6: generated aggregate tests intentionally instantiate the eager app graph without
// locking Vitest's shared timer/process realm. A global setup mock preserves every real verdict
// export while replacing only the bootstrap-order assertion before any app module evaluates.
// Packed child-process and production-artifact tests own the real bootstrap-first ordering proof;
// this module is referenced only by Vitest configuration and is never part of an app build.
vi.mock('@kovojs/core/internal/classifier-verdict', async (importOriginal) => ({
  ...(await importOriginal()),
  assertRequestSafeRuntimeRealmLocked: vi.fn(),
}));
