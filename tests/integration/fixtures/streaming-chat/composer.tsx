/** @jsxImportSource @kovojs/server */
import { component, form, FormError } from '@kovojs/core';

import { composerQuery } from './shared';

interface ModelUnavailableFailure {
  code: 'MODEL_UNAVAILABLE';
  payload: Record<string, never>;
}

const sendForm = form<'chat/send', { body: string; turns: number }, ModelUnavailableFailure>(
  'chat/send',
);

export const Composer = component({
  mutations: { send: sendForm },
  queries: { composer: composerQuery },
  render: () => (
    <form mutation={sendForm} enhance stream>
      <label>
        Message <textarea name="body">show table</textarea>
      </label>
      <input type="hidden" name="turns" value="1" />
      <FormError code="MODEL_UNAVAILABLE" message="Unable to send" />
      <button type="submit">Send</button>
    </form>
  ),
});
