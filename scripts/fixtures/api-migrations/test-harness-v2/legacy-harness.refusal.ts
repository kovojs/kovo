// @ts-nocheck -- migration refusal intentionally imports the retired test harness surface.
import {
  createKovoTestHarness,
  type HarnessPageFixture,
  type KovoTestTouchGraph,
} from '@kovojs/test/harness';
import { kovoTest } from '@kovojs/test/test-case';

declare const db: unknown;
declare const pages: Record<string, HarnessPageFixture>;
declare const touchGraph: KovoTestTouchGraph;

export const legacyHarness = createKovoTestHarness({ db, pages, touchGraph });
export const legacyTest = kovoTest;
