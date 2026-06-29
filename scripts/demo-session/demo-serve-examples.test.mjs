import { afterEach, describe, expect, it } from 'vitest';

import { createCrmDemoServer } from '../../examples/crm/scripts/demo-serve.mjs';
import { createSoDemoServer } from '../../examples/stackoverflow/scripts/demo-serve.mjs';

const servedServers = [];

afterEach(async () => {
  for (const served of servedServers.splice(0)) {
    await served.close();
  }
  delete process.env.KOVO_LIVE_TARGET_SECRET;
  delete process.env.KOVO_CRM_CSRF_SECRET;
  delete process.env.KOVO_STACKOVERFLOW_CSRF_SECRET;
});

describe('hosted demo serve examples', () => {
  it('boots CRM and StackOverflow through the multitenant Vite demo path', async () => {
    process.env.KOVO_LIVE_TARGET_SECRET = 'demo-serve-test-live-target-secret';
    process.env.KOVO_CRM_CSRF_SECRET = 'demo-serve-test-crm-csrf-secret';
    process.env.KOVO_STACKOVERFLOW_CSRF_SECRET = 'demo-serve-test-stackoverflow-csrf-secret';

    const crm = await createCrmDemoServer({ host: '127.0.0.1', port: 0 });

    expect(crm.port).toBeGreaterThan(0);
    await crm.close();

    const stackoverflow = await createSoDemoServer({ host: '127.0.0.1', port: 0 });
    expect(stackoverflow.port).toBeGreaterThan(0);
    await stackoverflow.close();
  }, 120_000);
});
