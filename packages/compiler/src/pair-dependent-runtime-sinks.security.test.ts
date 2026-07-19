import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

function kv236Diagnostics(source: string) {
  return compileComponentModule({ fileName: 'pair-dependent-sink.tsx', source }).diagnostics.filter(
    (diagnostic) => diagnostic.code === 'KV236',
  );
}

describe('pair-dependent dynamic navigation sinks', () => {
  it('rejects state-derived meta refresh content before it can become a live navigation', () => {
    const diagnostics = kv236Diagnostics(`
export const Refresh = component({
  state: () => ({ target: '0; url=https://attacker.example/collect' }),
  render: (_queries, state) => (
    <meta http-equiv="refresh" content={state.target} />
  ),
});
`);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('meta refresh'),
        }),
      ]),
    );
  });

  it('rejects state-derived base href before it can retarget document-relative actions', () => {
    const diagnostics = kv236Diagnostics(`
export const Base = component({
  state: () => ({ target: 'https://attacker.example/' }),
  render: (_queries, state) => <base href={state.target} />,
});
`);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('base'),
        }),
      ]),
    );
  });

  it('disables the document-wide base element even without a currently visible href', () => {
    expect(kv236Diagnostics(`
export const BaseTarget = component({
  render: () => <base target="_self" />,
});
`)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('<base> is disabled') }),
    ]);
  });

  it.each([
    '<meta HTTP-EQUIV=" ReFrEsH " content="0; url=/account" />',
    '<meta {...{ "http-equiv": "refresh", content: "0; url=/account" }} />',
    '<meta http-equiv={state.kind} content="0; url=/account" />',
    '<meta data-bind:http-equiv="state.kind" content="0; url=/account" />',
    '<meta data-derive="profile.kind" data-derive-attr="HTTP-EQUIV" content="0; url=/account" />',
  ])('closes direct, spread, and dynamic meta-refresh construction: %s', (markup) => {
    const diagnostics = kv236Diagnostics(`
export const Meta = component({
  state: () => ({ kind: 'refresh' }),
  render: (_queries, state) => (${markup}),
});
`);

    expect(diagnostics).toEqual([
      expect.objectContaining({ message: expect.stringContaining('refresh') }),
    ]);
  });

  it('preserves ordinary metadata and a statically non-refresh http-equiv value', () => {
    const diagnostics = kv236Diagnostics(`
export const Metadata = component({
  state: () => ({ description: 'Account overview' }),
  render: (_queries, state) => (
    <>
      <meta name="description" content={state.description} />
      <meta http-equiv="Content-Security-Policy" content="default-src 'self'" />
      <meta {...{ name: 'theme-color', content: '#112233' }} />
    </>
  ),
});
`);

    expect(diagnostics).toEqual([]);
  });
});

describe('element-context execution and isolation sinks', () => {
  it.each([
    [
      'script source',
      '<script src={state.value} />',
      'a dynamic script source can execute same-origin attacker-controlled JavaScript',
    ],
    [
      'script type',
      '<script src="/uploads/reviewed.js" type={state.value} />',
      'a dynamic script type can turn an inert data block into executable JavaScript',
    ],
    [
      'stylesheet href',
      '<link rel="stylesheet" href={state.value} />',
      'a dynamic stylesheet URL can apply attacker-controlled CSS',
    ],
    [
      'link relationship',
      '<link href="/uploads/theme.css" rel={state.value} />',
      'a dynamic link relationship can turn an inert resource into an active stylesheet',
    ],
    [
      'iframe sandbox',
      '<iframe src="/untrusted/profile" sandbox={state.value} />',
      'a dynamic iframe sandbox value can remove the embedded-document isolation boundary',
    ],
  ])('rejects a dynamic %s', (_label, markup, expectedReason) => {
    const diagnostics = kv236Diagnostics(`
export const ContextualSink = component({
  state: () => ({ value: '' }),
  render: (_queries, state) => (${markup}),
});
`);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        help: expect.stringContaining(expectedReason),
      }),
    ]);
  });
});
