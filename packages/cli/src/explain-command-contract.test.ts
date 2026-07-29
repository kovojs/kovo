import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { KOVO_COMMAND_SCHEMA, KOVO_EXPLAIN_VIEW_SCHEMA } from './command-schema.js';
import {
  EXPLAIN_USAGE,
  formatCommandHelp,
  parseKovoCommandInvocation,
  renderShellCompletion,
} from './commands-manifest.js';
import type { KovoExplainOptions } from './graph-args.js';
import { createKovoMcpServer, kovoExplain } from './index.js';

const TARGETED_SUBCOMMANDS = ['component', 'mutation', 'query', 'page', 'context', 'task'] as const;
const TARGETED_SCHEMA = ['component', 'context', 'mutation', 'page', 'query', 'task'] as const;
const SIMPLE_SUBCOMMANDS = [
  'document',
  'sources-sinks',
  'tasks',
  'agent',
  'grants',
  'endpoints',
  'revealed',
  'trust',
  'capabilities',
  'cookies',
  'authorization',
  'auth-lifecycle',
  'model-boundaries',
] as const;
const SIMPLE_SCHEMA = [
  'agent',
  'auth-lifecycle',
  'authorization',
  'capabilities',
  'cookies',
  'document',
  'endpoints',
  'grants',
  'model-boundaries',
  'revealed',
  'sources-sinks',
  'tasks',
  'trust',
] as const;
const AUDIT = ['access', 'unguarded', 'unscoped'] as const;
const SUBCOMMANDS = [
  ...TARGETED_SUBCOMMANDS,
  ...SIMPLE_SUBCOMMANDS.slice(0, 11),
  ...AUDIT,
  ...SIMPLE_SUBCOMMANDS.slice(11),
  'attest',
];

describe('kovo explain discriminant contract', () => {
  it('derives the complete view vocabulary and preserves kovo-explain/v1', () => {
    expect(KOVO_EXPLAIN_VIEW_SCHEMA).toEqual({
      audit: AUDIT,
      simple: SIMPLE_SCHEMA,
      subcommands: SUBCOMMANDS,
      targeted: TARGETED_SCHEMA,
    });
    expect(KOVO_COMMAND_SCHEMA.find((entry) => entry.name === 'explain')?.resultProtocol).toBe(
      'kovo-explain/v1',
    );
    expect(kovoExplain({}, { view: 'document' }).output).toMatch(/^kovo-explain\/v1\n/u);

    expectTypeOf<{ view: 'access' }>().toMatchTypeOf<KovoExplainOptions>();
    expectTypeOf<{ access: true }>().not.toMatchTypeOf<KovoExplainOptions>();
  });

  it('parses only literal subcommands and rejects the retired flag-shaped selector family', () => {
    for (const view of TARGETED_SUBCOMMANDS) {
      expect(parseKovoCommandInvocation('explain', [view, 'subject'])).toMatchObject({
        ok: true,
        value: {
          arguments: { kind: view, target: 'subject' },
          command: 'explain',
          form: 'target',
        },
      });
    }
    for (const view of SIMPLE_SUBCOMMANDS) {
      expect(parseKovoCommandInvocation('explain', [view])).toMatchObject({
        ok: true,
        value: { command: 'explain', form: view },
      });
    }
    for (const view of AUDIT) {
      expect(parseKovoCommandInvocation('explain', [view, '--fail-on-findings'])).toMatchObject({
        ok: true,
        value: {
          command: 'explain',
          form: view,
          options: { failOnFindings: true },
        },
      });
    }
    expect(
      parseKovoCommandInvocation('explain', [
        'attest',
        'https://app.example',
        '--artifact',
        'graph.json',
        '--trust-anchor',
        `sha256:${'a'.repeat(64)}`,
      ]),
    ).toMatchObject({ ok: true, value: { command: 'explain', form: 'attest' } });

    for (const view of SUBCOMMANDS) {
      expect(parseKovoCommandInvocation('explain', [`--${view}`]), view).toMatchObject({
        error: 'usage',
        message: expect.stringContaining(`unknown explain option "--${view}"`),
        ok: false,
      });
    }
  });

  it('projects the same literals into generated help, completion, and authored docs', () => {
    const help = formatCommandHelp('explain');
    const completions = [
      renderShellCompletion('bash'),
      renderShellCompletion('fish'),
      renderShellCompletion('zsh'),
    ].join('\n');
    const guide = readFileSync(
      new URL('../../../site/content/guides/cli.md', import.meta.url),
      'utf8',
    );

    expect(EXPLAIN_USAGE.join('\n')).toContain(
      'kovo explain component|mutation|query|page|context|task <target>',
    );
    expect(help).toContain('Result protocol: kovo-explain/v1');
    for (const view of [...SIMPLE_SUBCOMMANDS, ...AUDIT, 'attest']) {
      expect(help, view).toContain(`kovo explain ${view}`);
    }
    for (const view of SUBCOMMANDS) {
      expect(completions, view).toContain(view);
      expect(help, view).not.toContain(`kovo explain --${view}`);
      expect(guide, view).not.toContain(`kovo explain --${view}`);
    }
    expect(guide).toContain('It has one grammar: the first token is');
  });

  it('derives the MCP view modes from the command AST and omits only live attestation', async () => {
    const server = createKovoMcpServer(process.cwd());
    await server.handleMessage({
      id: 'initialize',
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'explain-contract-test', version: '1' },
        protocolVersion: '2025-06-18',
      },
    });
    await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const listed = await server.handleMessage({
      id: 'list',
      jsonrpc: '2.0',
      method: 'tools/list',
    });
    const tools = (listed as { result: { tools: readonly McpTool[] } }).result.tools;
    const explain = tools.find((tool) => tool.name === 'kovo_explain');
    if (explain === undefined) throw new TypeError('MCP did not advertise kovo_explain.');
    const modes = explain.inputSchema.properties.options.oneOf;
    const simple: string[] = [];
    const audit: string[] = [];
    let targeted: readonly string[] = [];
    for (const mode of modes) {
      const view = mode.properties.view;
      if (view.enum !== undefined) {
        targeted = view.enum;
      } else if (view.const !== undefined) {
        (Object.hasOwn(mode.properties, 'failOnFindings') ? audit : simple).push(view.const);
      }
    }

    expect({ audit, simple, targeted }).toEqual({
      audit: KOVO_EXPLAIN_VIEW_SCHEMA.audit,
      simple: KOVO_EXPLAIN_VIEW_SCHEMA.simple,
      targeted: KOVO_EXPLAIN_VIEW_SCHEMA.targeted,
    });
    expect([...audit, ...simple, ...targeted]).not.toContain('attest');
  });
});

interface McpMode {
  readonly properties: {
    readonly failOnFindings?: unknown;
    readonly view: { readonly const?: string; readonly enum?: readonly string[] };
  };
}

interface McpTool {
  readonly inputSchema: {
    readonly properties: {
      readonly options: { readonly oneOf: readonly McpMode[] };
    };
  };
  readonly name: string;
}
