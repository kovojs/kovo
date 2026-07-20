import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './compile.js';
import { lowerStandaloneServerSource } from './source-derived-lowering.js';

// @kovo-security-classifier-corpus agent-tool-effect-door
describe('agent tool compiler effect door', () => {
  it('derives each tool effect closure from its exact same-file mutation', () => {
    const source = `
      import { agent, mutation, s, tool } from '@kovojs/server';
      export const save = mutation({
        input: s.object({ id: s.string() }),
        async handler(input, request, ctx) {
          await ctx.fetch('https://storage.example/v1/documents/' + input.id);
          return { saved: true };
        },
      });
      export const saveTool = tool('save-document', {
        description: 'Save one document',
        mutation: save,
      });
      export const assistant = agent('documents', {
        tools: [saveTool],
        model: async (turn, ctx) => {
          await ctx.fetch('https://model.example/v1/decide');
          return { kind: 'output', value: turn.value };
        },
      });
    `;
    const result = compileComponentModule({ fileName: 'src/agents.ts', source });

    expect(result.diagnostics).toEqual([]);
    expect(result.agentGraphFacts).toEqual([
      expect.objectContaining({
        name: 'documents',
        modelOperations: [expect.objectContaining({ kind: 'server.egress.request' })],
        tools: [
          expect.objectContaining({
            minimumIntegrity: 'principal',
            mutation: 'documents/save',
            name: 'save-document',
            operations: [expect.objectContaining({ kind: 'server.egress.request' })],
          }),
        ],
      }),
    ]);

    expect(lowerStandaloneServerSource(source, 'src/agents.ts')).toContain(
      'assignDerivedAgentToolOperations(saveTool',
    );
  });

  it('fails closed for a model callback or tool list outside the finite inline door', () => {
    const source = `
      import { agent, mutation, s, tool } from '@kovojs/server';
      const model = async (turn, ctx) => ({ kind: 'output', value: turn.value });
      export const noop = mutation({
        input: s.object({}),
        handler: () => ({ ok: true }),
      });
      export const noopTool = tool('noop', { description: 'No-op', mutation: noop });
      const tools = [noopTool];
      export const assistant = agent('documents', { tools, model });
    `;
    const result = compileComponentModule({ fileName: 'src/agents.ts', source });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'KV449', severity: 'error' }),
      ]),
    );
  });
});
