import { createKovoTestHarness } from '@kovojs/test/harness';
import { createPostgresTestRuntime } from '@kovojs/test/postgres';

import { crmApp } from './interactive-app.js';
import { resetCrmDatabase } from './kovo.js';
import { CRM_DEMO_USER_ID } from './model.js';
import { contactListQuery } from './queries.js';
import * as schema from './schema.js';

/**
 * Run one real app-inferred assertion against the exact CRM build artifact.
 *
 * The app supplies the compile-time DB/query/request contracts; the artifact supplies runtime
 * read/touch facts after its completion token, source set, config set, lockfile, posture, and app
 * identity have been verified (SPEC §§5.2.4, 12).
 */
export async function assertBuiltCrmContactList() {
  const db = await resetCrmDatabase('app-scoped-harness-example');
  const harness = await createKovoTestHarness(crmApp, {
    artifact: new URL('../dist/.kovo/graph.json', import.meta.url),
    db,
    projectRoot: new URL('../', import.meta.url),
    request: {
      session: {
        id: 'app-scoped-harness-example',
        user: { id: CRM_DEMO_USER_ID, roles: ['sales'] },
      },
    },
    verification: {
      domainByTable: {
        activities: 'activity',
        contacts: 'contact',
        deals: 'deal',
      },
    },
  });

  const result = await harness.query(contactListQuery);
  if (
    result.items.length < 2 ||
    result.items.some((contact) => contact.ownerId !== CRM_DEMO_USER_ID)
  ) {
    throw new Error('CRM harness did not return the seeded owner-scoped contact list.');
  }
  return result;
}

/** Canonical RLS-test helper for CRM schema tests that need owner/admin/system postures. */
export function createCrmPostgresTestRuntime() {
  return createPostgresTestRuntime({ schema });
}
