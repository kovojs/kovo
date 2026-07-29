import { describe, expect, it } from 'vitest';

import { parseAuditArgs, parseCheckArgs, parseExplainArgs } from './graph-output.js';

describe('graph command argv parsing', () => {
  it('parses check/audit/explain through the shared command argv specs', () => {
    expect(parseCheckArgs(['coverage', 'graph.json', '--format=json'])).toEqual({
      artifact: false,
      family: 'coverage',
      format: 'json',
      inputPath: 'graph.json',
      ok: true,
    });

    expect(parseAuditArgs(['--fail-on-findings', 'graph.json'])).toEqual({
      failOnFindings: true,
      inputPath: 'graph.json',
      ok: true,
    });

    expect(parseExplainArgs(['tasks', 'graph.json', '--format=github'])).toEqual({
      artifact: false,
      format: 'github',
      inputPath: 'graph.json',
      ok: true,
      options: { view: 'tasks' },
    });
  });

  it('rejects unknown and boolean equals options consistently', () => {
    expect(parseAuditArgs(['--fail-on-findings=false'])).toEqual({
      message:
        'kovo: unknown audit option "--fail-on-findings=false".\nusage: kovo audit [--fail-on-findings] [graph.json]',
      ok: false,
    });
    expect(parseExplainArgs(['--tasks=yes'])).toEqual({
      message: expect.stringContaining('kovo: unknown explain option "--tasks=yes".'),
      ok: false,
    });
  });
});
