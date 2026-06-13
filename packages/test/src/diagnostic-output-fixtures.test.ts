import { describe, expect, it } from 'vitest';

import { viteDiagnosticMessageFacts } from './diagnostic-output-fixtures.js';

describe('@jiso/test diagnostic output fixtures', () => {
  it('turns Vite diagnostic message blocks into structured facts', () => {
    expect(
      viteDiagnosticMessageFacts(
        [
          'Jiso Vite transform failed with 1 error diagnostic.',
          '',
          'FW201 routes/card.tsx:5:25 Event handler expression is not lowerable.',
          '  help: Would lower to: on:click="/c/routes/card.client.js?v=1234abcd#Card$button_click"',
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
          code: 'FW201',
          help: [
            {
              label: 'Would lower to',
              text: 'on:click="/c/routes/card.client.js?v=1234abcd#Card$button_click"',
            },
            { label: 'Blocked expression', text: '() => window.alert("x")' },
            { label: 'Element params', text: '-' },
            { label: 'help', text: 'Use a top-level function or lowerable inline expression.' },
          ],
          location: 'routes/card.tsx:5:25',
          message: 'Event handler expression is not lowerable.',
        },
      ],
      summary: 'Jiso Vite transform failed with 1 error diagnostic.',
    });
  });

  it('rejects unstructured diagnostic blocks', () => {
    expect(() =>
      viteDiagnosticMessageFacts(['summary', '', 'not a diagnostic header'].join('\n')),
    ).toThrow('Vite diagnostic header is structured: not a diagnostic header');
    expect(() =>
      viteDiagnosticMessageFacts(
        ['summary', '', 'FW201 file.ts:1:1 message', '  note: nope'].join('\n'),
      ),
    ).toThrow('Vite diagnostic help line is structured:   note: nope');
  });
});
