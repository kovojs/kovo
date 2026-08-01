// @kovo-security-classifier-corpus finite-security-operation-ir
import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

function compile(source: string) {
  return compileComponentModule({
    fileName: 'src/finite-security-ir.tsx',
    source,
  });
}

function kv449(source: string) {
  return compile(source).diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');
}

function kv450(source: string) {
  return compile(source).diagnostics.filter((diagnostic) => diagnostic.code === 'KV450');
}

function kv235(source: string) {
  return compile(source).diagnostics.filter((diagnostic) => diagnostic.code === 'KV235');
}

function browserHandlerBoundaryDiagnostics(body: string, renderInput = '') {
  return compile(`
export const Probe = component({
  state: () => ({ count: 0, saved: null, value: 'initial' }),
  render: (${renderInput}) => <button onClick={() => {
    ${body}
  }}>Run</button>,
});
`).diagnostics.filter((diagnostic) => diagnostic.code === 'KV201' || diagnostic.code === 'KV449');
}

function kv449Project(
  source: string,
  extraFiles: readonly { readonly fileName: string; readonly source: string }[],
) {
  return compileComponentModule({
    extraFiles,
    fileName: 'src/finite-security-ir.tsx',
    source,
  }).diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');
}

describe('SPEC §4.3/§5.2 finite compiler-owned security IR', () => {
  it('rejects laundering a whole request carrier through serverValue before mutation', () => {
    const diagnostics = kv449(`
import { endpoint } from '@kovojs/server'
import { serverValue } from '@kovojs/server/write-safety';
function poison(target, replacement) { target.request = replacement; }
export const report = endpoint('/report', {
  handler(input, context) {
    const carrierAlias = serverValue(context, 'reviewed carrier');
    poison(carrierAlias, input.request);
    return Response.json({ ok: true });
  },
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('serverValue'))).toBe(true);
  });

  it('carries exact compiler-derived operations in emitted browser and server artifacts', () => {
    const result = compile(`
import { component } from '@kovojs/core';
import { endpoint } from '@kovojs/server';
export const Demo = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={() => { state.count += 1; }}>Run</button>,
});
export const api = endpoint('/api', {
  async handler(_input, ctx) {
    await ctx.fetch('https://api.example.test/report');
    ctx.headers.set('Cache-Control', 'no-store');
    return Response.json({ ok: true });
  },
});
`);
    const browserSource = result.files.find((file) => file.kind === 'client')?.source ?? '';
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(browserSource).toContain(
      'securityHandler([{"door":"compiler-state","kind":"browser.state.write","target":"state.count"}],',
    );
    expect(serverSource).toContain('__kovoSecurityOperationManifest_v1');
    expect(serverSource).toContain('kovo-security-operation-ir/v1');
    expect(serverSource).toContain(
      '{"door":"ctx.fetch","kind":"server.egress.request","target":"ctx.fetch"}',
    );
    expect(serverSource).toContain(
      '{"door":"structured-headers","kind":"server.response.header","target":"ctx.headers.set"}',
    );
    expect(serverSource).toContain(
      '{"door":"Response","kind":"server.response.raw","target":"Response.json","justification":"endpoint access/CSRF posture"}',
    );
    expect(serverSource).toContain('"span":');
    expect(result.componentGraphFacts[0]?.securityOperations).toEqual(
      expect.arrayContaining([
        {
          door: 'Response',
          justification: 'endpoint access/CSRF posture',
          kind: 'server.response.raw',
          target: 'Response.json',
        },
        {
          door: 'compiler-state',
          kind: 'browser.state.write',
          target: 'state.count',
        },
      ]),
    );
  });

  // @kovo-security-certifies C13 runtime-selected-handler-ref-closes
  it.each([
    ['direct lowercase', 'on:click={profile.handler}'],
    ['direct ASCII-case variant', 'ON:CLICK={profile.handler}'],
    ['static spread lowercase', "{...{ 'on:click': profile.handler }}"],
    ['static spread ASCII-case variant', "{...{ 'On:Click': profile.handler }}"],
  ])('closes a runtime-selected handler reference through %s', (_label, attributes) => {
    const source = `
export const DynamicRef = component({
  render: ({ profile }) => <button ${attributes}>Run</button>,
});
`;

    expect(kv449(source)).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          'runtime-selected on:* handler reference is not compiler-authorized',
        ),
      }),
    ]);
  });

  it.each([
    [
      'handler ref',
      "'on:click': profile.executableRef",
      'runtime-selected on:* handler reference is not compiler-authorized',
    ],
    [
      'derive ref',
      "'data-bind:hidden': profile.executableRef",
      'runtime-selected executable reference is not compiler-authorized',
    ],
    [
      'derive property ref',
      "'data-bind-prop:checked': profile.executableRef",
      'runtime-selected executable reference is not compiler-authorized',
    ],
    [
      'stream renderer ref',
      "'data-stream-renderer': profile.executableRef",
      'runtime-selected executable reference is not compiler-authorized',
    ],
    [
      'module allowlist authority',
      "'data-kovo-module-allowlist': profile.executableRef",
      'runtime-selected executable reference is not compiler-authorized',
    ],
  ])(
    'closes a runtime-selected %s merged through primitive attrs',
    (_label, attribute, message) => {
      const source = `
export const DynamicPrimitiveRef = component({
  render: ({ profile }) => (
    <Tooltip.Trigger asChild attrs={{ ${attribute} }}>
      <button>Run</button>
    </Tooltip.Trigger>
  ),
});
`;

      expect(kv449(source)).toEqual([
        expect.objectContaining({
          message: expect.stringContaining(message),
        }),
      ]);
    },
  );

  it.each([
    ['derive text ref (direct)', 'data-bind={profile.executableRef}'],
    ['derive attribute ref (direct ASCII-case)', 'DATA-BIND:HIDDEN={profile.executableRef}'],
    ['derive property ref (direct)', 'data-bind-prop:checked={profile.executableRef}'],
    [
      'stream renderer ref (direct ASCII-case)',
      'data-stream-text="assistant:a1" DATA-STREAM-RENDERER={profile.executableRef}',
    ],
    [
      'module allowlist authority (direct ASCII-case)',
      'DATA-KOVO-MODULE-ALLOWLIST={profile.executableRef}',
    ],
    ['derive text ref (static-key spread)', "{...{ 'data-bind': profile.executableRef }}"],
    [
      'derive attribute ref (static-key spread)',
      "{...{ 'data-bind:hidden': profile.executableRef }}",
    ],
    [
      'derive property ref (static-key spread)',
      "{...{ 'data-bind-prop:checked': profile.executableRef }}",
    ],
    [
      'stream renderer ref (static-key spread)',
      'data-stream-text="assistant:a1" {...{ \'data-stream-renderer\': profile.executableRef }}',
    ],
    [
      'module allowlist authority (static-key spread)',
      "{...{ 'data-kovo-module-allowlist': profile.executableRef }}",
    ],
  ])('closes a runtime-selected executable selector through %s', (_label, attributes) => {
    const source = `
export const DynamicExecutableRef = component({
  render: ({ profile }) => <output ${attributes}>Result</output>,
});
`;

    expect(kv449(source)).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          'runtime-selected executable reference is not compiler-authorized',
        ),
      }),
    ]);
  });

  it('keeps compiler-emitted executable references accepted only through fixpoint provenance', () => {
    const result = compile(`
import { component } from '@kovojs/core';
export const TypedRefs = component({
  state: () => ({ checked: false }),
  render: () => (
    <button checked={state.checked} onClick={() => { state.checked = !state.checked; }}>
      Toggle
    </button>
  ),
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV235')).toEqual([]);
    expect(serverSource).toContain('on:click=');
    expect(serverSource).toContain('data-bind:checked=');
    expect(serverSource).toContain('data-bind-prop:checked=');
    expect(serverSource).toContain('data-kovo-module-allowlist=');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('keeps opaque app spreads behind runtime executable-selector stripping', () => {
    const runtimeFilteredNestedSpread = compile(`
export const RuntimeFiltered = component({
  render: ({ profile }) => (
    <button {...profile.attrs}>Opaque spread</button>
  ),
});
`);
    expect(
      runtimeFilteredNestedSpread.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449'),
    ).toEqual([]);
    expect(
      runtimeFilteredNestedSpread.files.find((file) => file.kind === 'server')?.source,
    ).toContain('kovoSafeJsxSpread');
  });

  // @kovo-security-certifies C13 authored-executable-ref-provenance-closes
  it.each([
    ['direct handler', 'on:click="/c/other.client.js#privileged"'],
    ['direct handler ASCII-case variant', "ON:CLICK={'/c/other.client.js#privileged'}"],
    ['static-spread handler', "{...{ 'on:click': '/c/other.client.js#privileged' }}"],
    [
      'static-spread handler ASCII-case variant',
      "{...{ 'On:Click': '/c/other.client.js#privileged' }}",
    ],
    ['text derive module ref', 'data-bind="/c/other.client.js#privileged"'],
    ['attribute derive module ref', 'data-bind:hidden="/c/other.client.js#privileged"'],
    ['text binding path', 'data-bind="cart.count"'],
    ['attribute binding path', 'data-bind:hidden="state.hidden"'],
    ['static-spread text binding path', "{...{ 'data-bind': 'cart.count' }}"],
    ['static-spread attribute binding path', "{...{ 'data-bind:hidden': 'state.hidden' }}"],
    ['property derive module ref', 'data-bind-prop:checked="/c/other.client.js#privileged"'],
    ['property binding path', 'data-bind-prop:checked="state.checked"'],
    [
      'stream renderer module ref',
      'data-stream-text="assistant:a1" data-stream-renderer="/c/other.client.js#privileged"',
    ],
    ['module allowlist authority', 'data-kovo-module-allowlist="/c/other.client.js"'],
  ])(
    'closes app-authored static lowered executable references through %s',
    (_label, attributes) => {
      const source = `
import { component } from '@kovojs/core';
export const Raw = component({
  render: () => <button ${attributes}>Run</button>,
});
`;

      expect(kv235(source)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining(
              'App source hand-authors an executable lowered-IR reference',
            ),
          }),
        ]),
      );
    },
  );

  it.each([
    ['direct trusted-URL derivation marker', 'data-kovo-trusted-url:src=""'],
    ['static-spread trusted-URL derivation marker', "{...{ 'data-kovo-trusted-url:src': '' }}"],
  ])('closes app-authored %s', (_label, attributes) => {
    const source = `
import { component } from '@kovojs/core';
export const Raw = component({
  render: () => <img ${attributes} alt="" />,
});
`;

    expect(kv235(source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining(
            'App source hand-authors framework control-plane lowered IR',
          ),
        }),
      ]),
    );
  });

  it.each([
    ['handler ref', "'on:click': '/c/other.client.js#privileged'"],
    ['derive ref', "'data-bind:hidden': '/c/other.client.js#privileged'"],
    ['text binding path', "'data-bind': 'cart.count'"],
    ['attribute binding path', "'data-bind:hidden': 'state.hidden'"],
    ['derive property ref', "'data-bind-prop:checked': '/c/other.client.js#privileged'"],
    ['derive property path', "'data-bind-prop:checked': 'cart.checked'"],
    ['stream renderer ref', "'data-stream-renderer': '/c/other.client.js#privileged'"],
    ['module allowlist authority', "'data-kovo-module-allowlist': '/c/other.client.js'"],
  ])(
    'closes app-authored static lowered %s merged through primitive attrs',
    (_label, attribute) => {
      const source = `
import { component } from '@kovojs/core';
export const RawPrimitive = component({
  render: () => (
    <Tooltip.Trigger asChild attrs={{ ${attribute} }}>
      <button>Run</button>
    </Tooltip.Trigger>
  ),
});
`;

      expect(kv235(source)).toEqual([
        expect.objectContaining({
          message: expect.stringContaining(
            'App source hand-authors an executable lowered-IR reference',
          ),
        }),
      ]);
    },
  );

  it('closes duplicate and nested static-spread executable selectors by authored provenance', () => {
    const diagnostics = kv235(`
import { component } from '@kovojs/core';
export const Nested = component({
  render: () => (
    <button {...{
      'on:click': '/c/other.client.js#first',
      ...{ 'On:Click': '/c/other.client.js#second' },
      'data-bind-prop:checked': 'cart.checked',
    }}>Run</button>
  ),
});
`);

    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('on:click'),
        expect.stringContaining('On:Click'),
        expect.stringContaining('data-bind-prop:checked'),
      ]),
    );
  });

  it('closes duplicate and nested primitive attrs without trusting the carrier tag', () => {
    const diagnostics = kv235(`
import { component } from '@kovojs/core';
export const NestedPrimitive = component({
  render: () => (
    <Tooltip.Trigger {...{ attrs: {
      'on:click': '/c/other.client.js#first',
      'On:Click': '/c/other.client.js#second',
      'data-bind-prop:checked': 'state.checked',
    } }}>
      <button>Run</button>
    </Tooltip.Trigger>
  ),
});
`);

    expect(diagnostics).toHaveLength(3);
  });

  it('keeps typed event and execution-trigger inputs on compiler-owned lowering', () => {
    const result = compile(`
import { component } from '@kovojs/core';
export const Typed = component({
  state: () => ({ ready: false }),
  render: () => (
    <section>
      <button onClick={() => { state.ready = true; }}>Run</button>
      <output onIdle={() => { state.ready = true; }}>Idle</output>
      <output onVisible={() => { state.ready = true; }}>Visible</output>
    </section>
  ),
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV235')).toEqual([]);
    expect(serverSource).toContain('on:click=');
    expect(serverSource).toContain('on:idle=');
    expect(serverSource).toContain('on:visible=');
  });

  it('accepts synchronous state and timer effects without deferred state capture', () => {
    const result = compile(`
export const Demo = component({
  state: () => ({ open: false, value: '' }),
  render: () => <form onSubmit={() => {
    state.open = true;
    const timer = setTimeout(() => { clearTimeout(timer); }, 0);
    clearTimeout(timer);
  }} id="demo-form"><button id="next">Save</button></form>,
});
`);

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
  });

  it.each([
    "setTimeout('state.count += 1', 0)",
    'setInterval(`state.count += ${1}`, 0)',
    "window.setInterval('state.count += 1', 0)",
    'window.setTimeout(`state.count += 1`, 0)',
    "globalThis.setTimeout('state.count += 1', 0)",
    'globalThis.setInterval(`state.count += ${1}`, 0)',
  ])('rejects source-text timer callback execution: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    "setTimeout((node) => node.replaceChildren('owned'), 0, event.target)",
    'setInterval(() => {}, event.detail)',
    'window.setTimeout(() => {}, 0, state.value)',
    'globalThis.setInterval(() => {}, Number(state.delay), event.target)',
    'setTimeout((value = event) => { String(value); }, 1)',
    'setTimeout(({ target } = event) => { void target; }, 1)',
    'setTimeout((value = state) => { Object.assign(value.profile, { admin: true }); }, 1)',
    'setTimeout(function () { void this.pwn; }, 1)',
    'setTimeout(function () { const receiver = this; void receiver.pwn; }, 1)',
  ])('rejects unclosed timer delay or variadic callback arguments: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ delay: 0, value: '' }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    'clearTimeout()',
    'clearTimeout(1, 2)',
    'clearTimeout(event)',
    'const cancel = clearInterval; cancel(event)',
    'window.clearTimeout(event)',
  ])('rejects unclosed timer cancellation handles: %s', (operation) => {
    const diagnostics = kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'timer cancellation',
    );
  });

  it.each(['clearTimeout.bind(undefined)(event)', 'clearInterval.call(undefined, event)'])(
    'rejects timer invocation indirection: %s',
    (operation) => {
      expect(
        kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
      ).not.toEqual([]);
    },
  );

  it.each(['Promise.resolve(1)', "void Promise.reject('expected')", 'Promise.all([1])'])(
    'rejects asynchronous global work in synchronous handlers: %s',
    (operation) => {
      expect(
        kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
      ).not.toEqual([]);
    },
  );

  it.each([
    'state',
    'state.profile',
    'true ? state.profile : {}',
    '(state.profile, state.profile)',
    'Object(state.profile)',
  ])('rejects state mutation hidden behind Object.assign target %s', (target) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ count: 0, profile: { admin: false } }),
  render: () => <button onClick={() => { Object.assign(${target}, { admin: true }); }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    '`value:${foreign}`',
    '+foreign',
    '({ [foreign]: 1 })',
    '({})[foreign]',
    '[...foreign]',
    'for (let value of foreign) { void value; }',
    'for (let key in foreign) { void key; }',
    'class Derived extends foreign {}',
  ])('rejects imported authority in implicit executable protocols: %s', (operation) => {
    expect(
      kv449(`
import { foreign } from './foreign.client.js';
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    "event + ''",
    '`${event}`',
    '({ [event]: 1 })',
    '({})[event]',
    '[...event]',
    '({ ...event })',
    'for (let value of event) { void value; }',
    'for (let key in event) { void key; }',
    "'target' in event",
    '+event',
    'class Derived extends event {}',
  ])('rejects raw event authority in implicit executable protocols: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    'void (true ? event : {}).pwn',
    'void (event || {}).pwn',
    'void (0, event).pwn',
    'void ({ value: event }.value).pwn',
    'void ([event][0]).pwn',
    'String((true ? event : {}).pwn)',
  ])('rejects event authority projected through expression wrappers: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    'if ((true ? state.profile : {}).admin) state.open = true',
    'if ((state.profile || {}).admin) state.open = true',
    'if ((0, state.profile).admin) state.open = true',
    'if (({ value: state.profile }.value).admin) state.open = true',
    'if ([state.profile][0].admin) state.open = true',
  ])('rejects state reads projected through expression wrappers: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ open: false, profile: { admin: false } }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    '(true ? state.profile : {})[key] = true',
    '(0, state.profile)[key] = true',
    '(state.profile || {})[key] = true',
    '(true ? state.profile : {})[key]++',
    'delete (true ? state.profile : {})[key]',
  ])('rejects state mutation projected through expression wrappers: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ profile: { admin: false } }),
  render: () => <button onClick={() => { const key = 'admin'; ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    'const { profile } = true ? state : {}; profile.admin = true',
    'const [profile] = true ? state.items : []; profile.admin = true',
    'let profile; ({ profile } = (0, state)); profile.admin = true',
    'let profile; [profile] = (state.items || []); profile.admin = true',
  ])('rejects hidden state aliases destructured from expression wrappers: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ items: [{ admin: false }], profile: { admin: false } }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    '[state.profile].map((profile) => { profile.admin = true; })',
    'const profiles = [state.profile]; profiles.map((profile) => { profile.admin = true; })',
  ])('rejects state aliases smuggled through reviewed local-array callbacks: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ profile: { admin: false } }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it('canonicalizes state aliases and method receivers in the emitted audit witness', () => {
    const result = compile(`
export const Demo = component({
  state: () => ({ profile: { count: 0 }, rows: [] }),
  render: () => <button onClick={() => {
    const model = state;
    model.profile.count = 1;
    model.rows.push(2);
  }}>Run</button>,
});
`);
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(clientSource).toContain('"target":"state.profile.count"');
    expect(clientSource).toContain('"target":"state.rows.push"');
    expect(clientSource).not.toContain('"target":"model.profile.count"');
  });

  it('matches the generated runtime limit of 256 distinct browser operations', () => {
    const source = (count: number) => `
export const Demo = component({
  state: () => ({}),
  render: () => <button onClick={() => {
    ${Array.from({ length: count }, (_, index) => `state.value${index} = ${index};`).join('\n')}
  }}>Run</button>,
});
`;
    expect(kv449(source(256))).toEqual([]);

    const overflow = compile(source(257));
    const clientSource = overflow.files.find((file) => file.kind === 'client')?.source ?? '';
    expect(
      overflow.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'KV449' && diagnostic.message.includes('at most 256 distinct'),
      ),
    ).toBe(true);
    expect(clientSource).toContain('browser handler omitted from synchronous output');
    expect(clientSource).not.toContain('"target":"state.value256"');
  });

  it.each([
    '(true ? event : {})[key] = 1',
    '(0, event)[key] = 1',
    '(event || {})[key] = 1',
    '(true ? event : {})[key]++',
    'delete (true ? event : {})[key]',
  ])('rejects event mutation projected through expression wrappers: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  render: () => <button onClick={() => { const key = 'pwn'; ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    'try { throw event } catch (error) { state.value = String(error); }',
    "try { throw event } catch (error) { state.value = error + ''; }",
    'try { throw event } catch ({ target }) { void target; }',
    'try { throw event } catch ([value]) { void value; }',
    "try { state.value = 'x'; } finally { state.value = 'y'; }",
    'throw event',
  ])('rejects exception-control provenance laundering: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ value: '' }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    'const { x = state.profile } = {}; x.admin = true',
    'const [x = state.profile] = []; x.admin = true',
    'let x = {}; ({ x = state.profile } = {}); x.admin = true',
    'let x = {}; [x = state.profile] = []; x.admin = true',
    'const { x = event } = {}; String(x)',
    '[{}].map(({ x = state.profile }) => { x.admin = true; })',
    '[{}].map(({ x = event }) => String(x))',
    '[{}].map((value) => { const { x = state.profile } = value; x.admin = true; })',
    '[{}].map((value = event) => String(value))',
  ])('rejects provenance laundering through default initializers: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ profile: { admin: false } }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    "const x = event.target.valueOf(); x.replaceChildren('owned')",
    "event.target.toString(); event.target.replaceChildren('owned')",
    "event.target.querySelectorAll('*').item(0)?.replaceChildren('owned')",
    "event.target.querySelectorAll('*')[0]?.replaceChildren('owned')",
  ])('rejects DOM authority laundered through non-scalar read results: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    'String(event.detail)',
    'Number(event.detail)',
    'Boolean(event.detail)',
    'Object(event.detail)',
    'isFinite(event.detail)',
    "String({ toString() { state.count += 1; return ''; } })",
    "JSON.stringify({ toJSON() { state.count += 1; return ''; } })",
  ])('rejects unproved coercion or object protocols through reviewed globals: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    'event.detail()',
    'event.detail?.()',
    'event.detail.call(undefined)',
    'event.detail.apply(undefined, [])',
    'event.detail.run()',
    'const run = event.detail; run()',
    'const box = { run: event.detail }; box.run()',
    'const values = [event.detail]; values[0]()',
  ])('rejects direct or transitively contained event-payload execution: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    "const box = { node: event.target }; box.node.replaceChildren('owned')",
    "const values = [event.target]; values[0].replaceChildren('owned')",
    "let box; box = { node: event.target }; box.node.replaceChildren('owned')",
  ])('rejects DOM authority laundered through local containers: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    "const box = { send: fetch }; box.send('/admin')",
    "const output = console; output.log('owned')",
    'queueMicrotask(() => {})',
    'const enqueue = queueMicrotask; enqueue(() => {})',
  ])('rejects unknown ambient executables and their local aliases: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    "const C = WebSocket; new C('wss://example.test')",
    "new EventSource('/events')",
    'new XMLHttpRequest()',
    "new Worker('/worker.js')",
    "new BroadcastChannel('updates')",
  ])('rejects browser constructor execution and constructor aliases: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    "const get = () => event.target; const node = get(); node.replaceChildren('owned')",
    'const get = () => event.detail; get()()',
  ])('rejects local-call return authority without an exact finite summary: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    ['ambient callback', '', 'console.log'],
    ['imported callback', "import { report } from './report.client.js';", 'report'],
    ['state-derived callback', '', 'state.onChange'],
  ])(
    'rejects %s hidden in reviewed framework callback options',
    (_label, declaration, callback) => {
      expect(
        kv449(`
${declaration}
import { toggleTriggerClick } from '@kovojs/headless-ui/toggle';
export const Demo = component({
  state: () => ({ count: 0, onChange: null }),
  render: () => <button onClick={() => {
    toggleTriggerClick(event, { pressed: false }, { onPressedChange: ${callback} });
  }}>Run</button>,
});
`),
      ).not.toEqual([]);
    },
  );

  it('rejects callback-bearing options even for an exact reviewed framework export', () => {
    expect(
      kv449(`
import { toggleTriggerClick } from '@kovojs/headless-ui/toggle';
export const Demo = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={() => {
    toggleTriggerClick(event, { pressed: false }, {
      onPressedChange: () => { state.count += 1; },
    });
  }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it('admits exact generated Headless UI summaries and their plain-data result projections', () => {
    expect(
      kv449(`
import { toggleTriggerClick } from '@kovojs/headless-ui/toggle';
export const Demo = component({
  state: () => ({ pressed: false }),
  render: () => <button onClick={() => {
    const result = toggleTriggerClick(event, { pressed: state.pressed });
    if (result) state.pressed = result.pressed;
  }}>Run</button>,
});
`),
    ).toEqual([]);
  });

  it('closes stale Headless UI identities and calls outside the generated exact arity', () => {
    expect(
      kv449(`
import { toggleTriggerClick } from '@kovojs/headless-ui/toggle';
export const Demo = component({
  render: () => <button onClick={() => {
    toggleTriggerClick(event, { pressed: false }, {}, 'stale-extra-argument');
  }}>Run</button>,
});
`),
    ).not.toEqual([]);
    expect(
      kv449(`
import { toggleTriggerClickForged } from '@kovojs/headless-ui/toggle';
export const Demo = component({
  render: () => <button onClick={() => {
    toggleTriggerClickForged(event, { pressed: false });
  }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it('does not confuse import identity with a positional/container security summary', () => {
    expect(
      kv449(`
import { tabsTriggerClick } from '@kovojs/headless-ui/tabs';
export const Demo = component({
  render: () => <button onClick={() => {
    tabsTriggerClick(event, { itemValue: 'x' }, event);
  }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it('rejects every tagged template while ordinary template data stays finite', () => {
    expect(
      kv449(`
export const Demo = component({
  render: () => <button onClick={() => {
    const { ['set' + 'Timeout']: tag } = event.target.ownerDocument.defaultView;
    tag\`globalThis.__kovoPwned = 1\`;
  }}>Run</button>,
});
`),
    ).not.toEqual([]);
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ count: 1, label: '' }),
  render: () => <button onClick={() => {
    state.label = \`count:\${state.count}\`;
  }}>Run</button>,
});
`),
    ).toEqual([]);
  });

  it.each([
    'event.preventDefault()',
    'event.target.focus()',
    "event.target.getAttribute('data-value')",
    'event.target.form?.requestSubmit()',
    'state.value = event.target.value',
  ])('rejects raw event/DOM dispatch that a synthetic event can own-shadow: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ value: '' }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    'state.saved()',
    'state.saved?.()',
    "state['saved']()",
    'state.saved.call(undefined)',
    'state.saved.apply(undefined, [])',
    'state.saved.bind(undefined)()',
    'setTimeout(state.saved, 0)',
    'function invoke(value) { value(); } invoke(state.saved)',
  ])('closes state-derived executable use: %s', (operation) => {
    const diagnostics = kv449(`
export const Demo = component({
  state: () => ({ saved: null }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(
      diagnostics.some((diagnostic) => diagnostic.message.includes('state-derived JSON')),
    ).toBe(true);
  });

  it('keeps closed scalar state methods and JSON insertions in the finite language', () => {
    const diagnostics = kv449(`
export const Demo = component({
  state: () => ({ items: ['b', 'a'], label: 'aba', needle: 'a', open: false, value: 'x' }),
  render: () => <button onClick={() => {
    state.items.push(String(state.value));
    state.open = state.items.includes('a');
    state.label = state.label.replaceAll(String(state.needle), String(state.value));
  }}>Run</button>,
});
`);

    expect(diagnostics).toEqual([]);
  });

  it.each([
    "state.label.replace(item.fn, 'x')",
    "state.label.replace('x', item.fn)",
    "state.label.replaceAll(item.fn, 'x')",
    "state.label.replaceAll('x', item.fn)",
    'state.items.includes(item.fn)',
    'state.items.with(0, item.fn)',
    'state.items.toSpliced(0, 0, item.fn)',
  ])('does not treat reviewed state-call arguments as scalar capture proof: %s', (operation) => {
    const result = compile(`
export const Demo = component({
  state: () => ({ items: [], label: 'a' }),
  render: ({ item }) => <button onClick={() => { ${operation}; }}>Run</button>,
});
`);
    const sources = result.files.map((file) => file.source).join('\n');

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'KV201')).toBe(true);
    expect(sources).not.toContain('data-p-fn');
    expect(sources).not.toContain('ctx.params.fn');
  });

  it.each(["state.label.replace('x', state.saved)", "state.label.replaceAll('x', state.saved)"])(
    'closes state-derived replace executable positions: %s',
    (operation) => {
      expect(
        kv449(`
export const Demo = component({
  state: () => ({ label: 'a', saved: null }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
      ).not.toEqual([]);
    },
  );

  it('accepts explicitly scalarized captured arguments at closed scalar sinks', () => {
    const result = compile(`
export const Demo = component({
  state: () => ({ items: ['a'], label: 'a' }),
  render: ({ item }) => <button onClick={() => {
    state.label = state.label.replaceAll('a', String(item.id));
    state.items.includes(String(item.id));
  }}>Run</button>,
});
`);
    const sources = result.files.map((file) => file.source).join('\n');

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'KV201')).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'KV449')).toBe(false);
    expect(sources).toContain('data-p-id');
    expect(sources).toContain('ctx.params.id');
  });

  it('does not treat an imported helper parameter as scalar without an explicit coercion', () => {
    const result = compile(`
import { tabsTriggerClick } from '@kovojs/headless-ui/tabs';
export const Demo = component({
  render: ({ item }) => <button onClick={() => { tabsTriggerClick(item.fn); }}>Run</button>,
});
`);
    const sources = result.files.map((file) => file.source).join('\n');

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'KV201')).toBe(true);
    expect(sources).not.toContain('data-p-fn');
    expect(sources).not.toContain('ctx.params.fn');
  });

  it.each([
    'state.saved = true && item.fn',
    'state.saved = item.fn ?? null',
    'state.saved = item.enabled ? item.fn : null',
    'const saved = item.fn ?? null; state.saved = saved',
    'state.saved = { nested: item.fn }',
  ])('does not scalarize opaque captures through value-preserving syntax: %s', (operation) => {
    const result = compile(`
export const Demo = component({
  state: () => ({ saved: null }),
  render: ({ item }) => <button onClick={() => { ${operation}; }}>Run</button>,
});
`);
    const sources = result.files.map((file) => file.source).join('\n');

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'KV201')).toBe(true);
    expect(sources).not.toContain('data-p-fn');
    expect(sources).not.toContain('ctx.params.fn');
  });

  it.each([
    "state.saved = event.target.closest('form')",
    'function make() { return () => undefined; } state.saved = make()',
    'function make() { return { value: 1 }; } state.saved = make().value',
    'state.saved = Proxy.revocable({}, {}).proxy',
  ])('rejects opaque call results written into state: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ saved: null }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    "state.items.join({ toString() { state.count += 1; return ','; } })",
    'state.items.slice({ valueOf() { state.count += 1; return 0; } })',
    "state.label.localeCompare('b', undefined, { get sensitivity() { state.count += 1; return 'base'; } })",
    'state.items.map((value) => value)',
  ])('rejects state methods outside the closed scalar vocabulary: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ count: 0, items: ['a'], label: 'a' }),
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it('keeps exact local-array transforms separate from opaque local receivers', () => {
    const reviewed = kv449(`
export const Demo = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={() => {
    const values = [1, 2];
    state.count = values.map((value) => value + 1).length;
  }}>Run</button>,
});
`);
    const opaque = kv449(`
export const Demo = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={() => {
    const values = event.detail;
    state.count = values.map((value) => value).length;
  }}>Run</button>,
});
`);

    expect(reviewed).toEqual([]);
    expect(opaque).not.toEqual([]);
  });

  it('keeps state/event roots tied to lexical scope rather than same-spelled locals', () => {
    const diagnostics = kv449(`
export const Demo = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={() => {
    const values = [1];
    state.count = values.map((state) => state + 1).length;
    { const event = 'local'; String(event); }
  }}>Run</button>,
});
`);

    expect(diagnostics).toEqual([]);
  });

  it.each([
    '[state.count] = [1]',
    '({ value: state.count } = { value: 1 })',
    'state[key] = 1',
    'delete state[key]',
    'state.items.push(...event.detail)',
  ])('rejects computed, destructured, and spread-protocol state operations: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ count: 0, items: [] }),
  render: () => <button onClick={() => { const key = 'count'; ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    'void state[key]',
    'if (state[key]) state.open = true',
    'const model = state; void model[key]',
  ])('rejects computed state reads: %s', (operation) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ open: false }),
  render: () => <button onClick={() => { const key = 'open'; ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each(['event.detail', 'event.clientX', 'event.data'])(
    'does not treat raw event field names as JSON scalar proof: %s',
    (eventValue) => {
      expect(
        kv449(`
export const Demo = component({
  state: () => ({ saved: null }),
  render: () => <button onClick={() => { state.saved = ${eventValue}; }}>Run</button>,
});
`),
      ).not.toEqual([]);
    },
  );

  it.each([
    ['async handler', 'async () => { state.count += 1; }'],
    ['await', 'async () => { await state.count; }'],
    ['returned thenable', '() => ({ then() { state.count += 1; } })'],
    ['explicit value return', '() => { return event.detail; }'],
  ])('rejects %s outside synchronous-void handler semantics', (_label, handler) => {
    const diagnostics = kv449(`
export const Demo = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={${handler}}>Run</button>,
});
`);

    expect(diagnostics).not.toEqual([]);
  });

  it('omits a rejected async root instead of emitting await into the synchronous client ABI', () => {
    const result = compile(`
export const Demo = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={async () => { await state.count; }}>Run</button>,
});
`);
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'KV449')).toBe(true);
    expect(clientSource).toContain('browser handler omitted from synchronous output');
    expect(clientSource).not.toContain('await state.count');
  });

  it.each([
    ['top-level await', 'await Promise.resolve()'],
    ['top-level yield', 'yield 1'],
  ])('omits rejected %s syntax from the synchronous diagnostic artifact', (_label, body) => {
    const result = compile(`
export const Demo = component({
  render: () => <button onClick={() => { ${body}; }}>Run</button>,
});
`);
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'KV449')).toBe(true);
    expect(clientSource).toContain('browser handler omitted from synchronous output');
    expect(clientSource).not.toContain(body);
  });

  it.each([
    'state.saved = helper',
    'state.saved = globalThis.fetch',
    'state.saved = { nested: [true ? helper : null] }',
    'state.items.push(helper)',
    'state.items.unshift(helper)',
    'state.items.splice(0, 0, helper)',
    'state.items.fill(helper)',
  ])('closes executable values inserted into state: %s', (write) => {
    const diagnostics = kv449(`
function helper() { return 1; }
export const Demo = component({
  state: () => ({ items: [], saved: null }),
  render: () => <button onClick={() => { ${write}; }}>Run</button>,
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.message.includes(
            "outside the compiler's closed JSON/scalar state vocabulary",
          ) ||
          diagnostic.message.includes('is not a reviewed callable data method') ||
          diagnostic.message.includes('outside the closed own-data/scalar vocabulary'),
      ),
    ).toBe(true);
  });

  it.each([
    [
      'imported executable',
      "import { tabsTriggerClick } from '@kovojs/headless-ui/tabs';",
      'state.saved = tabsTriggerClick',
    ],
    [
      'nested callable shadow container',
      'const helpers = { map(value) { return value; } };',
      'state.saved = { map: helpers.map }',
    ],
  ])('closes %s written to state', (_label, setup, write) => {
    const diagnostics = kv449(`
${setup}
export const Demo = component({
  state: () => ({ saved: null }),
  render: () => <button onClick={() => { ${write}; }}>Run</button>,
});
`);

    expect(diagnostics).not.toEqual([]);
  });

  it('does not let a state write terminate element-param proof before executable state use', () => {
    const result = compile(`
export const Demo = component({
  state: () => ({ saved: null }),
  render: ({ item }) => <button onClick={() => {
    state.saved = item.fn;
    state.saved();
  }}>Run</button>,
});
`);
    const sources = result.files.map((file) => file.source).join('\n');

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'KV201')).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'KV449')).toBe(true);
    expect(sources).not.toContain('data-p-fn');
    expect(sources).not.toContain('ctx.params.fn');
  });

  it.each([
    'const carrier = new Proxy({}, {}); state.saved = carrier',
    'const carrier = Proxy.revocable({}, {}); state.saved = carrier.proxy',
  ])('statically excludes direct Proxy construction from handler state: %s', (write) => {
    expect(
      kv449(`
export const Demo = component({
  state: () => ({ saved: null }),
  render: () => <button onClick={() => { ${write}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it('rejects parser-proven non-JsonValue component initial state', () => {
    const diagnostics = kv449(`
const helper = () => 1;
export const Demo = component({
  state: () => ({ nested: { saved: helper }, missing: undefined }),
  render: () => <button>Run</button>,
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain('component state initializer');
    expect(diagnostics[0]?.message).toContain('cannot inhabit JsonValue');
  });

  it.each([
    ['raw DOM property assignment', "event.target.innerHTML = '<img src=x onerror=alert(1)>'"],
    ['never-listed DOM method', "event.target.replaceChildren('owned')"],
    ['computed DOM method', 'event.target[action]()'],
    ['raw browser-global method', "document.body.insertAdjacentHTML('beforeend', html)"],
    ['raw storage capability', "localStorage.setItem('token', token)"],
  ])('rejects %s because it is outside the operation set', (_label, operation) => {
    const diagnostics = kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain(
      'Security-critical operation is outside the compiler-owned finite IR.',
    );
  });

  it.each([
    ['innerHTML assignment', "event.target.innerHTML = '<strong>owned</strong>'"],
    ['outerHTML assignment', "event.target.outerHTML = '<strong>owned</strong>'"],
    ['direct eval', "eval('owned()')"],
    ['string setTimeout', "setTimeout('owned()', 0)"],
    ['string setInterval', "setInterval('owned()', 0)"],
    ['document.write', "document.write('<strong>owned</strong>')"],
    ['document.writeln', "document.writeln('<strong>owned</strong>')"],
    ['Function constructor', "new Function('return 1')"],
  ])('preserves the historical TASK B closed verdict for %s', (_label, operation) => {
    const diagnostics = kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain(
      'Security-critical operation is outside the compiler-owned finite IR.',
    );
  });

  it.each([
    ['raw document alias', "const doc = document; doc.body.insertAdjacentHTML('beforeend', html)"],
    ['raw storage alias', "const storage = localStorage; storage.setItem('token', token)"],
    [
      'extracted DOM method alias',
      "const target = event.target; const replace = target.replaceChildren; replace('owned')",
    ],
    [
      'destructured DOM method alias',
      "const { replaceChildren } = event.target; replaceChildren('owned')",
    ],
    [
      'mutable DOM receiver transfer',
      "let target = {}; target = event.target; target.replaceChildren('owned')",
    ],
    [
      'container-carried DOM receiver',
      "const box = { target: event.target }; box.target.replaceChildren('owned')",
    ],
    [
      'constructor-carried DOM receiver',
      "const box = new Map([['target', event.target]]); box.get('target').replaceChildren('owned')",
    ],
    [
      'generic reflective DOM mutation',
      "Object.assign(event.target, { innerHTML: '<img src=x onerror=alert(1)>' })",
    ],
    [
      'unreviewed global namespace mutation',
      "Reflect.set(event.target, 'innerHTML', '<img src=x onerror=alert(1)>')",
    ],
    ['local helper authority transfer', 'function consume(_value) {} consume(event.target)'],
    [
      'local member-helper authority transfer',
      'const helper = { consume(_value) {} }; helper.consume(event.target)',
    ],
  ])('closes %s across browser authority aliases and containers', (_label, operation) => {
    expect(
      kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    `setTimeout(() => { state.value = 'ready'; }, 0);`,
    `const model = state; setTimeout(() => { model.value = 'ready'; }, 0);`,
    `const value = String(state.value); setTimeout(() => { void value; }, 0);`,
    `const [value] = [String(state.value)]; setTimeout(() => { void value; }, 0);`,
    `const { value } = { value: String(state.value) }; setTimeout(() => { void value; }, 0);`,
    `const { box: [value] } = { box: [String(state.value)] }; setTimeout(() => { void value; }, 0);`,
    `const [...values] = [String(state.value)]; setTimeout(() => { void values; }, 0);`,
    `const { value, ...rest } = { value: String(state.value), other: 'safe' }; setTimeout(() => { void rest; }, 0);`,
    `const holder = [String(state.value)]; const [value] = holder; setTimeout(() => { void value; }, 0);`,
    `const [value] = [String(state.value)]; const box = { value }; setTimeout(() => { void box.value; }, 0);`,
    `const box: string[] = []; box.push(String(state.value)); setTimeout(() => { void box[0]; }, 0);`,
    `function later() { state.value = 'ready'; } setTimeout(later, 0);`,
  ])('rejects deferred state access without a queued state transaction: %s', (operation) => {
    const result = compile(`
export const Demo = component({
    state: () => ({ value: '' }),
    render: () => <input onInput={() => {
      ${operation}
  }} />,
});
`);
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');
    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'without a queued state transaction',
    );
  });

  it.each([
    `const box = {}; Object.assign(box, { value: String(state.value) });
     setTimeout(() => { void box.value; }, 0);`,
    `const box = {}; Object.assign(box, { nested: { value: String(state.value) } });
     setTimeout(() => { void box.nested.value; }, 0);`,
    `const box = ['safe']; Object.assign(box, { 0: String(state.value) });
     setTimeout(() => { void box[0]; }, 0);`,
    `const box = {}; Object.assign(box, state);
     setTimeout(() => { void box.value; }, 0);`,
    `const box = {}; const other = {};
     Object.assign(true ? box : other, { value: String(state.value) });
     setTimeout(() => { void box.value; }, 0);`,
    `const box = {}; Object.assign((0, box), { value: String(state.value) });
     setTimeout(() => { void box.value; }, 0);`,
    `const box = {}; Object.assign(({ box }).box, { value: String(state.value) });
     setTimeout(() => { void box.value; }, 0);`,
  ])('closes Object.assign state-derived timer carriers: %s', (operation) => {
    const diagnostics = browserHandlerBoundaryDiagnostics(operation);
    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toMatch(
      /Object\.assign|without a queued state transaction/u,
    );
  });

  it.each([
    [`const box = {}; Object.assign(box, item.fn);`, '{ item }'],
    [`const box = {}; function source() { return {}; } Object.assign(box, source());`, ''],
    [`let box = {}; Object.assign(box, state);`, ''],
    [`const box = {}; const alias = box; Object.assign(alias, state);`, ''],
    [`Object.assign(box, state); const box = {};`, ''],
  ])('requires exact Object.assign source and destination facts: %s', (operation, renderInput) => {
    expect(browserHandlerBoundaryDiagnostics(operation, renderInput)).not.toEqual([]);
  });

  it('retains exact synchronous Object.assign over closed local data', () => {
    expect(
      browserHandlerBoundaryDiagnostics(
        `const box = {};
         Object.assign(box, { value: String(state.value) });
         void box.value;`,
      ),
    ).toEqual([]);
  });

  it.each([
    `const box = {}; state.saved = box;`,
    `const box = {}; state.saved = { box };`,
    `const box = {}; state.saved = { outer: [{ box }] };`,
    `const box = {}; state.saved = [box];`,
    `const box = {}; const wrapper = { box }; state.saved = wrapper;`,
    `const box = {}; const holder = { box }; state.saved = holder.box;`,
    `const box = {}; state.saved = true ? box : {};`,
    `const box = {}; state.saved = box ?? {};`,
    `const run = () => { state.count += 1; }; state.saved = run;`,
    `const box = {}; state.items.push(box);`,
    `const box = {}; state.saved = box; Object.assign(box, { admin: true });`,
    `const box = {}; state.saved = box; box.admin = true;`,
    `const box = {}; state.saved = box; setTimeout(() => { void box.admin; }, 0);`,
    `const box = {}; state.saved = box;
     [box].map((entry) => { setTimeout(() => { void entry.admin; }, 0); });`,
  ])('rejects local reference identity retained by a state write: %s', (operation) => {
    const diagnostics = browserHandlerBoundaryDiagnostics(operation);
    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'cannot retain a local object/function identity',
    );
  });

  it.each([
    `const box = {}; state.items.splice(0, 0, box);`,
    `const box = {}; state.items.fill(box);`,
  ])('keeps unreviewed state container mutators closed: %s', (operation) => {
    const diagnostics = browserHandlerBoundaryDiagnostics(operation);
    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'is not a reviewed callable data method',
    );
  });

  it.each([
    `const boxes = [{}]; state.saved = boxes.at(0);`,
    `const boxes = [{}]; state.saved = boxes.slice(0)[0];`,
    `const boxes = [{}]; state.saved = boxes.map((box) => box);`,
  ])('rejects opaque local-array return identity at a state write: %s', (operation) => {
    const diagnostics = browserHandlerBoundaryDiagnostics(operation);
    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      "outside the compiler's closed JSON/scalar state vocabulary",
    );
  });

  it('retains fresh recursive JSON and proven scalars at exact state-write sinks', () => {
    expect(
      browserHandlerBoundaryDiagnostics(`
        const label = String(state.value);
        const holder = { label: 'safe' };
        state.saved = { nested: [{ label }], prior: state.saved };
        state.items.push({ nested: [{ label }] });
        state.value = holder.label;
      `),
    ).toEqual([]);
  });

  it.each([
    `Object.freeze(state);`,
    `Object.freeze(state.saved);`,
    `const model = state; Object.freeze(model);`,
    `Object.freeze(true ? state.saved : {});`,
  ])('rejects descriptor mutation of handler state: %s', (operation) => {
    const diagnostics = browserHandlerBoundaryDiagnostics(operation);
    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'Object.freeze cannot change handler-state object identity or descriptors',
    );
  });

  it('retains Object.freeze for an unrelated closed local object', () => {
    expect(
      browserHandlerBoundaryDiagnostics(
        `const box = { value: 'safe' }; Object.freeze(box); void box.value;`,
      ),
    ).toEqual([]);
  });

  it.each([
    `let box = {}; Object.assign(box, { value: 'safe' });`,
    `const box = {}; const alias = box; Object.assign(alias, { value: 'safe' });`,
    `function destination() { return {}; } Object.assign(destination(), { value: 'safe' });`,
  ])('rejects Object.assign without an exact fresh destination: %s', (operation) => {
    const diagnostics = browserHandlerBoundaryDiagnostics(operation);
    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'Object.assign requires one exact fresh handler-local destination',
    );
  });

  it.each([
    `const box = {}; Object.assign(box, { value: String(state.value) });
     [box].map((entry) => { setTimeout(() => { void entry.value; }, 0); });`,
    `const box = {}; const leaked = {};
     Object.assign(box, { value: String(state.value) });
     [box].map((entry) => { leaked.value = entry.value; });
     setTimeout(() => { void leaked.value; }, 0);`,
    `const box = {}; const values = [box];
     Object.assign(box, { value: String(state.value) });
     values.map((entry) => { setTimeout(() => { void entry.value; }, 0); });`,
  ])('closes Object.assign carriers across reviewed local-array parameters: %s', (operation) => {
    const diagnostics = browserHandlerBoundaryDiagnostics(operation);
    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.map((diagnostic) => diagnostic.message).join('\n')).toContain(
      'local array map receivers cannot carry state-derived handler data',
    );
  });

  it.each([
    `const box = [() => { state.count += 1; }]; box[0]();`,
    `const box = [() => { state.count += 1; }]; const key = 0; box[key]();`,
    `([() => { state.count += 1; }][0])();`,
    `const box = { run: () => { state.count += 1; } }; box['run']();`,
  ])('keeps local callable containers closed: %s', (operation) => {
    expect(browserHandlerBoundaryDiagnostics(operation)).not.toEqual([]);
  });

  it.each([
    `const box = {}; Object.assign(box, { run: item.fn }); box.run();`,
    `const box = [item.fn]; box[0]();`,
    `const box = { run: item.fn }; Reflect.get(box, 'run')();`,
  ])('keeps captured callable containers closed: %s', (operation) => {
    expect(browserHandlerBoundaryDiagnostics(operation, '{ item }')).not.toEqual([]);
  });

  it.each([
    `const box = {}; Object.assign(box, { run: event.detail }); box.run();`,
    `const box = {}; Object.assign(box, { value: String(event.detail) }); void box.value;`,
    `const box = { value: event.detail }; Object.values(box)[0]();`,
  ])('keeps event-detail laundering closed: %s', (operation) => {
    expect(browserHandlerBoundaryDiagnostics(operation)).not.toEqual([]);
  });

  it.each([
    `const outcome = Object.assign({}, { then() { state.count += 1; } }); return outcome;`,
    `const outcome = { then: () => { state.count += 1; } }; return true ? outcome : null;`,
    `const outcome = [null, { then() { state.count += 1; } }]; return outcome[1];`,
  ])('keeps thenable return laundering closed: %s', (operation) => {
    expect(browserHandlerBoundaryDiagnostics(operation)).not.toEqual([]);
  });

  it.each([
    `{ const event = { detail() { state.count += 1; } }; event.detail(); }`,
    `{ const state = { saved() {} }; state.saved(); }`,
    `{ const String = (value) => value; state.saved = String(event.detail); }`,
    `{ const Object = { assign(_target, source) { return source; } };
       Object.assign({}, event.detail); }`,
  ])('keeps finite handler identities lexical: %s', (operation) => {
    expect(browserHandlerBoundaryDiagnostics(operation)).not.toEqual([]);
  });

  it.each([
    ['direct string timer', "setTimeout('owned()', 0)"],
    ['timer alias', 'const later = setInterval; later(`owned()`, 0)'],
    ['global timer member', 'globalThis.setTimeout(`owned-${input}`, 0)'],
  ])('closes %s through the finite browser timer operation', (_label, operation) => {
    const diagnostics = kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain('semantic root=serialized-browser-handler:onClick@');
    expect(diagnostics[0]?.message).toContain('transfers=<direct>');
    expect(diagnostics[0]?.message).toContain('string timer callbacks execute source text');
    expect(diagnostics[0]?.message).toContain('verdict=closed:unsupported-authority-use');
  });

  it('closes a captured unknown receiver mutation instead of silently treating it as scalar code', () => {
    const diagnostics = kv449(`
const element = document.createElement('div');
export const Demo = component({
  render: () => <button onClick={() => { element.innerHTML = '<script>owned</script>'; }}>Run</button>,
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain('browser assignment element.innerHTML');
    expect(diagnostics[0]?.message).toContain('verdict=closed:opaque-transfer');
  });

  it('accepts exact structured server operations and named justified exceptional doors', () => {
    const diagnostics = kv449(`
import { trustedHtml } from '@kovojs/browser';
import { sql, trustedSql } from '@kovojs/drizzle';
import { endpoint } from '@kovojs/server';

export const report = endpoint('/report', {
  async handler(_input, ctx) {
    await ctx.fetch('https://api.example.test/report');
    await ctx.db.execute(trustedSql(sql\`select 1\`, { justification: 'reviewed report query' }));
    ctx.headers.set('Cache-Control', 'no-store');
    ctx.setCookie('seen', '1');
    return Response.json({ html: trustedHtml('<strong>ok</strong>', { reason: 'static markup' }) });
  },
});
`);

    expect(diagnostics).toEqual([]);
  });

  it('accepts exact reviewed command and module-scope storage capability doors', () => {
    const diagnostics = kv449(`
import { cmd, commandAllowlist, runCommand } from '@kovojs/server/command'
import { createFileSystemStorage } from '@kovojs/core/storage'
import { mutation } from '@kovojs/server'
import { publicScopedKey } from '@kovojs/core';
const allow = commandAllowlist(['/usr/bin/true'], { justification: 'fixed health probe' });
const command = cmd('/usr/bin/true', [], { allow });
const storage = createFileSystemStorage({ root: '/srv/kovo-static' });
export const verify = mutation({
  async handler() {
    await runCommand(command);
    await storage.stat(publicScopedKey('fixed-key'));
    return { ok: true };
  },
});
`);

    expect(diagnostics).toEqual([]);
  });

  // @kovo-security-certifies KV450 finite-scoped-key-sink-provenance
  it('proves exact scoped-key constructors at every non-database stateful key position', () => {
    const result = compile(`
import { createFileSystemStorage } from '@kovojs/core/storage'
import { mutation, respond } from '@kovojs/server'
import { publicScopedKey } from '@kovojs/core'
import { scopedKey } from '@kovojs/server/storage-keys'
import { task } from '@kovojs/server/tasks';
const storage = createFileSystemStorage({ root: '/srv/kovo-static' });
export const followup = task('followup', {
  async run(args, ctx) {
    const owner = ctx.actAs(args.ownerId);
    const ownerKey = owner.stateKey(args.key);
    await storage.put(ownerKey, 'done');
    await ctx.schedule(followup, args, { key: ctx.systemStateKey('singleton') });
  },
});
export const verify = mutation({
  async handler(input, request, context) {
    const ownerKey = scopedKey(request, input.key);
    const sharedKey = publicScopedKey('public-receipt');
    await storage.get(ownerKey);
    await storage.stat(sharedKey);
    await storage.stream(ownerKey);
    await storage.delete(sharedKey);
    await context.signUrl({ expiresIn: 1_000, key: ownerKey });
    await request.schedule(followup, input, { key: sharedKey });
    return respond.storedFile(storage, ownerKey);
  },
});
`);

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV450')).toEqual([]);
  });

  it('rejects raw, cast, forged, and runtime-selected keys at every stateful sink family', () => {
    const diagnostics = kv450(`
import { createFileSystemStorage } from '@kovojs/core/storage'
import { mutation, respond } from '@kovojs/server'
import { task } from '@kovojs/server/tasks'
import { type ScopedKey } from '@kovojs/core';
const storage = createFileSystemStorage({ root: '/srv/kovo-static' });
const followup = task('followup', { async run() {} });
export const verify = mutation({
  async handler(input, request, context) {
    const forged = { frame: input.key } as unknown as ScopedKey;
    await storage.get(input.key);
    await context.signUrl({ key: input.key as ScopedKey });
    await request.schedule(followup, input, { key: forged });
    return respond.storedFile(storage, forged);
  },
});
`);

    expect(diagnostics).toHaveLength(4);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('storage.get requires a key derived'),
        expect.stringContaining('context.signUrl requires a key derived'),
        expect.stringContaining('request.schedule requires a key derived'),
        expect.stringContaining('respond.storedFile requires a key derived'),
      ]),
    );
  });

  it('fails closed when signUrl or schedule options can hide or replace a key', () => {
    const diagnostics = kv450(`
import { mutation } from '@kovojs/server'
import { task } from '@kovojs/server/tasks';
const followup = task('followup', { async run() {} });
export const verify = mutation({
  async handler(input, request, context) {
    const selected = input.signOptions;
    await context.signUrl(selected);
    await request.schedule(followup, input, { afterMs: 10, ...input.scheduleOptions });
  },
});
`);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.message).toContain(
      'options must be a finite object whose key posture is statically closed',
    );
    expect(diagnostics[1]?.message).toContain(
      'options must be a finite object whose key posture is statically closed',
    );
  });

  // @kovo-security-classifier-corpus C13 finite-ir-reviewed-data-doors
  it('accepts exact reviewed secret, raw SQL, table-alias, and managed-read operations', () => {
    const diagnostics = kv449Project(
      `
import { DeclassifyPolicy, secret, trustedReveal } from '@kovojs/core/security';
import { sql, trustedSql } from '@kovojs/drizzle';
import { endpoint } from '@kovojs/server'
import { declareSecretReadCapability } from '@kovojs/server/secret-reading';
import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { accounts, items } from './schema.js';

export const report = endpoint('/report', {
  db: true,
  async handler(_request, context) {
    const scoped = await context.actAs('reviewed-fixture-principal');
    const db = scoped.db.read;
    const owned = alias(accounts, 'reviewed_accounts');
    const statement = trustedSql(sql.raw('select id, classified from accounts'), {
      justification: 'reviewed static secret read',
    });
    declareSecretReadCapability(statement, {
      columns: ['classified'],
      justification: 'review the classified fixture value on the server',
      source: 'accounts.classified',
      table: 'accounts',
    });
    const rawRows = await context.db.rawRead(statement, { reads: ['accounts'] });
    const rows = await db
      .select({ classified: owned.classified, id: owned.id })
      .from(owned)
      .innerJoin(items, eq(items.accountId, owned.id))
      .union(db.select({ classified: accounts.classified, id: accounts.id }).from(accounts));
    const reviewed = trustedReveal(
      secret(rows[0]?.classified ?? rawRows[0]?.classified),
      DeclassifyPolicy.forTrustedReveal({
        ownerScope: 'application',
      }),
    );
    return Response.json({ reviewed });
  },
});
`,
      [
        {
          fileName: 'src/schema.ts',
          source: `
import { pgTable, text } from 'drizzle-orm/pg-core';
export const accounts = pgTable('accounts', {
  classified: text('classified').notNull(),
  id: text('id').primaryKey(),
});
export const items = pgTable('items', {
  accountId: text('account_id').notNull(),
  id: text('id').primaryKey(),
});
`,
        },
      ],
    );

    expect(diagnostics).toEqual([]);
  });

  // @kovo-security-classifier-corpus C13 declassification-robustness
  it.each([
    [
      'attacker-controlled enabling condition',
      `if (input.expose) {
         return trustedReveal(secret('server-owned'), DeclassifyPolicy.forTrustedReveal({
           ownerScope: 'application',
         }));
       }
       return { reviewed: false };`,
    ],
    [
      'attacker-controlled released value',
      `return trustedReveal(secret(input.value), DeclassifyPolicy.forTrustedReveal({
         ownerScope: 'application',
       }));`,
    ],
  ])('rejects a declassification with an %s', (_label, statement) => {
    const diagnostics = kv449(`
import { DeclassifyPolicy, secret, trustedReveal } from '@kovojs/core/security';
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler(input) {
    ${statement}
  },
});
`);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('declassification');
  });

  // @kovo-security-classifier-corpus C13 finite-ir-declared-secret-raw-read
  it('keeps declared secret reads on managed rawRead and closes legacy all/execute spellings', () => {
    expect(
      kv449(`
import { sql, trustedSql } from '@kovojs/drizzle';
import { declareSecretReadCapability } from '@kovojs/server/secret-reading'
import { query } from '@kovojs/server';
export const report = query({
  async load(_input, context) {
    const statement = trustedSql(sql.raw('select id, classified from accounts'), {
      justification: 'reviewed static secret read',
    });
    declareSecretReadCapability(statement, {
      columns: ['classified'],
      justification: 'review the classified fixture value on the server',
      source: 'accounts.classified',
      table: 'accounts',
    });
    const items = await context.db.rawRead(statement, { reads: ['accounts'] });
    return { items };
  },
});
`),
    ).toEqual([]);

    for (const source of [
      `
import { sql, trustedSql } from '@kovojs/drizzle';
import { declareSecretReadCapability } from '@kovojs/server/secret-reading'
import { query } from '@kovojs/server';
export const report = query({ async load(_input, context) {
  const statement = trustedSql(sql.raw('select id, classified from accounts'), { justification: 'reviewed' });
  declareSecretReadCapability(statement, { columns: ['classified'], justification: 'reviewed', source: 'accounts.classified', table: 'accounts' });
  return context.db.all(statement, undefined);
} });
`,
      `
import { sql, trustedSql } from '@kovojs/drizzle';
import { declareSecretReadCapability } from '@kovojs/server/secret-reading'
import { query } from '@kovojs/server';
export const report = query({ async load(_input, context) {
  const statement = trustedSql(sql.raw('select id, classified from accounts'), { justification: 'reviewed' });
  declareSecretReadCapability(statement, { columns: ['classified'], justification: 'reviewed', source: 'accounts.classified', table: 'accounts' });
  return context.db.write.all(statement);
} });
`,
      `
import { sql, trustedSql } from '@kovojs/drizzle';
import { declareSecretReadCapability } from '@kovojs/server/secret-reading'
import { query } from '@kovojs/server';
export const report = query({ async load(_input, context) {
  const statement = trustedSql(sql.raw('select id, classified from accounts'), { justification: 'reviewed' });
  declareSecretReadCapability(statement, { columns: ['classified'], justification: 'reviewed', source: 'accounts.classified', table: 'accounts' });
  return context.db.all(statement);
} });
`,
      `
import { sql, trustedSql } from '@kovojs/drizzle';
import { declareSecretReadCapability } from '@kovojs/server/secret-reading'
import { query } from '@kovojs/server';
export const report = query({ async load(_input, context) {
  const statement = trustedSql(sql.raw('select id, classified from accounts'), { justification: 'reviewed' });
  declareSecretReadCapability(statement, { columns: ['classified'], justification: 'reviewed', source: 'accounts.classified', table: 'accounts' });
  return context.db.execute(statement);
} });
`,
      `
import { sql, trustedSql } from '@kovojs/drizzle';
import { declareSecretReadCapability } from '@kovojs/server/secret-reading'
import { query } from '@kovojs/server';
export const report = query({ async load(_input, context) {
  const statement = trustedSql(sql.raw('select id, classified from accounts'), { justification: 'reviewed' });
  const execute = context.db.execute;
  declareSecretReadCapability(statement, { columns: ['classified'], justification: 'reviewed', source: 'accounts.classified', table: 'accounts' });
  return execute(statement);
} });
`,
    ]) {
      expect(kv449(source)).not.toEqual([]);
    }
  });

  it.each([
    [
      'request-derived sql.raw text',
      `import { sql, trustedSql } from '@kovojs/drizzle';`,
      `return trustedSql(sql.raw(input.statement), { justification: 'dynamic text is not reviewed' });`,
    ],
    [
      'an aliased sql.raw callable',
      `import { sql, trustedSql } from '@kovojs/drizzle';`,
      `const raw = sql.raw;
       return trustedSql(raw('select 1'), { justification: 'aliased raw callable' });`,
    ],
    [
      'a renamed declared-secret capability import',
      `import { declareSecretReadCapability as declareRead } from '@kovojs/server/secret-reading';`,
      `declareRead(statement, { columns: ['classified'], justification: 'renamed', source: 'accounts.classified', table: 'accounts' });`,
    ],
    [
      'a declared-secret lookalike',
      `import { declareSecretReadCapability } from './lookalike.js';`,
      `declareSecretReadCapability(statement, { columns: ['classified'], justification: 'foreign', source: 'accounts.classified', table: 'accounts' });`,
    ],
    [
      'computed declared-secret metadata',
      `import { declareSecretReadCapability } from '@kovojs/server/secret-reading';`,
      `declareSecretReadCapability(statement, { [input.key]: ['classified'], justification: 'computed', source: 'accounts.classified', table: 'accounts' });`,
    ],
    [
      'an aliased trustedReveal import',
      `import { DeclassifyPolicy, trustedReveal as reveal } from '@kovojs/core/security';`,
      `return reveal(input.value, DeclassifyPolicy.forTrustedReveal({ ownerScope: 'application' }));`,
    ],
    [
      'a dynamically defined trustedReveal policy',
      `import { DeclassifyPolicy, trustedReveal } from '@kovojs/core/security';`,
      `return trustedReveal(input.value, DeclassifyPolicy.forTrustedReveal(input.policy));`,
    ],
    [
      'authority passed to trustedReveal',
      `import { DeclassifyPolicy, trustedReveal } from '@kovojs/core/security';`,
      `return trustedReveal(context.db, DeclassifyPolicy.forTrustedReveal({ ownerScope: 'application' }));`,
    ],
    [
      'a policy for the wrong reveal door',
      `import { DeclassifyPolicy, trustedReveal } from '@kovojs/core/security';`,
      `return trustedReveal(input.value, DeclassifyPolicy.forRevealSecret({ ownerScope: 'application', purpose: 'server-computation' }));`,
    ],
    [
      'surplus trustedReveal policy fields',
      `import { DeclassifyPolicy, trustedReveal } from '@kovojs/core/security';`,
      `return trustedReveal(input.value, DeclassifyPolicy.forTrustedReveal({ ownerScope: 'application', purpose: 'public-projection' }));`,
    ],
    [
      'a shorthand trustedReveal policy field',
      `import { DeclassifyPolicy, trustedReveal } from '@kovojs/core/security';`,
      `const ownerScope = 'application'; return trustedReveal(input.value, DeclassifyPolicy.forTrustedReveal({ ownerScope }));`,
    ],
    [
      'an aliased secret constructor',
      `import { secret as box } from '@kovojs/core/security';`,
      `return box(input.value);`,
    ],
    [
      'an extra secret-constructor argument',
      `import { secret } from '@kovojs/core/security';`,
      `return secret(input.value, 'forged');`,
    ],
    [
      'authority passed to the secret constructor',
      `import { secret } from '@kovojs/core/security';`,
      `return secret(context.db);`,
    ],
    [
      'an aliased Drizzle table-alias callable',
      `import { alias } from 'drizzle-orm/pg-core';`,
      `const makeAlias = alias;
       return makeAlias(input.table, 'accounts');`,
    ],
    [
      'a replaced Drizzle table-alias binding',
      `import { alias } from 'drizzle-orm/pg-core';`,
      `alias = input.alias;
       return alias(input.table, 'accounts');`,
    ],
    [
      'a computed managed-read continuation',
      ``,
      `return context.db.select()[input.operation](input.value);`,
    ],
    [
      'authority passed to a managed innerJoin continuation',
      ``,
      `return context.db.select().from(input.table).innerJoin(context.db, input.predicate);`,
    ],
    [
      'a foreign executable passed to a managed union continuation',
      `import { buildForeignQuery } from './lookalike.js';`,
      `return context.db.select().from(input.table).union(buildForeignQuery());`,
    ],
  ])('keeps %s outside the exact reviewed finite-IR doors', (_label, moduleDeclarations, body) => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
${moduleDeclarations}
export const report = endpoint('/report', {
  db: true,
  handler(input, context) {
    const statement = input.statement;
    ${body}
    return Response.json({ ok: true });
  },
});
`),
    ).not.toEqual([]);
  });

  it('keeps lookalike, aliased, mutable, and request-time capability doors closed', () => {
    expect(
      kv449(`
import { runCommand } from 'foreign-command-package';
import { mutation } from '@kovojs/server';
export const verify = mutation({ handler() { return runCommand(command); } });
`),
    ).not.toEqual([]);
    expect(
      kv449(`
import { mutation } from '@kovojs/server'
import { runCommand } from '@kovojs/server/command';
const invoke = runCommand;
export const verify = mutation({ handler() { return invoke(command); } });
`),
    ).not.toEqual([]);
    expect(
      kv449(`
import { createFileSystemStorage } from '@kovojs/core/storage'
import { mutation } from '@kovojs/server';
let storage = createFileSystemStorage({ root: '/srv/kovo-static' });
storage = replacement;
export const verify = mutation({ handler() { return storage.stat('fixed-key'); } });
`),
    ).not.toEqual([]);
    expect(
      kv449(`
import { createFileSystemStorage } from '@kovojs/core/storage'
import { mutation } from '@kovojs/server';
export const verify = mutation({
  handler(input) {
    const storage = createFileSystemStorage({ root: input.root });
    return storage.stat('fixed-key');
  },
});
`),
    ).not.toEqual([]);
  });

  it('treats an exact raw endpoint Response as a reviewed outcome, not escaped authority', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler() {
    const response = new Response('ok', {
      headers: { 'Cache-Control': 'no-store' },
    });
    return response;
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain(
      '{"door":"Response","kind":"server.response.raw","target":"new Response","justification":"endpoint access/CSRF posture"}',
    );
  });

  // @kovo-security-certifies C13 raw-response-refresh-header-closed
  it.each([
    ['direct identifier', "Refresh: '0;url=https://attacker.example/phish'"],
    ['quoted mixed case', "'rEfReSh': ' 0 ; url = https://attacker.example/phish '"],
    ['computed literal', "['REFRESH']: '5'"],
    ['numeric delay and relative URL', "refresh: '5; URL=/account'"],
    ['scheme-relative URL', "Refresh: '0; url=//attacker.example/phish'"],
  ])('closes raw Response init HTTP Refresh through %s', (_label, header) => {
    const diagnostics = kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler() {
    return new Response('blocked', {
      headers: { ${header} },
    });
  },
});
`);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/Response init.*Refresh.*browser navigation/iu),
        }),
      ]),
    );
  });

  it('keeps an exact later safe ResponseInit headers overwrite open', () => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
const badInit = { headers: { Refresh: '0; url=https://attacker.example/phish' } };
export const report = endpoint('/report', {
  handler() {
    return new Response('safe', { ...badInit, headers: { 'X-Safe': 'yes' } });
  },
});
`),
    ).toEqual([]);
  });

  it('keeps an exact later safe ResponseInit spread overwrite open', () => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
const safeInit = { headers: { 'X-Safe': 'yes' } };
export const report = endpoint('/report', {
  handler() {
    return new Response('safe', {
      headers: { Refresh: '0; url=https://attacker.example/phish' },
      ...safeInit,
    });
  },
});
`),
    ).toEqual([]);
  });

  it('closes a later ResponseInit spread that overwrites earlier safe headers with Refresh', () => {
    const diagnostics = kv449(`
import { endpoint } from '@kovojs/server';
const badInit = { headers: { Refresh: '0; url=https://attacker.example/phish' } };
export const report = endpoint('/report', {
  handler() {
    return new Response('blocked', { headers: { 'X-Safe': 'yes' }, ...badInit });
  },
});
`);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/Response init.*Refresh.*browser navigation/iu),
        }),
      ]),
    );
  });

  it.each([
    [
      'immutable init aliases',
      `const headers = { Refresh: '0; url=https://attacker.example/phish' };
       const init = { headers };
       return new Response('blocked', init);`,
    ],
    [
      'Headers tuple input',
      `return new Response('blocked', {
         headers: new Headers([['Refresh', '5; URL=/account']]),
       });`,
    ],
    [
      'Response.json init',
      `return Response.json({ ok: true }, {
         headers: { Refresh: '0; url=//attacker.example/phish' },
       });`,
    ],
  ])('closes HTTP Refresh in %s', (_label, outcome) => {
    const diagnostics = kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler() {
    ${outcome}
  },
});
`);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/Response init.*Refresh.*browser navigation/iu),
        }),
      ]),
    );
  });

  it('classifies exact module and global Response aliases as reviewed endpoint outcomes', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
const RawResponse = Response;
export const report = endpoint('/report', {
  handler(input) {
    return input.global
      ? globalThis.Response.json({ ok: true })
      : new RawResponse('ok');
  },
});
`);
    const rawOperations =
      result.componentGraphFacts[0]?.securityOperations?.filter(
        (operation) => operation.kind === 'server.response.raw',
      ) ?? [];

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(rawOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'globalThis.Response.json' }),
        expect.objectContaining({ target: 'new Response' }),
      ]),
    );
  });

  it.each([
    ['module Response alias', 'const RawResponse = Response;', "return new RawResponse('raw')"],
    [
      'zero-authority helper outcome',
      "function raw() { return new Response('raw'); }",
      'return raw()',
    ],
    [
      'module Response container',
      'const responses = { RawResponse: Response };',
      "return new responses.RawResponse('raw')",
    ],
    [
      'constructor-return helper',
      'function responseConstructor() { return Response; }',
      "return new (responseConstructor())('raw')",
    ],
    [
      'module constructor-return alias',
      'function identity(value) { return value; } const RawResponse = identity(Response);',
      "return new RawResponse('raw')",
    ],
    ['global Response member', '', "return new globalThis.Response('raw')"],
  ])('closes raw mutation Response through %s', (_label, prelude, outcome) => {
    const diagnostics = kv449(`
import { mutation } from '@kovojs/server';
${prelude}
export const update = mutation({
  handler() { ${outcome}; },
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('semantic root='))).toBe(
      true,
    );
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('verdict=closed:'))).toBe(
      true,
    );
  });

  it('keeps scalar request URL projections plain through a local URL parser and helper summary', () => {
    const diagnostics = kv449(`
import { query } from '@kovojs/server';
function page(url) {
  return { target: url.searchParams.get('target') ?? '/' };
}
export const report = query({
  reads: [],
  load(_input, context) {
    return page(new URL(context?.request.url ?? 'http://app.test/'));
  },
});
`);

    expect(diagnostics).toEqual([]);
  });

  it.each([
    ['raw Response from a mutation', "return new Response('raw')"],
    [
      'raw Response hidden in a structured endpoint outcome',
      "return { response: new Response('raw') }",
    ],
    ['raw Response thrown by an endpoint', "throw new Response('raw')"],
    ['server authority passed through a local constructor', 'return new Box(ctx.db)'],
  ])('keeps %s outside the reviewed response-outcome subset', (_label, handlerBody) => {
    const surface = _label.includes('mutation') ? 'mutation' : 'endpoint';
    expect(
      kv449(`
import { endpoint, mutation } from '@kovojs/server';
class Box { constructor(value) { this.value = value; } }
export const report = ${surface}(${surface === 'endpoint' ? "'/report', " : ''}{
  handler(_input, ctx) { ${handlerBody}; },
});
`),
    ).not.toEqual([]);
  });

  it('preserves exact framework identity through namespace exceptional-door imports', () => {
    const result = compile(`
import * as browser from '@kovojs/browser';
import * as drizzle from '@kovojs/drizzle';
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    await ctx.db.execute(drizzle.trustedSql(drizzle.sql\`select 1\`, {
      justification: 'reviewed namespace query',
    }));
    return Response.json({
      html: browser.trustedHtml('<strong>ok</strong>', { reason: 'static namespace markup' }),
    });
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain('"kind":"server.database.trusted-sql"');
    expect(serverSource).toContain('"kind":"server.output.trusted-html"');
  });

  it('closes structured server authority across receiver, scope, and destructured-call aliases', () => {
    const diagnostics = kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, request) {
    const contextAlias = request;
    const database = contextAlias.db;
    const scoped = contextAlias.actAs('owner-1');
    const { fetch: requestOut, headers: responseHeaders } = contextAlias;
    await requestOut('https://api.example.test/report');
    await database.execute('parameterized');
    await scoped.runQuery({ key: 'report/read' }, undefined);
    responseHeaders.set('Cache-Control', 'no-store');
    const RawResponse = Response;
    return RawResponse.json({ ok: true });
  },
});
`);

    expect(diagnostics).toEqual([]);

    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, { fetch: requestOut, db: database, headers }) {
    await requestOut('https://api.example.test/report');
    await database.select();
    headers.append('Vary', 'Accept');
    return Response.json({ ok: true });
  },
});
`),
    ).toEqual([]);
  });

  it.each([
    ['mutable receiver alias', 'let database = ctx.db; await database.execute(query)'],
    [
      'conditional receiver alias',
      'const database = input.useManaged ? ctx.db : input.other; await database.execute(query)',
    ],
    ['computed method alias', 'const execute = ctx.db[input.operation]; await execute(query)'],
    [
      'computed method on a known alias',
      'const database = ctx.db; await database[input.operation]()',
    ],
    [
      'reassigned context alias',
      'let request = ctx; request = input.other; await request.fetch(input.url)',
    ],
  ])('fails closed for %s', (_label, handlerBody) => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(input, ctx) { ${handlerBody}; return Response.json({ ok: true }); },
});
`),
    ).not.toEqual([]);
  });

  it.each([
    [
      'authority assigned into a local alias',
      'let database; database = ctx.db; await database.execute(query)',
    ],
    [
      'authority carried through an object container',
      'const box = { database: ctx.db }; await box.database.execute(query)',
    ],
    ['authority passed to an imported helper', 'await importedHelper({ database: ctx.db })'],
    ['authority returned from a structured handler', 'return { database: ctx.db }'],
  ])('fails closed when %s', (_label, handlerBody) => {
    expect(
      kv449(`
import { importedHelper } from './helper.js';
import { endpoint } from '@kovojs/server';
function consume(_value) { return null; }
export const report = endpoint('/report', {
  async handler(_input, ctx) { ${handlerBody}; return Response.json({ ok: true }); },
});
`),
    ).not.toEqual([]);
  });

  it('enrolls exact same-file authority helpers as reviewed local call edges', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
function consume(_value) { return null; }
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    consume(ctx.db);
    return Response.json({ ok: true });
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain(
      '{"door":"local-call-edge","kind":"server.helper.call","root":"endpoint:/report","target":"local:consume"}',
    );
    expect(result.componentGraphFacts[0]?.securityOperations).toContainEqual({
      door: 'local-call-edge',
      kind: 'server.helper.call',
      root: 'endpoint:/report',
      target: 'local:consume',
    });
  });

  it('keeps authority-returning assertion helpers outside the normalized helper subset', () => {
    const diagnostics = kv449(`
import { query } from '@kovojs/server';
function requireDb(context) {
  if (!context.db) throw new Error('missing managed db');
  return context.db;
}
export const catalog = query('catalog/read', {
  load(_input, context) {
    const db = requireDb(context);
    return db.select();
  },
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(
      diagnostics.some((diagnostic) =>
        diagnostic.message.includes('server capability cannot escape a structured handler outcome'),
      ),
    ).toBe(true);
  });

  it('discharges multi-hop helper edges through bottom-up normalized summaries', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
async function dial(outbound) {
  return outbound('https://api.example.test/report');
}
async function consume(context) {
  const { fetch: outbound } = context;
  return dial(outbound);
}
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    await consume(ctx);
    return Response.json({ ok: true });
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const semanticGraph = result.componentGraphFacts[0]?.securitySemanticGraph;

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain('kovo-security-semantic-graph/v3');
    expect(serverSource).toContain('local:consume[arg0=context]');
    expect(serverSource).toContain('local:dial[arg0=operation:server.egress.request]');
    expect(semanticGraph?.roots).toContainEqual(
      expect.objectContaining({
        binding: expect.objectContaining({
          callback: 'handler',
          callableSpan: expect.objectContaining({
            end: expect.any(Number),
            start: expect.any(Number),
          }),
          factory: 'endpoint',
          factoryCallSpan: expect.objectContaining({
            end: expect.any(Number),
            start: expect.any(Number),
          }),
          root: 'endpoint:/report',
        }),
        helperInvocations: expect.arrayContaining([
          expect.objectContaining({
            authorityInputs: ['arg0=context'],
            callable: 'local:consume',
            callSpan: expect.objectContaining({
              end: expect.any(Number),
              start: expect.any(Number),
            }),
            operationKinds: ['server.egress.request'],
            transfers: ['local:consume[arg0=context]'],
            verdict: 'proved',
          }),
          expect.objectContaining({
            authorityInputs: ['arg0=operation:server.egress.request'],
            callable: 'local:dial',
            operationKinds: ['server.egress.request'],
            transfers: [
              'local:consume[arg0=context]',
              'local:dial[arg0=operation:server.egress.request]',
            ],
            verdict: 'proved',
          }),
        ]),
        root: 'endpoint:/report',
        summaries: expect.arrayContaining([
          expect.objectContaining({
            authorityInputs: ['arg0=operation:server.egress.request'],
            callable: 'local:dial',
            operationKinds: ['server.egress.request'],
            verdict: 'proved',
          }),
          expect.objectContaining({
            authorityInputs: ['arg0=context'],
            callable: 'local:consume',
            operationKinds: ['server.egress.request'],
            verdict: 'proved',
          }),
        ]),
        traces: expect.arrayContaining([
          {
            root: 'endpoint:/report',
            sink: {
              door: 'ctx.fetch',
              kind: 'server.egress.request',
              sliceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
              span: expect.objectContaining({ end: expect.any(Number), start: expect.any(Number) }),
              target: 'outbound',
            },
            transfers: [
              'local:consume[arg0=context]',
              'local:dial[arg0=operation:server.egress.request]',
            ],
            verdict: 'proved',
          },
        ]),
      }),
    );
  });

  it('preserves every authored ctx.fetch sink occurrence in the semantic graph', () => {
    const secondFetch = "    await ctx.fetch('https://api.example.test/two');\n";
    const padding = `    //${' '.repeat(secondFetch.length - 7)}\n`;
    expect(padding).toHaveLength(secondFetch.length);
    const source = (secondLine: string) => `
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    await ctx.fetch('https://api.example.test/one');
${secondLine}    return Response.json({ ok: true });
  },
});
`;
    const onceSource = source(padding);
    const twiceSource = source(secondFetch);
    expect(onceSource).toHaveLength(twiceSource.length);

    const once = compile(onceSource);
    const twice = compile(twiceSource);
    const ctxFetchTraces = (result: ReturnType<typeof compile>) =>
      result.componentGraphFacts[0]?.securitySemanticGraph?.roots[0]?.traces.filter(
        (trace) => trace.verdict === 'proved' && trace.sink.door === 'ctx.fetch',
      ) ?? [];

    expect(once.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(twice.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(ctxFetchTraces(once)).toHaveLength(1);
    expect(ctxFetchTraces(twice)).toHaveLength(2);
    expect(ctxFetchTraces(twice).map((trace) => trace.sink.span)).toEqual([
      expect.objectContaining({ end: expect.any(Number), start: expect.any(Number) }),
      expect.objectContaining({ end: expect.any(Number), start: expect.any(Number) }),
    ]);
    expect(ctxFetchTraces(twice)[0]?.sink.span).not.toEqual(ctxFetchTraces(twice)[1]?.sink.span);
    expect(once.componentGraphFacts).not.toEqual(twice.componentGraphFacts);
  });

  it('binds every semantic-v2 span to authored bytes across structural lowering', () => {
    // SPEC §5.2: semantic proof coordinates belong to the immutable authored source. Style and
    // handler lowering rewrite multiple earlier regions, so facts emitted from the lowered model
    // would point past these exact factory, callback, helper, call, and argument byte ranges.
    const helperSource = `async function dial(outbound, url) {
  return outbound(url);
}`;
    const callSource = `dial(ctx.fetch, 'https://api.example.test/report')`;
    const handlerSource = `async handler(_input, ctx) {
    await ${callSource};
    return Response.json({ ok: true });
  }`;
    const factorySource = `endpoint('/report', {
  ${handlerSource},
})`;
    const source = `
import { component } from '@kovojs/core';
import { endpoint } from '@kovojs/server';
import * as style from '@kovojs/style';

const styles = style.create({
  root: { color: 'teal' },
});

export const Styled = component({
  state: () => ({ active: false }),
  render: () => (
    <button style={styles.root} onClick={() => { state.active = !state.active; }}>Styled</button>
  ),
});

${helperSource}

export const report = ${factorySource};
`;
    const result = compile(source);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const semanticGraph = result.componentGraphFacts[0]?.securitySemanticGraph;
    const root = semanticGraph?.roots.find((candidate) => candidate.root === 'endpoint:/report');
    const invocation = root?.helperInvocations.find(
      (candidate) => candidate.callable === 'local:dial',
    );
    const summary = root?.summaries.find((candidate) => candidate.callable === 'local:dial');

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).not.toContain('style={styles.root}');
    expect(serverSource).toContain(JSON.stringify(semanticGraph));
    expect(root).toBeDefined();
    expect(invocation).toBeDefined();
    expect(summary).toBeDefined();
    expect(
      source.slice(root!.binding.factoryCallSpan.start, root!.binding.factoryCallSpan.end),
    ).toBe(factorySource);
    expect(source.slice(root!.binding.callableSpan.start, root!.binding.callableSpan.end)).toBe(
      handlerSource,
    );
    expect(source.slice(invocation!.callableSpan.start, invocation!.callableSpan.end)).toBe(
      helperSource,
    );
    expect(source.slice(summary!.callableSpan.start, summary!.callableSpan.end)).toBe(helperSource);
    expect(source.slice(invocation!.callSpan.start, invocation!.callSpan.end)).toBe(callSource);
    expect(invocation!.argumentSpans.map((span) => source.slice(span.start, span.end))).toEqual([
      'ctx.fetch',
      "'https://api.example.test/report'",
    ]);
  });

  it('keeps helper summaries context-sensitive to exact authority inputs', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
function inspect(_capability) { return 'ok'; }
export const report = endpoint('/report', {
  handler(_input, ctx) {
    inspect(ctx.db);
    inspect(ctx.storage);
    return Response.json({ ok: true });
  },
});
`);
    const summaries =
      result.componentGraphFacts[0]?.securitySemanticGraph?.roots[0]?.summaries ?? [];

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authorityInputs: ['arg0=database'],
          callable: 'local:inspect',
          operationKinds: [],
          verdict: 'proved',
        }),
        expect.objectContaining({
          authorityInputs: ['arg0=storage'],
          callable: 'local:inspect',
          operationKinds: [],
          verdict: 'proved',
        }),
      ]),
    );
  });

  it('shows root, transfers, sink, and closed reason for helper alias mutation', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
function consume(database, input) {
  let mutable = database;
  mutable = input.other;
  return mutable.select();
}
export const report = endpoint('/report', {
  handler(input, ctx) {
    consume(ctx.db, input);
    return Response.json({ ok: true });
  },
});
`);
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');
    const closed =
      result.componentGraphFacts[0]?.securitySemanticGraph?.roots[0]?.traces.filter(
        (trace) => trace.verdict === 'closed',
      ) ?? [];

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain('semantic root=endpoint:/report');
    expect(diagnostics[0]?.message).toContain('local:consume[arg0=database]');
    expect(diagnostics[0]?.message).toContain('sink=');
    expect(diagnostics[0]?.message).toContain('verdict=closed:');
    expect(closed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'unsupported-authority-use',
          root: 'endpoint:/report',
          transfers: ['local:consume[arg0=database]'],
          verdict: 'closed',
        }),
      ]),
    );
  });

  it('fails closed on recursive helper cycles with an explicit normalized verdict', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
function first(database) { return second(database); }
function second(database) { return first(database); }
export const report = endpoint('/report', {
  handler(_input, ctx) {
    first(ctx.db);
    return Response.json({ ok: true });
  },
});
`);
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('helper-cycle'))).toBe(
      true,
    );
    expect(result.componentGraphFacts[0]?.securitySemanticGraph?.roots[0]?.traces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'helper-cycle', verdict: 'closed' }),
      ]),
    );
  });

  it('propagates query no-write posture through summarized helpers', () => {
    const result = compile(`
import { query } from '@kovojs/server';
function write(database) { return database.insert('catalog'); }
export const catalog = query('catalog/read', {
  load(_input, ctx) { return write(ctx.db); },
});
`);
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain(
      'query loaders cannot perform a managed database write',
    );
    expect(diagnostics[0]?.message).toContain('semantic root=query:catalog/read');
  });

  it('closes arguments-object recovery and deterministic call-depth exhaustion', () => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
function consume(_database) { return arguments[0].select(); }
export const report = endpoint('/report', {
  handler(_input, ctx) { consume(ctx.db); return Response.json({ ok: true }); },
});
`)[0]?.message,
    ).toContain('arguments-object authority recovery');

    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
