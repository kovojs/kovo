import { staticSql } from '@kovojs/test/internal/integration/fixture-abi';
import { domain, query, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface SubmissionReport {
  includeGift: boolean;
  intent: 'confirm' | 'preview' | null;
  quantity: number | null;
}

export const submissionDomain = domain('enhancedSubmitLog');

async function readLatestSubmission(db: KovoFixtureRequest['db']): Promise<SubmissionReport> {
  const rows = await db.query<{
    include_gift: number;
    intent: 'confirm' | 'preview';
    quantity: number;
  }>(
    staticSql`select quantity, include_gift, intent from enhanced_submit_log order by id desc limit 1`,
  );
  const row = rows[0];
  return row
    ? {
        includeGift: row.include_gift === 1,
        intent: row.intent,
        quantity: Number(row.quantity),
      }
    : { includeGift: false, intent: null, quantity: null };
}

export const submissionQuery = query('enhancedSubmitReport', {
  reads: [submissionDomain],
  load: (
    _input: unknown,
    context?: QueryLoadContext<KovoFixtureRequest>,
  ): Promise<SubmissionReport> => {
    const db = context?.request?.db;
    if (!db) throw new Error('enhanced submit report query requires request.db');
    return readLatestSubmission(db);
  },
});
