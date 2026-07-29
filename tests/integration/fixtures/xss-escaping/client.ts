import { createQueryStore } from '@kovojs/browser/generated';
import { installInlineQueryEventHydration } from '@kovojs/test/internal/integration/fixture-browser-abi';

installInlineQueryEventHydration({
  root: document,
  store: createQueryStore(),
  target: window,
});
