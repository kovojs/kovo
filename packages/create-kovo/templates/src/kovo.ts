import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/client-modules';
import { defineKovo, stylesheet } from '@kovojs/server';

import {
  appRuntimeDbProvider,
  appRuntimeMutationReplayStore,
  appRuntimePrincipalEpochStore,
} from './_kovo/app-runtime-db.js';
import { appCsrf, appSessionProvider } from './auth.js';
import { appTheme } from './theme.js';

/** The starter's one app-scoped authoring contract (SPEC §6.2.1/§9.5). */
export const app = defineKovo({
  appId: '{{app_id}}',
  auth: appSessionProvider,
  clientModules: createMemoryVersionedClientModuleRegistry(),
  csrf: appCsrf,
  db: appRuntimeDbProvider,
  document: { lang: 'en' },
  mutationReplayStore: appRuntimeMutationReplayStore,
  principalEpochStore: appRuntimePrincipalEpochStore,
});

/** Shared authored assets carried by each document route. */
export const appStylesheets = [stylesheet('./styles.css', { theme: appTheme })] as const;
