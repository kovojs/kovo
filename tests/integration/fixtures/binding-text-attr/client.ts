import { createQueryStore } from '@kovojs/browser/client';
import { installInlineQueryEventHydration } from '@kovojs/test/internal/integration/fixture-abi';

installInlineQueryEventHydration({
  root: document,
  store: createQueryStore(),
  target: window,
});
