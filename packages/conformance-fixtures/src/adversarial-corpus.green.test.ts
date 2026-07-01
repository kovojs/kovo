import { describe, expect, it } from 'vitest';

import {
  stampSqlIdentifier,
  stampSqlKeyword,
  stampStaticSql,
  stampTrustedSql,
  validateSqlAllow,
  validateSqlIdentifier,
  validateManagedSqlStatement,
} from '@kovojs/core/internal/sql-safety';
import { compileComponentModule } from '../../compiler/src/index.js';

import { dec10GreenCorpusRows, type Dec10GreenSqlCase } from './adversarial-corpus.js';

describe('DEC10 green corpus', () => {
  it('produces no KV diagnostics across compiler and SQL green rows', () => {
    const findings: string[] = [];

    for (const row of dec10GreenCorpusRows()) {
      if (row.source !== undefined) {
        const result = compileComponentModule({
          fileName: `dec10/${row.dialect}/${row.id}.tsx`,
          source: row.source,
        });
        for (const diagnostic of result.diagnostics) {
          if (/^KV\d+$/u.test(diagnostic.code)) {
            findings.push(`${row.dialect}/${row.id}: unexpected ${diagnostic.code}`);
          }
        }
        continue;
      }

      if (row.statement !== undefined) {
        const result = validateManagedSqlStatement(statementForGreenSqlCase(row.statement));
        if (!result.ok) {
          findings.push(`${row.dialect}/${row.id}: ${result.message ?? 'SQL rejected'}`);
        }
        continue;
      }

      findings.push(`${row.dialect}/${row.id}: corpus row has no compiler source or SQL statement`);
    }

    expect(findings).toEqual([]);
  });
});

function statementForGreenSqlCase(statement: Dec10GreenSqlCase['statement']): unknown {
  switch (statement.kind) {
    case 'identifier':
      return stampSqlIdentifier({
        text: validateSqlIdentifier(statement.value, statement.allow),
        values: [],
      });
    case 'keyword':
      return stampSqlKeyword({
        text: validateSqlAllow(statement.value, statement.allow),
        values: [],
      });
    case 'separated-carrier':
      return { text: statement.text, values: [...statement.values] };
    case 'static-sql':
      return stampStaticSql({ text: statement.text, values: [] });
    case 'trusted-sql':
      return stampTrustedSql({ text: statement.text, values: [] }, statement.justification);
  }
}
