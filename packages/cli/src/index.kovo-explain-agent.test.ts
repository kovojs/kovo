import { describe, expect, it } from 'vitest';

import { parseExplainArgs } from './graph-args.js';
import { kovoExplain } from './index.js';

// @kovo-security-classifier-corpus finite-security-operation-ir
describe('kovo explain --agent', () => {
  it('prints the exact per-integrity effect closure', () => {
    expect(parseExplainArgs(['--agent'])).toEqual({
      inputPath: undefined,
      ok: true,
      options: { agent: true },
    });
    expect(
      kovoExplain(
        {
          agents: [
            {
              modelOperations: [
                { door: 'ctx.fetch', kind: 'server.egress.request', target: 'model.example' },
              ],
              name: 'documents',
              tools: [
                {
                  minimumIntegrity: 'retrieved',
                  mutation: 'documents/read',
                  name: 'read-document',
                  operations: [
                    { door: 'managed-db', kind: 'server.database.read', target: 'documents' },
                  ],
                  resultIntegrity: 'retrieved',
                },
                {
                  minimumIntegrity: 'principal',
                  mutation: 'documents/write',
                  name: 'write-document',
                  operations: [
                    { door: 'managed-db', kind: 'server.database.write', target: 'documents' },
                  ],
                  resultIntegrity: 'untrusted',
                },
              ],
            },
          ],
        },
        { agent: true },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-explain/v1',
        'AGENT documents model-effects=server.egress.request',
        'TOOL read-document mutation=documents/read minimum-integrity=retrieved result-integrity=retrieved effects=server.database.read',
        'TOOL write-document mutation=documents/write minimum-integrity=principal result-integrity=untrusted effects=server.database.write',
        'CLOSURE integrity=principal tools=read-document,write-document effects=server.database.read,server.database.write,server.egress.request',
        'CLOSURE integrity=validated tools=read-document effects=server.database.read,server.egress.request',
        'CLOSURE integrity=retrieved tools=read-document effects=server.database.read,server.egress.request',
        'CLOSURE integrity=untrusted tools=- effects=server.egress.request',
        '',
      ].join('\n'),
    });
  });

  it('fails closed when redundant graph metadata disagrees with the finite operations', () => {
    expect(
      kovoExplain(
        {
          agents: [
            {
              modelOperations: [],
              name: 'tampered',
              tools: [
                {
                  minimumIntegrity: 'untrusted',
                  mutation: 'documents/write',
                  name: 'write',
                  operations: [
                    { door: 'managed-db', kind: 'server.database.write', target: 'documents' },
                  ],
                  resultIntegrity: 'untrusted',
                },
              ],
            },
          ],
        },
        { agent: true },
      ),
    ).toMatchObject({
      exitCode: 1,
      output: expect.stringContaining('minimum integrity must be principal'),
    });
  });
});