function consumePlain(_plain) { return 'ok'; }
export const report = endpoint('/report', {
  handler(_input, ctx) { consumePlain('plain', ctx.db); return Response.json({ ok: true }); },
});
`)[0]?.message,
    ).toContain('authority-bearing extra argument');

    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
function consumeRest(_plain, ..._rest) { return 'ok'; }
export const report = endpoint('/report', {
  handler(_input, ctx) { consumeRest('plain', 'also plain', ctx.db); return Response.json({ ok: true }); },
});
`)[0]?.message,
    ).toContain('authority-bearing rest argument');

    const helperCount = 18;
    const helpers = Array.from({ length: helperCount }, (_unused, index) =>
      index === helperCount - 1
        ? `function helper${index}(database) { return database.select(); }`
        : `function helper${index}(database) { return helper${index + 1}(database); }`,
    ).join('\n');
    const diagnostics = kv449(`
import { endpoint } from '@kovojs/server';
${helpers}
export const report = endpoint('/report', {
  handler(_input, ctx) { return helper0(ctx.db); },
});
`);

    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('budget-call-depth'))).toBe(
      true,
    );
  });

  it('closes the normalized semantic node budget with its exact reason', () => {
    const oversizedBody = Array.from({ length: 50_100 }, () => ';').join('\n');
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler() { ${oversizedBody} return Response.json({ ok: true }); },
});
`).some((diagnostic) => diagnostic.message.includes('budget-node-count')),
    ).toBe(true);
  }, 60_000);

  it('closes the normalized semantic operation budget with its exact reason', () => {
    const operations = Array.from({ length: 4_097 }, () => 'ctx.db.select();').join('\n');
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler(_input, ctx) { ${operations} return Response.json({ ok: true }); },
});
`).some((diagnostic) => diagnostic.message.includes('budget-operation-count')),
    ).toBe(true);
  }, 60_000);

  it('closes the normalized semantic summary budget with its exact reason', () => {
    const helperCount = 257;
    const helpers = Array.from(
      { length: helperCount },
      (_unused, index) => `function helper${index}(database) { return database.select(); }`,
    ).join('\n');
    const calls = Array.from(
      { length: helperCount },
      (_unused, index) => `helper${index}(ctx.db);`,
    ).join('\n');
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
${helpers}
export const report = endpoint('/report', {
  handler(_input, ctx) { ${calls} return Response.json({ ok: true }); },
});
`).some((diagnostic) => diagnostic.message.includes('budget-summary-count')),
    ).toBe(true);
  }, 60_000);

  it('reuses normalized semantic summaries without exhausting the summary budget', () => {
    const repeatedCalls = Array.from({ length: 300 }, () => 'read(ctx.db);').join('\n');
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
function read(database) { return database.select(); }
export const report = endpoint('/report', {
  handler(_input, ctx) { ${repeatedCalls} return Response.json({ ok: true }); },
});
`),
    ).toEqual([]);
  }, 60_000);

  it.each([
    ['direct assignment', 'helper = replacement;'],
    ['array destructuring assignment', '[helper] = [replacement];'],
    ['array rest assignment', '[...helper] = [replacement];'],
    ['object shorthand assignment', '({ helper } = { helper: replacement });'],
    ['object property assignment', '({ next: helper } = { next: replacement });'],
    ['object rest assignment', '({ ...helper } = { next: replacement });'],
    ['prefix update', '++helper;'],
    ['postfix update', 'helper++;'],
  ])('keeps %s closed through the conservative source index', (_label, assignment) => {
    // SPEC §6.6 / C13: indexing is a performance repair, not a narrower reassignment classifier.
    // Preserve the old spelling-based closure across every assignment-target shape it recognized.
    const diagnostics = kv449(`
import { endpoint } from '@kovojs/server';
function helper(database) { return database.select(); }
function replacement(_database) { return null; }
${assignment}
export const report = endpoint('/report', {
  handler(_input, ctx) { helper(ctx.db); return Response.json({ ok: true }); },
});
`);

    expect(diagnostics).not.toEqual([]);
  });

  it('preserves indexed declaration multiplicity, order, hoisting, and lexical shadowing', () => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
const helper = (database) => database.select();
const helper = (database) => database.select();
export const report = endpoint('/report', {
  handler(_input, ctx) { helper(ctx.db); return Response.json({ ok: true }); },
});
`),
    ).not.toEqual([]);

    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler(_input, ctx) { helper(ctx.db); return Response.json({ ok: true }); },
});
const helper = (database) => database.select();
`),
    ).not.toEqual([]);

    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
