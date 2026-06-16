import assert from 'node:assert/strict';

import { compileComponentModule } from '../dist/compiler/src/index.mjs';

const result = compileComponentModule({
  fileName: 'routes/products/product-card.tsx',
  source: `
import { component } from '@kovojs/core';

export const ProductCard = component('product-card', {
  render: () => (
    <article>
      <button onClick={() => addToCart(product.id)}>Add</button>
    </article>
  ),
});
`,
});

const fileNames = result.files.map((file) => file.fileName);
assert.deepEqual(fileNames, [
  'routes/products/product-card.server.js',
  'routes/products/product-card.client.js',
  'generated/registries.d.ts',
]);

const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

assert.match(
  serverSource,
  /on:click="\/c\/routes\/products\/product-card\.client\.js\?v=[0-9a-f]{8}#ProductCard\$button_click"/,
);
assert.match(clientSource, /export const ProductCard\$button_click = handler/);

for (const fileName of fileNames) {
  assert.doesNotMatch(fileName, /chunk|[a-f0-9]{8,}/i);
}

console.log('prod-emit-check/v1');
console.log('OK');
