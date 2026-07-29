import { isKovoApp } from '@kovojs/server';
import { KovoSqliteSystemDb } from '@kovojs/server/sqlite';
import { renderWithRequestForTesting } from '@kovojs/server/testing';

export const acceptsAppLookalike = isKovoApp;
export type AcceptsSystemDb = KovoSqliteSystemDb;
export const legacyRender = renderWithRequestForTesting;