function helper(database) { return database.select(); }
export const report = endpoint('/report', {
  handler(_input, ctx) {
    {
      let helper = (_database) => null;
      helper(ctx.db);
    }
    return Response.json({ ok: true });
  },
});
`),
    ).not.toEqual([]);

    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler(_input, ctx) { helper(ctx.db); return Response.json({ ok: true }); },
});
function helper(database) { return database.select(); }
`),
    ).toEqual([]);
  });

  it.each([
    [
      'function declarations',
      `function helper(database) { return database.select(); }
function helper(database) { return database.select(); }`,
    ],
    [
      'const declarations',
      `const helper = (database) => database.select();
const helper = (database) => database.select();`,
    ],
    [
      'import declarations',
      `import { helper } from 'first-foreign-package';
import { other as helper } from 'second-foreign-package';`,
    ],
  ])('fails closed for duplicate indexed %s', (_label, declarations) => {
    // SPEC §6.6: an indexed lookup must retain the old exact-one-declaration requirement.
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
${declarations}
export const report = endpoint('/report', {
  handler(_input, ctx) { helper(ctx.db); return Response.json({ ok: true }); },
});
`),
    ).not.toEqual([]);
  });

  it('distinguishes hoisted function callables from ordered const callables', () => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler(_input, ctx) { helper(ctx.db); return Response.json({ ok: true }); },
});
function helper(database) { return database.select(); }
`),
    ).toEqual([]);

    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler(_input, ctx) { helper(ctx.db); return Response.json({ ok: true }); },
});
const helper = (database) => database.select();
`),
    ).not.toEqual([]);
  });

  it('indexes exported const and function helper declarations with their original ordering', () => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const helper = (database) => database.select();
export const report = endpoint('/report', {
  handler(_input, ctx) { helper(ctx.db); return Response.json({ ok: true }); },
});
`),
    ).toEqual([]);

    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler(_input, ctx) { helper(ctx.db); return Response.json({ ok: true }); },
});
export function helper(database) { return database.select(); }
`),
    ).toEqual([]);
  });

  it('keeps same-spelling shadow assignments conservatively closing module aliases', () => {
    // The pre-index classifier was deliberately name-wide: even a lexically shadowed assignment
    // closed an authority-bearing module alias. The source index must remain a C13 superset.
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
const RawResponse = Response;
function unrelated() {
  let RawResponse = 'plain';
  RawResponse = 'still plain';
  return RawResponse;
}
export const report = endpoint('/report', {
  handler() { return RawResponse.json({ ok: true }); },
});
`),
    ).not.toEqual([]);
  });

  it('keeps cached module facts immutable across parent, sibling, and root overlays', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
const RawResponse = Response;
function nestedResponse() {
  return RawResponse.json({ nested: true });
}
function first(database) {
  const RawResponse = database;
  nestedResponse();
  return database.select();
}
function second(database) {
  return database.select();
}
export const report = endpoint('/report', {
  handler(_input, ctx) {
    first(ctx.db);
    second(ctx.db);
    return RawResponse.json({ ok: true });
  },
});
export const clean = endpoint('/clean', {
  handler() { return RawResponse.json({ clean: true }); },
});
`);
    const roots = result.componentGraphFacts[0]?.securitySemanticGraph?.roots ?? [];
    const report = roots.find((root) => root.root === 'endpoint:/report');
    const clean = roots.find((root) => root.root === 'endpoint:/clean');

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).not.toEqual([]);
    expect(report?.summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ callable: 'local:first', verdict: 'closed' }),
        expect.objectContaining({ callable: 'local:second', verdict: 'proved' }),
      ]),
    );
    expect(report?.helperInvocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ callable: 'local:nestedResponse', verdict: 'closed' }),
      ]),
    );
    expect(clean?.traces.every((trace) => trace.verdict === 'proved')).toBe(true);
    expect(clean?.traces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: expect.objectContaining({ kind: 'server.response.raw' }),
          verdict: 'proved',
        }),
      ]),
    );
  });

  it.each([
    [
      'operation-function member laundering',
      `const outbound = ctx.fetch.bind(null); await outbound('https://api.example.test')`,
    ],
    [
      'capability member mutation',
      `ctx.fetch.custom = () => null; await ctx.fetch('https://api.example.test')`,
    ],
    ['ignored authority container', `const hidden = { database: ctx.db }; void hidden`],
    [
      'nested callable authority capture',
      `const delayed = () => ctx.db.select(); return Response.json({ delayed: Boolean(delayed) })`,
    ],
  ])('fails closed for %s in normalized server semantics', (_label, handlerBody) => {
    const diagnostics = kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, ctx) { ${handlerBody}; return Response.json({ ok: true }); },
});
`);

    expect(diagnostics).not.toEqual([]);
  });

  it('allows nested plain-data transforms after a reviewed operation result', () => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    const rows = await ctx.db.select();
    const sizes = rows.map((row) => String(row).length);
    return Response.json({ sizes });
  },
});
`),
    ).toEqual([]);
  });

  it('enrolls inline and same-file referenced server roots in emitted manifests', () => {
    const result = compile(`
