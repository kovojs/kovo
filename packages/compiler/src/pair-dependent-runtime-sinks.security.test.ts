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
    expect(
      kv236Diagnostics(`
export const BaseTarget = component({
  render: () => <base target="_self" />,
});
`),
    ).toEqual([
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
    ['object', '<object data="/safe/account" type="text/html">fallback</object>'],
    ['embed', '<embed src="/safe/account" type="text/html" />'],
  ])('disables the unsandboxable active <%s> element', (_tag, markup) => {
    expect(
      kv236Diagnostics(`
export const ActiveEmbed = component({
  render: () => (${markup}),
});
`),
    ).toEqual([expect.objectContaining({ message: expect.stringContaining('sandbox boundary') })]);
  });

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
      'SVG script href',
      '<svg><script href={state.value} /></svg>',
      'a dynamic script source can execute same-origin attacker-controlled JavaScript',
    ],
    [
      'SVG script xlink href',
      '<svg><script xlink:href={state.value} /></svg>',
      'a dynamic script source can execute same-origin attacker-controlled JavaScript',
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
    [
      'iframe source',
      '<iframe src={state.value} sandbox="allow-forms" />',
      'a dynamic iframe source can load same-origin attacker-controlled active content',
    ],
    [
      'MathML annotation encoding',
      '<math><annotation-xml encoding={state.value}><script src="/reviewed.js" /></annotation-xml></math>',
      'a dynamic MathML annotation encoding can activate inert descendants as HTML',
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

  it.each([
    ['script source spread', '<script {...{ src: state.value }} />'],
    ['link relationship spread', '<link {...{ href: "/theme.css", rel: state.value }} />'],
    [
      'iframe sandbox spread',
      '<iframe {...{ sandbox: state.value, src: "/untrusted/profile" }} />',
    ],
    ['iframe source spread', '<iframe {...{ sandbox: "allow-forms", src: state.value }} />'],
    ['opaque script spread', '<script {...state.value} />'],
    ['opaque link spread', '<link {...state.value} />'],
    ['opaque iframe spread', '<iframe {...state.value} />'],
  ])('closes a dynamic or opaque %s', (_label, markup) => {
    expect(
      kv236Diagnostics(`
export const ContextualSpread = component({
  state: () => ({ value: {} }),
  render: (_queries, state) => (${markup}),
});
`),
    ).toHaveLength(1);
  });

  it('keeps static contextual attributes and explicitly reviewed URL capabilities valid', () => {
    expect(
      kv236Diagnostics(`
import { trustedUrl } from '@kovojs/browser';
export const StaticContext = component({
  state: () => ({ asset: '/reviewed/runtime.js', stylesheet: '/reviewed/theme.css' }),
  render: (_queries, state) => (
    <>
      <script {...{ src: '/assets/runtime.js', type: 'module' }} />
      <link {...{ href: '/assets/theme.css', rel: 'stylesheet' }} />
      <iframe {...{ sandbox: 'allow-forms', src: '/untrusted/profile' }} />
      <script src={trustedUrl(state.asset, 'reviewed executable module asset')} />
      <link
        rel="stylesheet"
        href={trustedUrl(state.stylesheet, 'reviewed stylesheet asset')}
      />
      <iframe
        sandbox="allow-forms"
        src={trustedUrl(state.asset, 'reviewed embedded application')}
      />
    </>
  ),
});
`),
    ).toEqual([]);
  });
});

describe('declarative Shadow DOM and obsolete frame primitives', () => {
  it.each([
    ['static mode', '<template shadowrootmode="open"><span>secret</span></template>'],
    [
      'mixed-case direct control',
      '<template shadowRootDelegatesFocus><span>secret</span></template>',
    ],
    [
      'dynamic direct control',
      '<template shadowrootclonable={state.enabled}><span>secret</span></template>',
    ],
    [
      'binding control',
      '<template data-bind:ShadowRootSerializable="state.enabled"><span>secret</span></template>',
    ],
    [
      'derive control',
      '<template data-derive="profile.mode" data-derive-attr="ShadowRootMode"><span>secret</span></template>',
    ],
    [
      'static spread control',
      '<template {...{ shadowRootMode: "open" }}><span>secret</span></template>',
    ],
    ['opaque spread', '<template {...state.attributes}><span>secret</span></template>'],
  ])('rejects a %s with KV236', (_label, markup) => {
    expect(
      kv236Diagnostics(`
export const ShadowBoundary = component({
  state: () => ({ attributes: {}, enabled: true }),
  render: (_queries, state) => (${markup}),
});
`),
    ).toEqual([
      expect.objectContaining({
        help: expect.stringContaining('light DOM'),
        message: expect.stringContaining('declarative Shadow DOM'),
      }),
    ]);
  });

  it('keeps ordinary inert templates available', () => {
    expect(
      kv236Diagnostics(`
export const LightDomTemplate = component({
  render: () => <template data-kind="row" {...{ title: "row template" }}><span>row</span></template>,
});
`),
    ).toEqual([]);
  });

  it.each(['frame', 'frameset'])('rejects the obsolete <%s> primitive', (tag) => {
    expect(
      kv236Diagnostics(`
export const ObsoleteFrame = component({
  render: () => <${tag} src="/safe/account" />,
});
`),
    ).toEqual([expect.objectContaining({ message: expect.stringContaining('sandbox boundary') })]);
  });
});
