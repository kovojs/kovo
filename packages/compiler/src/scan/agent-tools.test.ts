import { describe, expect, it } from 'vitest';

import { agentToolSinksFromSource, type AgentToolModuleSource } from './agent-tools.js';

// Regression coverage for bugz-3 L6 (SPEC §6.6 capability disclosure completeness): the
// framework-owned `tool()` capability analyzer under-reported a tool's blast radius because it
// (a) skipped sinks inside nested non-invoked callbacks, (b) only matched a bare `fetch` identifier
// callee (missing `globalThis.fetch`/`window.fetch`), and (c) only matched the `process.env.NAME`
// property form (missing `process.env['NAME']` element access). These tests drive the real
// `agentToolSinksFromSource` AST scanner; every assertion below failed on the pre-fix analyzer.

function tool(handlerBody: string, fileName = 'src/tools/probe.ts'): AgentToolModuleSource {
  return {
    fileName,
    source: [
      "import { tool } from '@kovojs/server';",
      'export const probe = tool({',
      "  name: 'orders.probe',",
      '  handler() {',
      handlerBody,
      '  },',
      '});',
    ].join('\n'),
  };
}

function sinks(handlerBody: string) {
  return agentToolSinksFromSource(tool(handlerBody));
}

describe('agentToolSinksFromSource — egress callee forms (bugz-3 L6; SPEC §6.6)', () => {
  it('recognizes globalThis.fetch as a sound egress sink', () => {
    expect(sinks("    return globalThis.fetch('https://api.openai.com/v1/chat');")).toEqual([
      {
        capability: 'egress:api.openai.com',
        evidence: 'static-tool-body-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/probe.ts:5:12',
        target: 'api.openai.com',
        tool: 'orders.probe',
      },
    ]);
  });

  it('recognizes window.fetch as a sound egress sink', () => {
    const [fact] = sinks("    return window.fetch('https://hooks.slack.com/services/x');");
    expect(fact).toMatchObject({
      capability: 'egress:hooks.slack.com',
      grade: 'sound',
      kind: 'egress',
      target: 'hooks.slack.com',
      tool: 'orders.probe',
    });
  });

  it('still recognizes a bare fetch callee (no regression) and a shadowed fetch stays silent', () => {
    expect(sinks("    return fetch('https://api.sendgrid.com/v3/mail/send');")).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-body-fetch',
        grade: 'sound',
        kind: 'egress',
        site: 'src/tools/probe.ts:5:12',
        target: 'api.sendgrid.com',
        tool: 'orders.probe',
      },
    ]);

    // A locally-bound `fetch` shadows the global and must not be reported.
    expect(
      sinks(
        [
          '    const fetch = (_url: string) => undefined;',
          "    return fetch('https://api.sendgrid.com/v3/mail/send');",
        ].join('\n'),
      ),
    ).toEqual([]);
  });
});

describe('agentToolSinksFromSource — process.env secret reads (bugz-3 L6; SPEC §6.6)', () => {
  it('recognizes process.env["NAME"] element access as a sound secret read', () => {
    expect(sinks("    const key = process.env['OPENAI_API_KEY']; return key;")).toEqual([
      {
        capability: 'secrets.read',
        evidence: 'static-tool-body-env',
        grade: 'sound',
        kind: 'secret-read',
        site: 'src/tools/probe.ts:5:17',
        target: 'env.OPENAI_API_KEY',
        tool: 'orders.probe',
      },
    ]);
  });

  it('still recognizes process.env.NAME property access (no regression)', () => {
    const [fact] = sinks('    const key = process.env.OPENAI_API_KEY; return key;');
    expect(fact).toMatchObject({
      capability: 'secrets.read',
      grade: 'sound',
      kind: 'secret-read',
      target: 'env.OPENAI_API_KEY',
    });
  });
});

describe('agentToolSinksFromSource — nested non-invoked callbacks (bugz-3 L6; SPEC §6.6)', () => {
  it('reports an audit-grade egress for a fetch inside an arr.forEach callback', () => {
    const facts = sinks(
      [
        "    const urls = ['https://api.sendgrid.com'];",
        '    urls.forEach(() => {',
        "      void fetch('https://api.sendgrid.com/v3/mail/send');",
        '    });',
      ].join('\n'),
    );

    // KEY ASSERTION: the pre-fix analyzer returned [] here (the callback body was skipped). The sink
    // is now visible, but audit-grade (invocation through an unanalyzable callee is unproven), so it
    // appears in `kovo explain --capabilities` without being `kovo check`-enforced.
    expect(facts).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-nested-callback-fetch',
        grade: 'audit',
        kind: 'egress',
        site: 'src/tools/probe.ts:7:12',
        target: 'api.sendgrid.com',
        tool: 'orders.probe',
      },
    ]);
  });

  it('reports audit-grade sinks for .map and .then callbacks, including globalThis.fetch and process.env[...]', () => {
    const mapFacts = sinks(
      "    [1].map(() => globalThis.fetch('https://api.openai.com/v1/chat'));",
    );
    expect(mapFacts).toEqual([
      {
        capability: 'egress:api.openai.com',
        evidence: 'static-tool-nested-callback-fetch',
        grade: 'audit',
        kind: 'egress',
        site: 'src/tools/probe.ts:5:19',
        target: 'api.openai.com',
        tool: 'orders.probe',
      },
    ]);

    const thenFacts = sinks(
      [
        '    return Promise.resolve().then(() => {',
        "      const token = process.env['SENDGRID_TOKEN'];",
        "      return fetch('https://api.sendgrid.com/v3/mail/send', { headers: { token } });",
        '    });',
      ].join('\n'),
    );
    expect(thenFacts).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-nested-callback-fetch',
        grade: 'audit',
        kind: 'egress',
        site: 'src/tools/probe.ts:7:14',
        target: 'api.sendgrid.com',
        tool: 'orders.probe',
      },
      {
        capability: 'secrets.read',
        evidence: 'static-tool-nested-callback-env',
        grade: 'audit',
        kind: 'secret-read',
        site: 'src/tools/probe.ts:6:21',
        target: 'env.SENDGRID_TOKEN',
        tool: 'orders.probe',
      },
    ]);
  });

  it('keeps audit grade sticky for a proven inline IIFE nested inside an unproven callback', () => {
    const facts = sinks(
      [
        '    [1].forEach(() => {',
        '      (() => {',
        "        void fetch('https://api.sendgrid.com/v3/mail/send');",
        '      })();',
        '    });',
      ].join('\n'),
    );

    // The IIFE is proven-invoked relative to its enclosing callback, but the callback itself is not
    // proven-invoked, so the whole path stays audit-grade (SPEC §6.6 rule 3 — audit is sticky).
    expect(facts).toEqual([
      {
        capability: 'egress:api.sendgrid.com',
        evidence: 'static-tool-nested-callback-fetch',
        grade: 'audit',
        kind: 'egress',
        site: 'src/tools/probe.ts:7:14',
        target: 'api.sendgrid.com',
        tool: 'orders.probe',
      },
    ]);
  });
});