import { endpoint, mutation, query } from '@kovojs/server'
import { task } from '@kovojs/server/tasks'
import { webhook } from '@kovojs/server/webhooks';

async function loadCatalog(_input, ctx) {
  return ctx.db.select();
}
const saveCatalog = async (_input, request) => {
  await request.db.insert('catalog');
  return { ok: true };
};
function handleStatus() {
  return Response.json({ ok: true });
}
function handleWebhook() {
  return { ok: true };
}
const runCleanup = async () => ({ ok: true });

export const catalog = query('catalog/read', { load: loadCatalog });
export const status = query('status/read', { load() { return { ok: true }; } });
export const save = mutation('catalog/save', { handler: saveCatalog });
export const statusApi = endpoint('/status', { handler: handleStatus });
export const inbound = webhook('/events', { handler: handleWebhook });
export const cleanup = task('catalog/cleanup', { run: runCleanup });
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    for (const target of [
      'query:catalog/read',
      'query:status/read',
      'mutation:catalog/save',
      'endpoint:/status',
      'webhook:/events',
      'task:catalog/cleanup',
    ]) {
      expect(serverSource).toContain(
        `{"door":"handler-root","kind":"server.handler.root","target":"${target}"}`,
      );
    }
    expect(serverSource).toContain('"kind":"server.database.read"');
    expect(serverSource).toContain('"kind":"server.database.write"');
  });

  it.each([
    [
      'imported query load',
      `import { load } from './foreign.js'; export const root = query({ load });`,
    ],
    [
      'reassigned query load',
      `let load = (_input, _ctx) => null; load = (_input, _ctx) => 1; export const root = query({ load });`,
    ],
    [
      'dynamic query definition',
      `const definition = { load(_input, _ctx) { return null; } }; export const root = query(definition);`,
    ],
    [
      'spread mutation definition',
      `const base = {}; function handler() { return null; } export const root = mutation({ ...base, handler });`,
    ],
    ['missing mutation handler', `export const root = mutation({});`],
  ])('fails closed instead of silently dropping an %s root', (_label, declaration) => {
    expect(
      kv449(`
import { mutation, query } from '@kovojs/server';
${declaration}
`),
    ).not.toEqual([]);
  });

  it('rejects managed database writes from an enrolled query root', () => {
    const result = compile(`
import { query } from '@kovojs/server';
export const root = query('catalog/read', {
  async load(_input, ctx) {
    await ctx.db.insert('catalog');
    await ctx.db.write('catalog', { refreshed: true });
    return null;
  },
});
`);
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain(
      'query loaders cannot perform a managed database write',
    );
    expect(result.componentGraphFacts[0]?.securityOperations).toEqual(
      expect.arrayContaining([
        {
          door: 'managed-db',
          kind: 'server.database.write',
          target: 'ctx.db.insert',
        },
        {
          door: 'managed-db',
          kind: 'server.database.write',
          target: 'ctx.db.write',
        },
      ]),
    );
  });

  it('rejects closure-owned storage writes from enrolled query roots', () => {
    const result = compile(`
import { publicScopedKey } from '@kovojs/core';
import { createMemoryStorage } from '@kovojs/core/storage';
import { publicAccess, query } from '@kovojs/server';

const storage = createMemoryStorage();
const storageUpload = {
  upload(key: string, body: string) {
    return storage.put(publicScopedKey(key), body);
  },
};

export const storagePutWriteQuery = query({
  access: publicAccess('storage put write query proof'),
  reads: [],
  async load() {
    await storage.put(publicScopedKey('receipts/query-write-proof.txt'), 'bad');
    return { ok: true };
  },
});
export const storageDeleteWriteQuery = query({
  access: publicAccess('storage delete write query proof'),
  reads: [],
  async load() {
    await storage.delete(publicScopedKey('receipts/query-delete-proof.txt'));
    return { ok: true };
  },
});
export const storageUploadWriteQuery = query({
  access: publicAccess('storage upload write query proof'),
  reads: [],
  async load() {
    await storageUpload.upload('receipts/query-upload-proof.txt', 'bad');
    return { ok: true };
  },
});
`);
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');
    const messages = diagnostics.map((diagnostic) => diagnostic.message);

    expect(diagnostics).toHaveLength(3);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'root=query:finite-security-ir/storage-put-write-query; transfers=<direct>; sink=unresolved, imported, aliased, or foreign server helper storage.put',
        ),
        expect.stringContaining(
          'root=query:finite-security-ir/storage-delete-write-query; transfers=<direct>; sink=unresolved, imported, aliased, or foreign server helper storage.delete',
        ),
        expect.stringContaining(
          'root=query:finite-security-ir/storage-upload-write-query; transfers=local:upload[]; sink=unresolved, imported, aliased, or foreign server helper storage.put',
        ),
      ]),
    );
  });

  it('keeps reviewed operation results as plain helper data rather than capabilities', () => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
function summarize(rows) { return { count: rows.length }; }
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    const rows = await ctx.db.select();
    return Response.json(summarize(rows));
  },
});
`),
    ).toEqual([]);
  });

  it('does not confuse input and local lookalikes with the second-parameter context capability', () => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(ctx, request) {
    const context = { db: { dropEverything() {} } };
    ctx.db.dropEverything();
    context.db.dropEverything();
    await request.db.select();
    return Response.json({ ok: true });
  },
});
`),
    ).toEqual([]);
  });

  it('uses the third mutation parameter as context and keeps the request parameter distinct', () => {
    const result = compile(`
import { mutation } from '@kovojs/server';
export const save = mutation('save', {
  handler(_input, request, context) {
    const requestValue = request.headers.get('x-request-value');
    context.setCookie('seen', '1');
    return requestValue;
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain('"kind":"server.response.cookie"');
    expect(serverSource).not.toContain('"kind":"server.response.header"');
  });

  it('classifies managed mutation-request and explicit principal-scope database operations', () => {
    const result = compile(`
import { endpoint, mutation } from '@kovojs/server';
export const save = mutation('save', {
  handler(_input, request, context) {
    const found = request.db.products.get('p1');
    request.db.read('products', 'p1');
    request.db.write('products', { ...found, stock: 1 });
    context.invalidate(products);
    return found;
  },
});
export const report = endpoint('/report', {
  db: true,
  async handler(_request, context) {
    const scope = await context.actAs('owner-1');
    const rows = await scope.db.read.select().from(products);
    await scope.db.write.insert(products).values({ ownerId: 'owner-1' });
    return Response.json({ rows });
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain('"kind":"server.authority.scope"');
    expect(serverSource).toContain('"kind":"server.database.read"');
    expect(serverSource).toContain('"kind":"server.database.write"');
    expect(serverSource).toContain('"kind":"server.task.compose"');
  });

  it('accepts the starter database chains and exact plain-data identities without widening the finite IR', () => {
    expect(
      kv449Project(
        `
import { mutation, query } from '@kovojs/server'
import { trustedAssign } from '@kovojs/server/write-safety';
import { eq } from 'drizzle-orm';
import { contacts } from './schema.js';

async function writeContact(db, row) {
  const id = crypto.randomUUID();
  await db.insert(contacts).values({
    id: trustedAssign(id, {
      evidence: { digest: 'sha256:${'a'.repeat(64)}', kind: 'test', reference: 'tests/contacts/generated-id' },
      invariant: 'governed-write.authorized-principal',
      why: { kind: 'policy', policy: 'contacts.generated-id/v1' }
    }),
    email: row.email,
  });
}

export const save = mutation('contacts/save', {
  async handler(input, request) {
    const [existing] = await request.db
      .select()
      .from(contacts)
      .where(eq(contacts.email, input.email))
      .limit(1);
    if (!existing) await writeContact(request.db, input);
    return { id: existing?.id ?? null };
  },
});

export const list = query('contacts/list', {
  async load(_input, context) {
    const db = context?.db;
    if (!db) throw new Error('missing managed database');
    return {
      items: await db.select({ id: contacts.id }).from(contacts).orderBy(contacts.id),
    };
  },
});
`,
        [
          {
            fileName: 'src/schema.ts',
            source: `
import { pgTable, text } from 'drizzle-orm/pg-core';
export const contacts = pgTable('contacts', {
  email: text('email').notNull(),
  id: text('id').primaryKey(),
});
`,
          },
        ],
      ),
    ).toEqual([]);
  });

  // @kovo-security-certifies C13 generated-readonly-app-db-finite-ir
  it('accepts only the exact generated readonlyAppDb read chain in the finite server IR', () => {
    const endpointSource = `
import { endpoint, publicAccess } from '@kovojs/server';
import { eq } from 'drizzle-orm';
import { readonlyAppDb } from './db.js';
import { contacts } from './schema.js';

export const taskProofCount = endpoint('/api/task-proof-count', {
  access: publicAccess('public task proof count'),
  auth: { kind: 'none', justification: 'public read-only count' },
  csrf: false,
  csrfJustification: 'read-only GET endpoint',
  method: 'GET',
  async handler() {
    const rows = await readonlyAppDb
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, 'task-proof'))
      .limit(1);
    return Response.json({ count: rows.length });
  },
  reason: 'read-only task proof count',
  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
});
`;
    const schemaSource = `
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const contacts = sqliteTable('contacts', { id: text('id').primaryKey() });
`;
    const runtimeSource = `
import { createSqliteAppRuntime } from '@kovojs/server/sqlite';
import { contacts } from '../schema.js';
const APP_TABLES = [contacts];
const APP_SEED = [{ table: contacts, rows: [{ id: 'task-proof' }] }];
const appDatabase = createSqliteAppRuntime({ seed: APP_SEED, tables: APP_TABLES });
const authSystemDb = appDatabase.systemDb({
  operation: 'write',
  reason: 'generated auth binding',
  surface: 'src/_kovo/app-runtime-db.ts#createAppAuthBindings',
});
export const appRuntimeMutationReplayStore = appDatabase.mutationReplayStore;
export const appRuntimeReadonlyDb = appDatabase.readonlyDb;
export const appRuntimeDbReady = appDatabase.ready;
export const appRuntimeDbProvider = appDatabase.db;
void authSystemDb;
`;
    const dbSource = `
import { appRuntimeReadonlyDb } from './_kovo/app-runtime-db.js';
export const readonlyAppDb = appRuntimeReadonlyDb;
`;
    const project = (source: string, runtime = runtimeSource, db = dbSource) =>
      kv449Project(source, [
        { fileName: 'src/schema.ts', source: schemaSource },
        { fileName: 'src/_kovo/app-runtime-db.ts', source: runtime },
        { fileName: 'src/db.ts', source: db },
      ]);

    expect(project(endpointSource)).toEqual([]);
    expect(
      project(
        endpointSource,
        runtimeSource
          .replace(
            "import { createSqliteAppRuntime } from '@kovojs/server/sqlite';",
            "import { createPostgresAppRuntimeDb } from '@kovojs/server/postgres';",
          )
          .replace(
            'createSqliteAppRuntime({ seed: APP_SEED, tables: APP_TABLES })',
            'createPostgresAppRuntimeDb({ seed: APP_SEED, tables: APP_TABLES })',
          ),
      ),
    ).toEqual([]);

    for (const [label, postgresSpecifier] of [
      ['removed Postgres root', '@kovojs/server'],
      ['Postgres subpath lookalike', '@kovojs/server/postgres-extra'],
    ] as const) {
      expect(
        project(
          endpointSource,
          runtimeSource
            .replace(
              "import { createSqliteAppRuntime } from '@kovojs/server/sqlite';",
              `import { createPostgresAppRuntimeDb } from '${postgresSpecifier}';`,
            )
            .replace(
              'createSqliteAppRuntime({ seed: APP_SEED, tables: APP_TABLES })',
              'createPostgresAppRuntimeDb({ seed: APP_SEED, tables: APP_TABLES })',
            ),
        ).length,
        label,
      ).toBeGreaterThan(0);
    }

    for (const [label, source] of [
      [
        'local capability alias',
        endpointSource.replace(
          'const rows = await readonlyAppDb',
          'const database = readonlyAppDb;\n    const rows = await database',
        ),
      ],
      [
        'computed read method',
        endpointSource.replace('readonlyAppDb\n      .select', "readonlyAppDb\n      ['select']"),
      ],
      [
        'foreign same-named import',
        endpointSource.replace("from './db.js'", "from './lookalike.js'"),
      ],
    ] as const) {
      expect(project(source).length, label).toBeGreaterThan(0);
    }

    expect(
      project(
        endpointSource,
        runtimeSource.replace(
          'appDatabase.readonlyDb',
          `{ select() { return { from() { return eval('forged'); } }; } }`,
        ),
      ).length,
      'forged generated runtime export',
    ).toBeGreaterThan(0);
    for (const [label, runtime] of [
      [
        'aliased generated runtime factory',
        runtimeSource
          .replace('createSqliteAppRuntime }', 'createSqliteAppRuntime as makeRuntime }')
          .replace('createSqliteAppRuntime({', 'makeRuntime({'),
      ],
      [
        'foreign same-named runtime factory',
        runtimeSource.replace("from '@kovojs/server/sqlite'", "from './lookalike.js'"),
      ],
      [
        'computed generated readonly projection',
        runtimeSource.replace('appDatabase.readonlyDb', "appDatabase['readonlyDb']"),
      ],
    ] as const) {
      expect(project(endpointSource, runtime).length, label).toBeGreaterThan(0);
    }
    expect(
      project(
        endpointSource,
        runtimeSource,
        `${dbSource}\nObject.defineProperty(readonlyAppDb, 'select', { value: () => ({}) });`,
      ).length,
      'mutated generated re-export',
    ).toBeGreaterThan(0);
  });

  it.each([
    [
      'a same-named imported trustedAssign',
      `import { trustedAssign } from './lookalike.js';`,
      `return trustedAssign(input.id, 'not a framework identity');`,
    ],
    [
      'a same-named local trustedAssign that returns a privileged outcome',
      ``,
      `function trustedAssign() { return new Response('raw'); }
       return trustedAssign();`,
    ],
    [
      'a getter-carried trustedAssign lookalike',
      ``,
      `const helpers = { get trustedAssign() { return () => new Response('raw'); } };
       return helpers.trustedAssign(input.id, 'getter');`,
    ],
    [
      'a replaced exact trustedAssign binding',
      `import { trustedAssign } from '@kovojs/server/write-safety';`,
      `trustedAssign = () => new Response('raw');
       return trustedAssign(input.id, 'replaced');`,
    ],
    [
      'a mutable trustedAssign container',
      `import { trustedAssign } from '@kovojs/server/write-safety';`,
      `const helpers = { trustedAssign };
       helpers.trustedAssign = () => new Response('raw');
       return helpers.trustedAssign(input.id, 'container');`,
    ],
    [
      'an exact trustedAssign call carrying managed authority',
      `import { trustedAssign } from '@kovojs/server/write-safety';`,
      `return trustedAssign(request.db, 'authority laundering');`,
    ],
  ])(
    'does not grant reviewed data-helper identity through %s',
    (_label, moduleDeclarations, handlerBody) => {
      expect(
        kv449(`
import { mutation } from '@kovojs/server';
${moduleDeclarations}
export const save = mutation('contacts/save', {
  handler(input, request) {
    ${handlerBody}
  },
});
`),
      ).not.toEqual([]);
    },
  );

  it.each([
    [
      'a same-named imported crypto object',
      `import { crypto } from './lookalike.js';`,
      `return crypto.randomUUID();`,
    ],
    [
      'a same-named local crypto object',
      ``,
      `const crypto = { randomUUID() { return new Response('raw'); } };
       return crypto.randomUUID();`,
    ],
    [
      'a getter-carried randomUUID lookalike',
      ``,
      `const entropy = { get randomUUID() { return () => new Response('raw'); } };
       return entropy.randomUUID();`,
    ],
    [
      'an ambient crypto container alias',
      ``,
      `const entropy = crypto;
       return entropy.randomUUID();`,
    ],
    [
      'a replaced ambient crypto member',
      ``,
      `crypto.randomUUID = () => 'fixed';
       return crypto.randomUUID();`,
    ],
  ])('keeps randomUUID closed through %s', (_label, moduleDeclarations, handlerBody) => {
    expect(
      kv449(`
import { mutation } from '@kovojs/server';
${moduleDeclarations}
export const save = mutation('contacts/save', {
  handler() {
    ${handlerBody}
  },
});
`),
    ).not.toEqual([]);
  });

  it.each([
    [
      'an imported Error lookalike',
      `import { Error } from './lookalike.js';`,
      `throw new Error('raw');`,
    ],
    [
      'a local Error lookalike',
      ``,
      `class Error { constructor() { return new Response('raw'); } } throw new Error();`,
    ],
    ['an Error constructor alias', ``, `const Failure = Error; throw new Failure('aliased');`],
    ['a replaced ambient Error binding', ``, `Error = class {}; throw new Error('replaced');`],
  ])(
    'keeps the ambient Error constructor closed through %s',
    (_label, moduleDeclarations, handlerBody) => {
      expect(
        kv449(`
import { query } from '@kovojs/server';
${moduleDeclarations}
export const list = query('contacts/list', {
  load() { ${handlerBody} },
});
`),
      ).not.toEqual([]);
    },
  );

  it.each([
    [
      'an imported same-named builder method',
      `import { builder } from './lookalike.js';`,
      `return builder.from(contacts);`,
    ],
    [
      'a same-named local builder method that returns a privileged outcome',
      ``,
      `const builder = { from() { return new Response('raw'); } };
       return builder.from(contacts);`,
    ],
    [
      'a getter-carried builder method',
      ``,
      `const builder = { get from() { return () => new Response('raw'); } };
       return builder.from(contacts);`,
    ],
    [
      'a mutable managed-builder container',
      `import { foreignFrom } from './lookalike.js';`,
      `const builder = request.db.select();
       builder.from = foreignFrom;
       return builder.from(contacts);`,
    ],
    [
      'an unreviewed managed-builder continuation',
      ``,
      `return request.db.select().dropEverything();`,
    ],
    [
      'a reviewed managed-builder continuation carrying authority',
      ``,
      `return request.db.select().where(request.db);`,
    ],
  ])(
    'does not recognize finite database continuations through %s',
    (_label, moduleDeclarations, handlerBody) => {
      expect(
        kv449(`
import { mutation } from '@kovojs/server';
import { contacts } from './schema.js';
${moduleDeclarations}
export const save = mutation('contacts/save', {
  handler(_input, request) {
    ${handlerBody}
  },
});
`),
      ).not.toEqual([]);
    },
  );

  it.each([
    [
      'a getter-backed export passed to from',
      `export const contacts = { get id() { return new Response('getter'); } };`,
      `return request.db.select().from(contacts);`,
    ],
    [
      'a Proxy export passed to where',
      `export const contacts = new Proxy({}, { get() { return new Response('proxy'); } });`,
      `return request.db.select().where(contacts);`,
    ],
    [
      'a callable export passed to orderBy',
      `export function contacts() { return new Response('callable'); }`,
      `return request.db.select().orderBy(contacts);`,
    ],
    [
      'a reassigned table export passed to limit',
      `import { pgTable } from 'drizzle-orm/pg-core';
       export const contacts = pgTable('contacts', {});
       contacts = new Proxy({}, {});`,
      `return request.db.select().limit(contacts);`,
    ],
  ])('rejects imported executable database data through %s', (_label, schemaSource, call) => {
    expect(
      kv449Project(
        `
import { mutation } from '@kovojs/server';
import { contacts } from './schema.js';
export const save = mutation('contacts/save', {
  handler(_input, request) { ${call} },
});
`,
        [{ fileName: 'src/schema.ts', source: schemaSource }],
      ),
    ).not.toEqual([]);
  });

  it('classifies exact static managed relational reads through direct and scoped read handles', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  db: true,
  async handler(_request, context) {
    const direct = await context.db.query.accounts.findFirst({
      columns: { id: true },
    });
    const scope = await context.actAs('owner-1');
    const reader = scope.db.read;
    const rows = await reader.query.orders.findMany({
      columns: { id: true },
    });
    return Response.json({ direct, rows });
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain('"kind":"server.database.read"');
    expect(serverSource).toContain('"target":"context.db.query.accounts.findFirst"');
    expect(serverSource).toContain('"target":"reader.query.orders.findMany"');
  });

  it.each([
    ['computed relational table', 'await ctx.db.query[table].findMany()'],
    ['computed relational terminal', 'await ctx.db.query.accounts[method]()'],
    ['unknown relational terminal', 'await ctx.db.query.accounts.removeEverything()'],
    ['extra relational namespace', 'await ctx.db.query.schema.accounts.findMany()'],
    ['unknown managed namespace chain', 'await ctx.db.schema.accounts.findMany()'],
    ['computed read-namespace terminal', 'await ctx.db.read[operation]()'],
    ['extra read namespace', 'await ctx.db.read.schema.accounts.findMany()'],
    ['extra write namespace', 'await ctx.db.write.schema.insert()'],
    ['raw-driver-shaped namespace', 'await ctx.db.driver.execute("drop table accounts")'],
    ['raw-pool-shaped namespace', 'await ctx.db.pool.query("select 1")'],
    ['table-namespace write terminal', 'await ctx.db.products.delete("p1")'],
  ])('rejects %s instead of widening managed relational reads', (_label, operation) => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    ${operation};
    return Response.json({ ok: true });
  },
});
`),
    ).not.toEqual([]);
  });

  it.each([
    ['unknown managed database method', 'await ctx.db.dropEverything()'],
    ['computed managed database method', 'await ctx.db[operation]()'],
    ['raw Response from mutation', "return new Response('raw')"],
  ])('rejects %s', (_label, operation) => {
    expect(
      kv449(`
import { mutation } from '@kovojs/server';
export const save = mutation('save', { handler: async (_input, _request, ctx) => { ${operation}; } });
`),
    ).not.toEqual([]);
  });

  it('requires static justifications on the trustedSql and trustedHtml exceptional doors', () => {
    expect(
      kv449(`
import { trustedHtml } from '@kovojs/browser';
import { sql, trustedSql } from '@kovojs/drizzle';
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler(_input, ctx) {
    ctx.db.execute(trustedSql(sql\`select 1\`, { justification: reason }));
    return Response.json({ html: trustedHtml('<strong>ok</strong>') });
  },
});
`),
    ).toHaveLength(2);
  });

  it('complete-mutation-form-security-fields recognizes only the exact public security surface', () => {
    expect(
      kv449(`
import { mutation } from '@kovojs/server';
import { mintCsrfField as field } from '@kovojs/server/security';
export const save = mutation('save', { handler() {} });
export function render(context) { return field(context, { mutation: save }); }
`),
    ).toHaveLength(1);

    for (const [label, source] of [
      [
        'removed root export',
        `
import { mintCsrfField as field } from '@kovojs/server';
export const value = field({}, { mutation: 'removed-root' });
`,
      ],
      [
        'subpath lookalike',
        `
import { mintCsrfField as field } from '@kovojs/server/security-extra';
export const value = field({}, { mutation: 'lookalike-subpath' });
`,
      ],
      [
        'local lookalike',
        `
function mintCsrfField(_context, _options) { return '<input>'; }
export const value = mintCsrfField({}, { mutation: 'lookalike-local' });
`,
      ],
    ] as const) {
      expect(kv449(source), label).toEqual([]);
    }
  });
});
