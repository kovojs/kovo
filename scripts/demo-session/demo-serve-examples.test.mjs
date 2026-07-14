import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCrmDemoServer } from '../../examples/crm/scripts/demo-serve.mjs';
import { createSoDemoServer } from '../../examples/stackoverflow/scripts/demo-serve.mjs';

beforeEach(() => {
  process.env.KOVO_LIVE_TARGET_SECRET = 'demo-serve-test-live-target-secret';
  process.env.KOVO_CRM_CSRF_SECRET = 'demo-serve-test-crm-csrf-secret';
  process.env.KOVO_STACKOVERFLOW_CSRF_SECRET = 'demo-serve-test-stackoverflow-csrf-secret';
});

afterEach(() => {
  delete process.env.KOVO_LIVE_TARGET_SECRET;
  delete process.env.KOVO_CRM_CSRF_SECRET;
  delete process.env.KOVO_STACKOVERFLOW_CSRF_SECRET;
});

describe('hosted demo serve examples', () => {
  it('boots CRM through the multitenant Vite demo path', async () => {
    const crm = await createCrmDemoServer({ host: '127.0.0.1', port: 0 });
    try {
      expect(crm.port).toBeGreaterThan(0);
    } finally {
      await crm.close();
    }
  }, 180_000);

  it('boots StackOverflow through the multitenant Vite demo path', async () => {
    const stackoverflow = await createSoDemoServer({ host: '127.0.0.1', port: 0 });
    try {
      expect(stackoverflow.port).toBeGreaterThan(0);
    } finally {
      await stackoverflow.close();
    }
  }, 180_000);
});
