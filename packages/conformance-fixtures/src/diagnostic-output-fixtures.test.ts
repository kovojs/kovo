import { describe, expect, it } from 'vitest';

import {
  viteLoweredEventDiagnosticFact,
  viteDiagnosticMessageFacts,
  viteDiagnosticMessageFactsFromOutput,
} from './diagnostic-output-fixtures.js';

describe('@kovojs/test diagnostic output fixtures', () => {
  it('turns Vite diagnostic message blocks into structured facts', () => {
    expect(
      viteDiagnosticMessageFacts(
        [
          'Kovo Vite transform failed with 1 error diagnostic.',
          '',
          'KV201 routes/card.tsx:5:25 Event handler expression is not lowerable.',
          '  help: Would lower to: on:click="/c/__v/1234abcd/routes/card.client.js#Card$button_click"',
          '  help: Blocked expression: () => window.alert("x")',
          '  help: Element params: -',
          '  help: Use a top-level function or lowerable inline expression.',
          '    at TransformPluginContextImpl.transform (file:///tmp/vite.config.mjs:1:1)',
          '',
          'Command failed: /repo/node_modules/.bin/vp build',
        ].join('\n'),
      ),
    ).toEqual({
      diagnostics: [
        {
          code: 'KV201',
          help: [
            {
              label: 'Would lower to',
              text: 'on:click="/c/__v/1234abcd/routes/card.client.js#Card$button_click"',
            },
            { label: 'Blocked expression', text: '() => window.alert("x")' },
            { label: 'Element params', text: '-' },
            { label: 'help', text: 'Use a top-level function or lowerable inline expression.' },
          ],
          location: 'routes/card.tsx:5:25',
          message: 'Event handler expression is not lowerable.',
        },
      ],
      summary: 'Kovo Vite transform failed with 1 error diagnostic.',
    });
  });

  it('rejects unstructured diagnostic blocks', () => {
    expect(() =>
      viteDiagnosticMessageFacts(['summary', '', 'not a diagnostic header'].join('\n')),
    ).toThrow('Vite diagnostic header is structured: not a diagnostic header');
    expect(() =>
      viteDiagnosticMessageFacts(
        ['summary', '', 'KV201 file.ts:1:1 message', '  note: nope'].join('\n'),
      ),
    ).toThrow('Vite diagnostic help line is structured:   note: nope');
  });

  it('extracts Vite diagnostic facts from mixed command output', () => {
    expect(
      viteDiagnosticMessageFactsFromOutput(
        [
          'Command failed: vp build',
          'Kovo Vite transform failed with 1 error diagnostic.',
          '',
          'KV201 routes/card.tsx:1:1 message.',
          '  help: Element params: -',
        ].join('\n'),
      ),
    ).toEqual({
      diagnostics: [
        {
          code: 'KV201',
          help: [{ label: 'Element params', text: '-' }],
          location: 'routes/card.tsx:1:1',
          message: 'message.',
        },
      ],
      summary: 'Kovo Vite transform failed with 1 error diagnostic.',
    });
    expect(() => viteDiagnosticMessageFactsFromOutput('no diagnostics')).toThrow(
      'Vite diagnostic output includes Kovo transform summary',
    );
  });

  it('projects lowered event diagnostics without local help-text parsing', () => {
    expect(
      viteLoweredEventDiagnosticFact(
        [
          'Command failed: vp build',
          'Kovo Vite transform failed with 1 error diagnostic.',
          '',
          'KV201 routes/card.tsx:5:25 Event handler expression is not lowerable.',
          '  help: Would lower to: on:click="/c/__v/1234abcd/routes/card.client.js#Card$button_click"',
          '  help: Blocked expression: () => window.alert("x")',
          '  help: Element params: -',
          '  help: Fixes: Use a top-level function.',
        ].join('\n'),
      ),
    ).toEqual({
      diagnostic: {
        code: 'KV201',
        location: 'routes/card.tsx:5:25',
        message: 'Event handler expression is not lowerable.',
      },
      elementParams: '-',
      help: [
        {
          label: 'Would lower to',
          text: 'on:click="/c/__v/1234abcd/routes/card.client.js#Card$button_click"',
        },
        { label: 'Blocked expression', text: '() => window.alert("x")' },
        { label: 'Element params', text: '-' },
        { label: 'Fixes', text: 'Use a top-level function.' },
      ],
      loweredHandler: {
        handlerName: 'Card$button_click',
        modulePath: '/c/routes/card.client.js',
        versionShape: 'lower-hex-8',
      },
      sourceExpression: '() => window.alert("x")',
      summary: 'Kovo Vite transform failed with 1 error diagnostic.',
    });
    expect(() =>
      viteLoweredEventDiagnosticFact(
        [
          'Kovo Vite transform failed with 1 error diagnostic.',
          '',
          'KV201 routes/card.tsx:5:25 Event handler expression is not lowerable.',
          '  help: Element params: -',
        ].join('\n'),
      ),
    ).toThrow('Vite diagnostic output includes lowered handler help');
  });
});
