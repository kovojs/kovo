import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

interface ExtraFile {
  readonly fileName: string;
  readonly source: string;
}

function compile(source: string, extraFiles: readonly ExtraFile[] = []) {
  return compileComponentModule({
    fileName: 'ownership-probe.tsx',
    source,
    extraFiles,
  } as Parameters<typeof compileComponentModule>[0] & { extraFiles: readonly ExtraFile[] });
}

describe('mutation form ownership provenance', () => {
  it.each([
    [
      'structural helper argument',
      `
import { mutationFormAttributes } from '@kovojs/server';
const forged = { key: 'admin/delete', input: undefined, fileFields: [], csrf: undefined };
export const View = component({
  render: () => <form {...mutationFormAttributes(forged)} />,
});
`,
    ],
    [
      'structural direct mutation argument',
      `
const forged = { key: 'admin/delete', input: undefined, fileFields: [], csrf: undefined };
export const View = component({
  render: () => <form enhance mutation={forged} />,
});
`,
    ],
    [
      'shadowed mutation constructor',
      `
import { mutationFormAttributes } from '@kovojs/server';
function mutation(key, definition) { return { ...definition, key }; }
export const forged = mutation('admin/delete', { input: {}, handler() {} });
export const View = component({
  render: () => <form {...mutationFormAttributes(forged)} />,
});
`,
    ],
  ])('diagnoses %s', (_title, source) => {
    const result = compile(source);
    const diagnostics = result.diagnostics.filter((entry) => entry.code === 'KV242');
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(serverSource).not.toContain('/_m/admin/delete');
    expect(serverSource).not.toContain('mutationFormAttributes(forged)');
  });

  it('diagnoses externally associated submitter overrides whose form owner is not local', () => {
    const result = compile(`
export const remove = mutation('account/remove', {
  input: s.object({}),
  handler() { return null; },
});
export const ExternalPreview = component({
  render: () => <>
    <form mutation={remove}><button>Remove</button></form>
    <button form="unknown-form" formaction="/preview" formmethod="get">Preview</button>
  </>,
});
`);

    expect(result.diagnostics.filter((entry) => entry.code === 'KV242')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('externally associated') }),
      ]),
    );
  });

  it('propagates submitter override diagnostics through local component composition', () => {
    const result = compile(`
export const save = mutation('account/delete', {
  input: s.object({}),
  handler() { return null; },
});
export const PreviewSubmitter = component({
  render: () => <button formaction="/preview" formmethod="get">Preview</button>,
});
export const DeleteForm = component({
  render: () => <form mutation={save}><PreviewSubmitter /></form>,
});
`);

    expect(result.diagnostics.filter((entry) => entry.code === 'KV242')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('component-rendered') }),
      ]),
    );
  });

  it('propagates submitter override diagnostics through nested local components', () => {
    const result = compile(`
export const save = mutation('account/delete', {
  input: s.object({}),
  handler() { return null; },
});
export const UnsafeSubmitter = component({
  render: () => <button formaction="/preview" formmethod="get">Preview</button>,
});
export const SubmitterShell = component({
  render: () => <div><UnsafeSubmitter /></div>,
});
export const DeleteForm = component({
  render: () => <form mutation={save}><SubmitterShell /></form>,
});
`);

    expect(result.diagnostics.filter((entry) => entry.code === 'KV242')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('component-rendered') }),
      ]),
    );
  });

  it('keeps component-rendered submitters that do not override form transport', () => {
    const result = compile(`
export const save = mutation('account/save', {
  input: s.object({}),
  handler() { return null; },
});
export const SafeSubmitter = component({
  render: () => <button type="submit">Save</button>,
});
export const SaveForm = component({
  render: () => <form mutation={save}><SafeSubmitter /></form>,
});
`);

    expect(result.diagnostics.filter((entry) => entry.code === 'KV242')).toEqual([]);
  });

  it('follows underscore and ordinary local function components', () => {
    const result = compile(`
export const save = mutation('account/save', {
  input: s.object({}),
  handler() { return null; },
});
export const _UnsafeSubmitter = component({
  render: () => <button formtarget="_blank">Unsafe</button>,
});
function SafeSubmitter() { return <button type="submit">Safe</button>; }
const UnsafeFunction = () => <input type="submit" formenctype="text/plain" />;
export const View = component({
  render: () => <>
    <form mutation={save}><_UnsafeSubmitter /></form>
    <form mutation={save}><SafeSubmitter /></form>
    <form mutation={save}><UnsafeFunction /></form>
  </>,
});
`);

    const messages = result.diagnostics
      .filter((entry) => entry.code === 'KV242')
      .map((entry) => entry.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('component-rendered formtarget'),
        expect.stringContaining('component-rendered formenctype'),
      ]),
    );
    expect(messages).not.toEqual(
      expect.arrayContaining([expect.stringContaining('SafeSubmitter')]),
    );
  });

  it('follows pinned imported component source and closes unresolved imports', () => {
    const extraFiles = [
      {
        fileName: 'safe-submitters.tsx',
        source: `
export function SafeImported() { return <button type="submit">Save</button>; }
export const UnsafeImported = () => <button formnovalidate>Skip validation</button>;
`,
      },
    ];
    const result = compile(
      `
import { SafeImported, UnsafeImported } from './safe-submitters';
import { MissingImported } from './missing-submitters';
export const save = mutation('account/save', {
  input: s.object({}),
  handler() { return null; },
});
export const View = component({
  render: () => <form mutation={save}>
    <SafeImported />
    <UnsafeImported />
    <MissingImported />
  </form>,
});
`,
      extraFiles,
    );

    const messages = result.diagnostics
      .filter((entry) => entry.code === 'KV242')
      .map((entry) => entry.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('component-rendered formnovalidate'),
        expect.stringContaining('<MissingImported> cannot be resolved'),
      ]),
    );
    expect(messages).not.toEqual(
      expect.arrayContaining([expect.stringContaining('<SafeImported>')]),
    );
  });

  it.each([
    ['formaction', ''],
    ['FORMMETHOD', 'get'],
    ['formenctype', 'text/plain'],
    ['formtarget', '_blank'],
    ['formnovalidate', null],
  ])('rejects direct descendant %s overrides including empty values', (name, value) => {
    const attribute = value === null ? name : `${name}=${JSON.stringify(value)}`;
    const result = compile(`
export const save = mutation('account/save', {
  input: s.object({}),
  handler() { return null; },
});
export const View = component({
  render: () => <form mutation={save}><button ${attribute}>Save</button></form>,
});
`);
    expect(result.diagnostics.filter((entry) => entry.code === 'KV242')).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining(name) })]),
    );
  });

  it('rejects reactive direct-descendant submitter transport overrides before lowering', () => {
    const result = compile(`
export const save = mutation({
  input: s.object({ email: s.string() }),
  handler() { return null; },
});
export const View = component({
  queries: { q: {} },
  render: ({ q }) => (
    <form mutation={save}>
      <input name="email" value="victim@example.test" />
      <button
        formaction={q.action}
        formenctype={q.enctype}
        formmethod={q.method}
        formnovalidate={q.noValidate}
        formtarget={q.target}
      >Save</button>
    </form>
  ),
});
`);

    expect(result.diagnostics.filter((entry) => entry.code === 'KV242')).not.toEqual([]);
    const server = result.files.find((file) => file.kind === 'server')?.source ?? '';
    for (const name of [
      'formaction',
      'formenctype',
      'formmethod',
      'formnovalidate',
      'formtarget',
    ]) {
      expect(server).not.toContain(`data-bind:${name}`);
    }
  });

  it('accepts a statically separate native form association and closes dynamic ownership', () => {
    const safe = compile(`
export const save = mutation('account/save', {
  input: s.object({}),
  handler() { return null; },
});
export const View = component({
  render: () => <>
    <form mutation={save}><button>Save</button></form>
    <form id="preview-form" action="/preview" method="get" />
    <button form="preview-form" formaction="/preview" formmethod="get">Preview</button>
  </>,
});
`);
    expect(safe.diagnostics.filter((entry) => entry.code === 'KV242')).toEqual([]);

    const dynamic = compile(`
export const save = mutation('account/save', {
  input: s.object({}),
  handler() { return null; },
});
export const View = component({
  render: (_queries, state) => <>
    <form mutation={save}><button>Save</button></form>
    <form id="preview-form" action="/preview" method="get" />
    <button form={state.formId} formaction="/preview">Preview</button>
  </>,
});
`);
    expect(dynamic.diagnostics.filter((entry) => entry.code === 'KV242')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('externally associated') }),
      ]),
    );

    for (const ambiguousForm of [
      '<form mutation={save} id="preview-form"><button>Save</button></form>',
      '<form mutation={save}><form id="preview-form" /></form>',
      '<form mutation={save}><button>Save</button></form><form id={state.formId} action="/preview" method="get" />',
    ]) {
      const ambiguous = compile(`
export const save = mutation('account/save', {
  input: s.object({}),
  handler() { return null; },
});
export const View = component({
  render: (_queries, state) => <>
    ${ambiguousForm}
    <form id="preview-form" action="/preview" method="get" />
    <button form="preview-form" formaction="/preview">Preview</button>
  </>,
});
`);
      expect(
        ambiguous.diagnostics.filter((entry) => entry.code === 'KV242'),
        ambiguousForm,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining('formaction') }),
        ]),
      );
    }
  });

  it('scopes stock route, list, and reviewed Button expressions to their actual form owner', () => {
    const result = compile(`
import { Button } from '@kovojs/ui/button';
import { Badge } from '@kovojs/ui/badge';
import { redirect, route } from '@kovojs/server';

export const save = mutation('account/save', {
  input: s.object({}),
  handler() { return null; },
});

function StockForm() {
  return <form mutation={save}>{Button.definition.render({ children: 'Save', type: 'submit' })}</form>;
}

export const StockView = component({
  render: (_queries, state) => <>
    {Badge.definition.render({ children: 'Summary', variant: 'outline' })}
    <StockForm />
    <ul>{state.items.map((item) => <li>{item.label}</li>)}</ul>
    <UnresolvedOrdinarySibling />
  </>,
});

export const stock = route('/stock', {
  page(_context, request) {
    if (!request.session) return redirect('/login', {});
    return <StockView />;
  },
});
`);

    expect(result.diagnostics.filter((entry) => entry.code === 'KV242')).toEqual([]);
  });

  it.each([
    {
      child: `<form mutation={save}>{Button.definition.render({ children: 'Save' })}</form>`,
      label: 'structural definition.render lookalike nested in the form',
      preamble: `const Button = { definition: { render() { return <button />; } } };`,
    },
    {
      child: `<form mutation={save}>{Button.definition.render({ ...props, children: 'Save' })}</form>`,
      label: 'reviewed Button spread nested in the form',
      preamble: `import { Button } from '@kovojs/ui/button';\nconst props = getRuntimeProps();`,
    },
    {
      child: `<form mutation={save}>{Button.definition.render({ children: 'Save', form: 'other' })}</form>`,
      label: 'reviewed Button form reassociation nested in the form',
      preamble: `import { Button } from '@kovojs/ui/button';`,
    },
    {
      child: `<form mutation={save}>{runtimeButton()}</form>`,
      label: 'opaque expression nested in the form',
      preamble: '',
    },
  ])('keeps $label closed', ({ child, preamble }) => {
    const result = compile(`
${preamble}
export const save = mutation('account/save', {
  input: s.object({}),
  handler() { return null; },
});
export const View = component({ render: () => <>${child}</> });
`);
    expect(result.diagnostics.filter((entry) => entry.code === 'KV242')).not.toEqual([]);
  });

  it('keeps an unresolved explicit form-association carrier closed outside the form', () => {
    const result = compile(`
export const save = mutation('account/save', {
  input: s.object({}),
  handler() { return null; },
});
export const View = component({ render: () => <>
  <form id="account-save" mutation={save}><button>Save</button></form>
  <UnresolvedCarrier form="account-save" />
</> });
`);
    expect(result.diagnostics.filter((entry) => entry.code === 'KV242')).not.toEqual([]);
  });
});
