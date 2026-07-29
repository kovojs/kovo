import {
  agent,
  mutation,
  publicScopedKey,
  runCommand,
  trustedHtml,
  type Reader,
  type Writer,
} from '@kovojs/server';
import {
  createPostgresTestRuntime,
  type KovoPostgresTestAdminDb,
  type KovoPostgresTestDb,
  type KovoPostgresTestRuntime,
  type KovoPostgresTestRuntimeOptions,
  type KovoPostgresTestSystemDb,
  mutationCsrfTokenForTesting,
} from '@kovojs/server/testing';

export { redirect, task, type TaskDefinition } from '@kovojs/server';

void [agent, mutation, publicScopedKey, runCommand, trustedHtml];
void [createPostgresTestRuntime, mutationCsrfTokenForTesting];
declare const testDb: KovoPostgresTestDb;
declare const testAdminDb: KovoPostgresTestAdminDb;
declare const testSystemDb: KovoPostgresTestSystemDb;
declare const testRuntime: KovoPostgresTestRuntime;
declare const testRuntimeOptions: KovoPostgresTestRuntimeOptions;
declare const reader: Reader<{ select(): unknown }>;
declare const writer: Writer<{ insert(): unknown }>;
void [reader, testAdminDb, testDb, testRuntime, testRuntimeOptions, testSystemDb, writer];
