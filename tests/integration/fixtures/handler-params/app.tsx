import { createApp, publicAccess, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>
    <h1>Handler params</h1>
    <button
      type="button"
      on:click="/client.ts#recordParams"
      data-p-item-id="sku-42"
      data-p-quantity="3"
      data-p-enabled="true"
      kovo-param-types="quantity:number enabled:boolean"
    >Record params</button>
    <output data-result>idle</output>
  </main>`,
});

export default defineFixture({
  app: createApp({ routes: [homeRoute] }),
});
