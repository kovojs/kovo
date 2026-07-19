import { describe, expect, it } from 'vitest';
import { ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES } from '@kovojs/core/internal/sink-policy';

import { assertFixpoint, compileComponentModule } from './index.js';
import { validateEffectiveElementContextOutputFacts } from './security/output-context.js';

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
  // @kovo-security-certifies C13 compiler-finite-browser-control-tuples
  it('rejects a direct dynamic write for every one of the 60 finite browser controls', () => {
    expect(ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES).toHaveLength(60);
    for (const [tag, attribute] of ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES) {
      const markup = `<${tag} ${attribute}={state.value} />`;
      expect(
        kv236Diagnostics(`
export const BrowserControl = component({
  state: () => ({ value: '' }),
  render: (_queries, state) => (${markup}),
});
`),
        `${tag}[${attribute}]`,
      ).toHaveLength(1);
    }
  });

  it('rejects object-literal spread writes for every finite browser control', () => {
    for (const [tag, attribute] of ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES) {
      const markup = `<${tag} {...{ ${JSON.stringify(attribute)}: state.value }} />`;
      expect(
        kv236Diagnostics(`
export const BrowserControlSpread = component({
  state: () => ({ value: '' }),
  render: (_queries, state) => (${markup}),
});
`),
        `${tag}[${attribute}] spread`,
      ).toHaveLength(1);
    }
  });

  it('fails closed on an opaque spread for every controlled element kind', () => {
    const controlledTags = new Set(ELEMENT_CONTEXT_SECURITY_CONTROL_TUPLES.map(([tag]) => tag));
    expect(controlledTags.size).toBe(15);
    for (const tag of controlledTags) {
      expect(
        kv236Diagnostics(`
export const OpaqueBrowserControlSpread = component({
  state: () => ({ value: {} }),
  render: (_queries, state) => (<${tag} {...state.value} />),
});
`),
        `<${tag}> opaque spread`,
      ).toHaveLength(1);
    }
  });

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
    ['missing sandbox', '<iframe src="/untrusted/profile" />'],
    [
      'missing sandbox in a static spread',
      '<iframe {...{ src: "/untrusted/profile", title: "profile" }} />',
    ],
    [
      'missing sandbox for a reviewed dynamic source',
      '<iframe src={trustedUrl(state.value, "reviewed embed")} />',
    ],
    [
      'isolation-lifting pair',
      '<iframe src="/untrusted/profile" sandbox="allow-scripts allow-same-origin" />',
    ],
    [
      'top navigation token in a static spread',
      '<iframe {...{ src: "/untrusted/profile", sandbox: "allow-top-navigation-by-user-activation" }} />',
    ],
    [
      'popup escape token',
      '<iframe src="/untrusted/profile" sandbox="allow-popups-to-escape-sandbox" />',
    ],
    [
      'storage access token',
      '<iframe src="/untrusted/profile" sandbox="allow-storage-access-by-user-activation" />',
    ],
  ])('rejects an iframe with %s', (_label, markup) => {
    const diagnostics = kv236Diagnostics(`
import { trustedUrl } from '@kovojs/browser';
export const Frame = component({
  state: () => ({ value: '/untrusted/profile' }),
  render: (_queries, state) => (${markup}),
});
`);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        help: expect.stringContaining('iframe'),
      }),
    ]);
  });

  it('accepts a finite safe iframe sandbox posture across direct and static spread forms', () => {
    expect(
      kv236Diagnostics(`
export const Frames = component({
  render: () => (
    <>
      <iframe src="/forms" sandbox="allow-forms" />
      <iframe src="/active" sandbox="allow-scripts" />
      <iframe {...{ src: '/passive', sandbox: 'allow-same-origin allow-modals' }} />
      <iframe sandbox="" title="inert frame" />
    </>
  ),
});
`),
    ).toEqual([]);
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
      <script {...{ src: trustedUrl(state.asset, 'reviewed spread module'), type: 'module' }} />
      <script {...{ ...{ src: trustedUrl(state.asset, 'reviewed nested spread module') }, type: 'module' }} />
      <link {...{ href: trustedUrl(state.stylesheet, 'reviewed spread stylesheet'), rel: 'stylesheet' }} />
      <iframe {...{ sandbox: 'allow-forms', src: trustedUrl(state.asset, 'reviewed spread frame') }} />
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

  it('rejects a trustedUrl lookalike normalized from a static spread', () => {
    expect(
      kv236Diagnostics(`
const trustedUrl = (value) => value;
export const SpreadLookalike = component({
  state: () => ({ asset: '/attacker.js' }),
  render: (_queries, state) => (
    <script {...{ src: trustedUrl(state.asset, 'not a capability'), type: 'module' }} />
  ),
});
`),
    ).toEqual([
      expect.objectContaining({
        help: expect.stringContaining('dynamic script source'),
      }),
    ]);
  });

  it.each([
    [
      'script source',
      '<Tooltip.Trigger asChild attrs={{ src: state.value }}><script type="module" /></Tooltip.Trigger>',
      'a dynamic script source can execute same-origin attacker-controlled JavaScript',
    ],
    [
      'script type',
      '<Tooltip.Trigger asChild attrs={{ type: state.value }}><script src="/reviewed.js" /></Tooltip.Trigger>',
      'a dynamic script type can turn an inert data block into executable JavaScript',
    ],
    [
      'stylesheet href',
      '<Tooltip.Trigger asChild attrs={{ href: state.value }}><link rel="stylesheet" /></Tooltip.Trigger>',
      'a dynamic stylesheet URL can apply attacker-controlled CSS',
    ],
    [
      'link relationship',
      '<Tooltip.Trigger asChild attrs={{ rel: state.value }}><link href="/theme.css" /></Tooltip.Trigger>',
      'a dynamic link relationship can turn an inert resource into an active stylesheet',
    ],
    [
      'iframe source',
      '<Tooltip.Trigger asChild attrs={{ src: state.value }}><iframe sandbox="allow-forms" /></Tooltip.Trigger>',
      'a dynamic iframe source can load same-origin attacker-controlled active content',
    ],
    [
      'iframe sandbox',
      '<Tooltip.Trigger asChild attrs={{ sandbox: state.value }}><iframe src="/profile" /></Tooltip.Trigger>',
      'a dynamic iframe sandbox value can remove the embedded-document isolation boundary',
    ],
    [
      'MathML annotation encoding',
      '<Tooltip.Trigger asChild attrs={{ encoding: state.value }}><annotation-xml /></Tooltip.Trigger>',
      'a dynamic MathML annotation encoding can activate inert descendants as HTML',
    ],
  ])('rejects a dynamic %s merged through primitive attrs', (_label, markup, reason) => {
    const diagnostics = kv236Diagnostics(`
export const ComposedContext = component({
  state: () => ({ value: '' }),
  render: (_queries, state) => (${markup}),
});
`);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          help: expect.stringContaining(reason),
        }),
      ]),
    );
  });

  it('retains exact trustedUrl identity through primitive attrs composition', () => {
    const result = compileComponentModule({
      fileName: 'trusted-composed-context.tsx',
      source: `
import { trustedUrl as reviewedUrl } from '@kovojs/browser';
import * as browser from '@kovojs/browser';
export const TrustedComposedContext = component({
  state: () => ({ script: '/reviewed.js', stylesheet: '/reviewed.css', frame: '/reviewed' }),
  render: (_queries, state) => (
    <>
      <Tooltip.Trigger asChild attrs={{ src: reviewedUrl(state.script, 'reviewed script') }}>
        <script type="module" />
      </Tooltip.Trigger>
      <Tooltip.Trigger asChild attrs={{ href: browser.trustedUrl(state.stylesheet, 'reviewed stylesheet') }}>
        <link rel="stylesheet" />
      </Tooltip.Trigger>
      <Tooltip.Trigger asChild attrs={{ src: reviewedUrl(state.frame, 'reviewed frame') }}>
        <iframe sandbox="allow-forms" />
      </Tooltip.Trigger>
    </>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toEqual([]);
    expect(result.loweredSource).toContain("src={reviewedUrl(state.script, 'reviewed script')}");
    expect(result.loweredSource).toContain(
      "href={browser.trustedUrl(state.stylesheet, 'reviewed stylesheet')}",
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('does not accept a local trustedUrl lookalike after composition', () => {
    const diagnostics = kv236Diagnostics(`
const trustedUrl = (value) => value;
export const LookalikeComposedContext = component({
  state: () => ({ value: '/attacker.js' }),
  render: (_queries, state) => (
    <Tooltip.Trigger asChild attrs={{ src: trustedUrl(state.value, 'not a capability') }}>
      <script type="module" />
    </Tooltip.Trigger>
  ),
});
`);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        help: expect.stringContaining('dynamic script source'),
      }),
    ]);
  });

  it('retains trustedUrl provenance in initial SSR and emitted client derives', () => {
    const result = compileComponentModule({
      fileName: 'trusted-live-context.tsx',
      source: `
import { trustedUrl } from '@kovojs/browser';
export const TrustedLiveContext = component({
  state: () => ({ script: '/reviewed.js', stylesheet: '/reviewed.css', frame: '/reviewed' }),
  render: (_queries, state) => (
    <>
      <script type="module" src={trustedUrl(state.script, 'reviewed script')} />
      <link rel="stylesheet" href={trustedUrl(state.stylesheet, 'reviewed stylesheet')} />
      <iframe sandbox="allow-forms" src={trustedUrl(state.frame, 'reviewed frame')} />
    </>
  ),
});
`,
    });
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toEqual([]);
    expect(clientSource).toContain("trustedUrl(state.script, 'reviewed script')");
    expect(clientSource).toContain("trustedUrl(state.stylesheet, 'reviewed stylesheet')");
    expect(clientSource).toContain("trustedUrl(state.frame, 'reviewed frame')");
    expect(serverSource).toContain('data-bind:src=');
    expect(() => assertFixpoint(result)).not.toThrow();
  });
});

describe('effective element-context derive invariant', () => {
  const trustedInitial = {
    attribute: 'src',
    element: 'script',
    reason: 'script source control',
    span: { end: 1, start: 0 },
    trustedUrl: true,
  } as const;

  it('accepts an emitted derive only when exact parser provenance is retained', () => {
    expect(
      validateEffectiveElementContextOutputFacts(
        { fileName: 'derive.tsx', source: 'x' },
        [trustedInitial],
        [
          {
            ...trustedInitial,
            exportName: 'Trusted$script_src_derive',
          },
        ],
      ),
    ).toEqual([]);
  });

  it.each([
    [
      'drops trusted provenance',
      [{ ...trustedInitial, exportName: 'Lost$script_src_derive', trustedUrl: false }],
      'lost its required exact trustedUrl provenance',
    ],
    [
      'claims forged provenance',
      [{ ...trustedInitial, exportName: 'Forged$script_src_derive', trustedUrl: true }],
      'claims trustedUrl without matching exact parser provenance',
    ],
    [
      'has no final control match',
      [
        {
          ...trustedInitial,
          exportName: 'Detached$script_src_derive',
          span: { end: 2, start: 1 },
        },
      ],
      'has no matching final <script> src control fact',
    ],
  ])('fails closed when an emitted derive %s', (_label, outputs, reason) => {
    const initial =
      _label === 'claims forged provenance'
        ? [{ ...trustedInitial, trustedUrl: false }]
        : [trustedInitial];
    const diagnostics = validateEffectiveElementContextOutputFacts(
      { fileName: 'derive.tsx', source: 'xx' },
      initial,
      outputs,
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV236',
        message: expect.stringContaining(reason),
      }),
    ]);
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

  it.each([
    ['unsafe referrer policy', '<a referrerpolicy="unsafe-url" />'],
    ['downgrade referrer policy', '<img referrerPolicy="no-referrer-when-downgrade" />'],
    ['named opener target', '<a target="attacker-window" />'],
    ['whitespace-named target lookalike', '<a target=" _blank " />'],
    ['explicit opener', '<area rel="nofollow OPENER noreferrer" />'],
    ['anchor ping', '<a ping="/collect" />'],
    ['area ping spread', '<area {...{ ping: "/collect" }} />'],
    ['script nonce', '<script nonce="reused-nonce" />'],
    ['style nonce', '<style nonce="reused-nonce" />'],
    ['link nonce spread', '<link {...{ nonce: "reused-nonce" }} />'],
    ['obsolete script language', '<script language="javascript" />'],
    ['anchor attribution reporting', '<a attributionsrc="https://report.example/register" />'],
    ['WebKit attribution destination', '<a attributiondestination="https://report.example" />'],
    ['WebKit attribution source id', '<a attributionsourceid="123" />'],
    ['WebKit attribution source nonce', '<a attributionsourcenonce="nonce" />'],
    ['area attribution reporting', '<area attributionsrc="https://report.example/register" />'],
    ['image attribution reporting', '<img attributionsrc="https://report.example/register" />'],
    ['script attribution reporting', '<script attributionsrc="https://report.example/register" />'],
    ['iframe browsing topics', '<iframe browsingtopics="" />'],
    ['iframe legacy payment request', '<iframe allowpaymentrequest="" />'],
    ['iframe shared storage write', '<iframe sharedstoragewritable="" />'],
    ['image shared storage write', '<img sharedstoragewritable="" />'],
    ['named form target', '<form target="attacker-window" />'],
    ['form explicit opener', '<form rel="opener" />'],
    ['named button form target', '<button formtarget="attacker-window" />'],
    ['named input form target', '<input formtarget="attacker-window" />'],
    ['meta referrer', '<meta name="referrer" content="unsafe-url" />'],
  ])('rejects static unsafe browser control: %s', (_label, markup) => {
    expect(
      kv236Diagnostics(`
export const StaticUnsafeControl = component({ render: () => (${markup}) });
`),
    ).toHaveLength(1);
  });

  it('accepts only the reviewed static control vocabulary and leaves scheduling controls dynamic', () => {
    expect(
      kv236Diagnostics(`
export const StaticControls = component({
  state: () => ({ schedule: true }),
  render: (_queries, state) => (
    <>
      <script type="module" nomodule={false} integrity="sha384-reviewed" crossorigin="anonymous" referrerpolicy="strict-origin" charset="utf-8" async={state.schedule} defer={state.schedule} fetchpriority={state.schedule} />
      <link href="/app.css" rel="stylesheet" type="text/css" media="screen" disabled={false} integrity="sha384-reviewed" crossorigin="anonymous" referrerpolicy="no-referrer" as="style" />
      <iframe src="/profile" sandbox="allow-forms" allow="fullscreen" allowfullscreen credentialless csp="default-src 'none'" referrerpolicy="same-origin" name="profile-frame" />
      <a target="_blank" rel="noopener noreferrer" referrerpolicy="strict-origin-when-cross-origin" />
      <area target="_self" rel="noreferrer" referrerpolicy="no-referrer" />
      <form target="_blank" rel="noopener noreferrer"><button formtarget="_self" /><input formtarget="_top" /></form>
      <img referrerpolicy="strict-origin" crossorigin="anonymous" />
      <audio crossorigin="anonymous" />
      <video crossorigin="use-credentials" />
      <svg><image href="/reviewed.svg" crossorigin="anonymous" /></svg>
      <meta name="description" content="Account" />
    </>
  ),
});
`),
    ).toEqual([]);
  });
});
