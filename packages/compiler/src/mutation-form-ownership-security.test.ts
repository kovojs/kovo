import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

function compile(source: string) {
  return compileComponentModule({ fileName: 'ownership-probe.tsx', source });
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
export const ExternalPreview = component({
  render: () => (
    <button form="delete-form" formaction="/preview" formmethod="get">Preview</button>
  ),
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
});
