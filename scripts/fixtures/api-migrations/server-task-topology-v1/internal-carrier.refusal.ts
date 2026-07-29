// @ts-nocheck -- migration refusal intentionally imports retired internal carriers.
import { isKovoApp, type MutationCsrfDeclaration } from '@kovojs/server';
import { KovoSqliteSystemDb } from '@kovojs/server/sqlite';
import { renderWithRequestForTesting } from '@kovojs/server/testing';

export const acceptsAppLookalike = isKovoApp;
export type AppCsrfPosture = MutationCsrfDeclaration;
export type AcceptsSystemDb = KovoSqliteSystemDb;
export const legacyRender = renderWithRequestForTesting;
