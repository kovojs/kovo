// SPEC §12.1: terminal value controls expose native value roles and names.
import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

const homeRoute = route('/', {
  meta: { title: 'Value controls' },
  page: () => `<main>
    <h1>Value controls</h1>
    <label for="volume">Volume</label>
    <input id="volume" name="volume" type="range" min="0" max="10" value="7" />
    <label for="quantity">Quantity</label>
    <input id="quantity" name="quantity" type="number" min="1" max="9" value="3" />
    <fieldset>
      <legend>One-time code</legend>
      <label for="otp-1">Digit 1</label>
      <input id="otp-1" name="otp-1" inputmode="numeric" pattern="[0-9]" maxlength="1" value="4" />
      <label for="otp-2">Digit 2</label>
      <input id="otp-2" name="otp-2" inputmode="numeric" pattern="[0-9]" maxlength="1" value="2" />
    </fieldset>
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
