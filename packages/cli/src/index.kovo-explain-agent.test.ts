import { describe, expect, it } from 'vitest';

import { parseExplainArgs } from './graph-args.js';
import { kovoExplain } from './index.js';

describe('kovo explain --agent', () => {
  it('prints the exact per-integrity effect closure', () => {
    expect(parseExplainArgs(['--agent'])).toEqual({ agent: true, ok: true });
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
                    { door: 'managed-db-read', kind: 'server.database.read', target: 'documents' },
                  ],
                  resultIntegrity: 'retrieved',
                },
                {
                  minimumIntegrity: 'principal',
                  mutation: 'documents/write',
                  name: 'write-document',
                  operations: [
                    { door: 'managed-db-write', kind: 'server.database.write', target: 'documents' },
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
      ].join('\\n'),
    });
  });
});
