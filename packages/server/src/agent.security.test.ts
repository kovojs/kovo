import { describe, expect, it, vi } from 'vitest';

import type { ServerSecurityOperationFact } from '@kovojs/core/internal/security-operation-ir';

import { guards } from './guards.js';
import { assignDerivedAgentToolOperations } from './internal/wire.js';
import { mutation } from './mutation.js';
import { s } from './schema.js';
import {
  agent,
  agentContent,
  createAgentSession,
  runAgentTurn,
  tool,
} from './agent.js';

// @kovo-security-classifier-corpus agent-tool-effect-door
describe('capability-bounded agent mediation', () => {
  const readOperation = {
    door: 'managed-db-read',
    kind: 'server.database.read',
    target: 'documents',
  } satisfies ServerSecurityOperationFact;
  const writeOperation = {
    door: 'managed-db-write',
    kind: 'server.database.write',
    target: 'documents',
  } satisfies ServerSecurityOperationFact;

  it('offers only effects authorized by the monotonically attenuated session integrity', async () => {
    const calls: string[] = [];
    const read = mutation('documents/read', {
      input: s.object({ id: s.string() }),
      handler(input) {
        calls.push(`read:${input.id}`);
        return { body: 'retrieved text' };
      },
    });
    const write = mutation('documents/write', {
      input: s.object({ id: s.string() }),
      handler(input) {
        calls.push(`write:${input.id}`);
        return { saved: true };
      },
    });
    const readTool = assignDerivedAgentToolOperations(
      tool('read-document', {
        description: 'Read one document',
        mutation: read,
        resultIntegrity: 'retrieved',
      }),
      [readOperation],
    );
    const writeTool = assignDerivedAgentToolOperations(
      tool('write-document', {
        description: 'Write one document',
        mutation: write,
      }),
      [writeOperation],
    );
    const observedTools: string[][] = [];
    const assistant = agent('documents', {
      tools: [readTool, writeTool],
      model(turn, context) {
        observedTools.push(context.tools.map((item) => item.name));
        return turn.value === 'read'
          ? { kind: 'tool-call', tool: 'read-document', input: { id: 'one' } }
          : { kind: 'tool-call', tool: 'write-document', input: { id: 'two' } };
      },
    });
    const session = await createAgentSession(assistant, {
      request: {},
      sessionProvider: () => ({ user: { id: 'member-1' } }),
    });

    const first = await runAgentTurn(session, agentContent('read', 'principal'));
    expect(first).toMatchObject({ integrity: 'retrieved', kind: 'tool-result', tool: 'read-document' });
    expect(observedTools[0]).toEqual(['read-document', 'write-document']);

    await expect(runAgentTurn(session, agentContent('write', 'validated'))).rejects.toThrow(
      'not available at integrity retrieved',
    );
    expect(observedTools[1]).toEqual(['read-document']);
    expect(calls).toEqual(['read:one']);
  });

  it('runs the selected mutation through its ordinary guard with the pinned invoking principal', async () => {
    const handler = vi.fn(() => ({ saved: true }));
    const guarded = mutation('documents/guarded-write', {
      input: s.object({ id: s.string() }),
      guard: guards.role('editor'),
      handler,
    });
    const guardedTool = assignDerivedAgentToolOperations(
      tool('guarded-write', { description: 'Guarded write', mutation: guarded }),
      [writeOperation],
    );
    const assistant = agent('guarded', {
      tools: [guardedTool],
      model: () => ({ kind: 'tool-call', tool: 'guarded-write', input: { id: 'one' } }),
    });
    const mutableSession = { user: { id: 'member-1', role: 'viewer', roles: ['viewer'] } };
    const session = await createAgentSession(assistant, {
      request: {},
      sessionProvider: () => mutableSession,
    });
    mutableSession.user.roles = ['editor'];

    const result = await runAgentTurn(session, agentContent('write', 'principal'));
    expect(result).toMatchObject({
      kind: 'tool-result',
      result: { error: { code: 'FORBIDDEN' }, ok: false, status: 403 },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects an ambient structural principal instead of turning it into service authority', async () => {
    const noop = mutation('documents/noop', {
      input: s.object({}),
      handler: () => ({ ok: true }),
    });
    const noopTool = assignDerivedAgentToolOperations(
      tool('noop', { description: 'No-op', mutation: noop }),
      [],
    );
    const assistant = agent('no-ambient-principal', {
      tools: [noopTool],
      model: () => ({ kind: 'output', value: 'done' }),
    });

    await expect(
      createAgentSession(assistant, {
        request: { session: { user: { id: 'forged-service' } } },
      }),
    ).rejects.toThrow('framework session provider');
  });
});
