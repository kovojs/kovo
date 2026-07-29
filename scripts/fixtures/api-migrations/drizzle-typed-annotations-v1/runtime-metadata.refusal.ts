// @ts-nocheck -- migration refusal intentionally imports retired app-public metadata.
import {
  extractKovoRuntimeDbMetadata,
  type KovoRuntimeAuthorizationClassification,
  type KovoRuntimeDbColumnSource,
  type KovoRuntimeDbMetadata,
  type KovoRuntimeDbTable,
  type KovoRuntimeKeySource,
  type KovoRuntimeOwnerSource,
  type KovoRuntimeOwnerViaSource,
} from '@kovojs/drizzle';

export type RetiredRuntimeMetadata =
  | KovoRuntimeAuthorizationClassification
  | KovoRuntimeDbColumnSource
  | KovoRuntimeDbMetadata
  | KovoRuntimeDbTable
  | KovoRuntimeKeySource
  | KovoRuntimeOwnerSource
  | KovoRuntimeOwnerViaSource;

void extractKovoRuntimeDbMetadata;
