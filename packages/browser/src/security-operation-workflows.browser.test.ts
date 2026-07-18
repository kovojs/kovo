import { afterEach, expect, it } from 'vitest';

import { securityHandler } from './handlers.js';

afterEach(() => {
  document.body.replaceChildren();
});

it('keeps finite-IR form, state, event, focus, and dialog workflows operational', () => {
  // SPEC §4.3/§5.2: this is compiler-shaped output, not app-authored lowered IR. It proves
  // that the closed operation vocabulary still carries a realistic workflow in every browser
  // enrolled by tests/browser-acceptance.mjs.
  const root = document.createElement('main');
  root.innerHTML = [
    '<form>',
    '<label for="profile-name">Name</label>',
    '<input id="profile-name" name="name" value="Ada">',
    '<button type="button">Save</button>',
    '<button type="button" data-reset>Reset</button>',
    '</form>',
    '<dialog>',
    '<label for="confirmation">Confirmation</label>',
    '<input id="confirmation" value="Saved">',
    '<button type="button">Close</button>',
    '</dialog>',
  ].join('');
  document.body.append(root);

  const form = root.querySelector('form');
  const name = root.querySelector<HTMLInputElement>('#profile-name');
  const save = root.querySelector<HTMLButtonElement>('form button:not([data-reset])');
  const resetButton = root.querySelector<HTMLButtonElement>('form [data-reset]');
  const dialog = root.querySelector('dialog');
  const confirmation = root.querySelector<HTMLInputElement>('#confirmation');
  const close = root.querySelector<HTMLButtonElement>('dialog button');
  if (!form || !name || !save || !resetButton || !dialog || !confirmation || !close) {
    throw new Error('missing finite-IR browser fixture');
  }

  const state = { submissions: 0, value: '' };
  let submitPrevented = false;

  const submit = securityHandler(
    [
      {
        door: 'delegated-event',
        kind: 'browser.event.control',
        target: 'event.preventDefault',
      },
      { door: 'delegated-event', kind: 'browser.event.read', target: 'event.defaultPrevented' },
      { door: 'compiler-state', kind: 'browser.state.read', target: 'state.submissions' },
      { door: 'compiler-state', kind: 'browser.state.write', target: 'state.submissions' },
      { door: 'compiler-state', kind: 'browser.state.write', target: 'state.value' },
      { door: 'platform-invoker', kind: 'browser.dialog.open', target: 'dialog.showModal' },
      { door: 'compiler-dom-focus', kind: 'browser.dom.focus', target: 'confirmation.focus' },
    ] as const,
    (event) => {
      event.preventDefault();
      submitPrevented = event.defaultPrevented;
      state.submissions += 1;
      state.value = name.value;
      dialog.showModal();
      confirmation.focus();
    },
  );
  form.addEventListener('submit', submit);

  const requestSubmit = securityHandler(
    [{ door: 'compiler-form', kind: 'browser.form.submit', target: 'form.requestSubmit' }] as const,
    () => form.requestSubmit(),
  );
  save.addEventListener('click', requestSubmit);

  const closeDialog = securityHandler(
    [{ door: 'platform-invoker', kind: 'browser.dialog.close', target: 'dialog.close' }] as const,
    () => dialog.close(),
  );
  close.addEventListener('click', closeDialog);

  const reset = securityHandler(
    [
      { door: 'compiler-form', kind: 'browser.form.reset', target: 'form.reset' },
      { door: 'compiler-dom-focus', kind: 'browser.dom.focus', target: 'name.focus' },
    ] as const,
    () => {
      form.reset();
      name.focus();
    },
  );
  resetButton.addEventListener('click', reset);

  name.value = 'Grace';
  save.click();

  expect(submitPrevented).toBe(true);
  expect(state).toEqual({ submissions: 1, value: 'Grace' });
  expect(dialog.open).toBe(true);
  expect(document.activeElement).toBe(confirmation);

  close.click();
  expect(dialog.open).toBe(false);

  resetButton.click();
  expect(name.value).toBe('Ada');
  expect(document.activeElement).toBe(name);
});
