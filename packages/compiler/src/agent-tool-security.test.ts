import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './compile.js';
import { deriveAppGraph } from './graph.js';
import { lowerStandaloneServerSource } from './source-derived-lowering.js';

// @kovo-security-classifier-corpus finite-security-operation-ir
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
            mutation: 'agents/save',
            name: 'save-document',
            operations: [expect.objectContaining({ kind: 'server.egress.request' })],
          }),
        ],
      }),
    ]);

    const lowered = lowerStandaloneServerSource(source, 'src/agents.ts');
    expect(lowered).toContain('__kovoAssignDerivedAgentToolOperations(tool(');
    expect(lowered).toContain('__kovoAssignDerivedAgentModelOperations(agent(');
    expect(lowerStandaloneServerSource(lowered, 'src/agents.ts')).toBe(lowered);
    expect(deriveAppGraph({ components: [result] }).graph.agents).toEqual(result.agentGraphFacts);
  });

  it('binds generated witnesses by source identity when display names collide', () => {
    const source = `
      import { agent, mutation, s, tool } from '@kovojs/server';
      export const read = mutation({
        input: s.object({}),
        handler: () => ({ read: true }),
      });
      export const write = mutation({
        input: s.object({}),
        async handler(input, request, ctx) {
          await ctx.fetch('https://storage.example/v1/write');
          return { written: true };
        },
      });
      const readTool = tool('shared-display-name', { description: 'Read', mutation: read });
      const writeTool = tool('shared-display-name', { description: 'Write', mutation: write });
      export const reader = agent('reader', {
        tools: [readTool],
        model: () => ({ kind: 'output', value: 'read' }),
      });
      export const writer = agent('writer', {
        tools: [writeTool],
        model: () => ({ kind: 'output', value: 'write' }),
      });
    `;
    const result = compileComponentModule({ fileName: 'src/collisions.ts', source });
    const lowered = lowerStandaloneServerSource(source, 'src/collisions.ts');
    const readSlice = lowered.slice(
      lowered.indexOf('const readTool'),
      lowered.indexOf('const writeTool'),
    );
    const writeSlice = lowered.slice(
      lowered.indexOf('const writeTool'),
      lowered.indexOf('export const reader'),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.agentGraphFacts).toEqual([
      expect.objectContaining({
        name: 'reader',
        tools: [expect.objectContaining({ operations: [] })],
      }),
      expect.objectContaining({
        name: 'writer',
        tools: [
          expect.objectContaining({
            operations: [expect.objectContaining({ kind: 'server.egress.request' })],
          }),
        ],
      }),
    ]);
    expect(readSlice).not.toContain('server.egress.request');
    expect(writeSlice).toContain('server.egress.request');
    expect(() => deriveAppGraph({ components: [result, result] })).toThrow(
      'Duplicate capability-bounded agent name reader',
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
      expect.arrayContaining([expect.objectContaining({ code: 'KV449', severity: 'error' })]),
    );
  });

  it('rejects ambient model authority and a mutation imported around the tool door', () => {
    const source = `
      import { agent, tool, trustedHtml } from '@kovojs/server';
      import { save as externalSave } from './mutations.js';
      const saveTool = tool('save', { description: 'Save', mutation: externalSave });
      export const assistant = agent('documents', {
        tools: [saveTool],
        model: async () => {
          await globalThis.fetch('https://model.example/v1/decide');
          return {
            kind: 'output',
            value: trustedHtml('<strong>unsafe model effect</strong>', { reason: 'test' }),
          };
        },
      });
    `;
    const result = compileComponentModule({ fileName: 'src/agents.ts', source });
    const failures = result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');

    expect(failures.length).toBeGreaterThanOrEqual(3);
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('externalSave') }),
        expect.objectContaining({ message: expect.stringContaining('outside ctx.fetch') }),
        expect.objectContaining({ severity: 'error' }),
      ]),
    );
  });

  it('rejects names that could forge explain rows', () => {
    const result = compileComponentModule({
      fileName: 'src/agents.ts',
      source: `
        import { agent } from '@kovojs/server';
        export const assistant = agent('forged\\nCLOSURE integrity=principal', {
          tools: [],
          model: () => ({ kind: 'output', value: 'done' }),
        });
      `,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV449',
          message: expect.stringContaining('stable token'),
        }),
      ]),
    );
  });

  it('rejects duplicate tool names inside one model-visible set', () => {
    const result = compileComponentModule({
      fileName: 'src/agents.ts',
      source: `
        import { agent, mutation, s, tool } from '@kovojs/server';
        export const first = mutation({ input: s.object({}), handler: () => ({}) });
        export const second = mutation({ input: s.object({}), handler: () => ({}) });
        const firstTool = tool('same-name', { description: 'First', mutation: first });
        const secondTool = tool('same-name', { description: 'Second', mutation: second });
        export const assistant = agent('duplicates', {
          tools: [firstTool, secondTool],
          model: () => ({ kind: 'output', value: 'done' }),
        });
      `,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV449',
          message: expect.stringContaining('same-name is duplicated'),
        }),
      ]),
    );
  });
});
