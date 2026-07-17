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
});
