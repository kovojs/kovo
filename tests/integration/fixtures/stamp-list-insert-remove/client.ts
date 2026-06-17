import {
  createQueryStore,
  installInlineQueryEventHydration,
  type CompiledQueryUpdatePlans,
} from '@kovojs/runtime';

interface CartItem {
  id: string;
  name: string;
  qty: number;
}

const queryPlans: CompiledQueryUpdatePlans = {
  cart: {
    bindings: false,
    templateStamps: [
      {
        key: 'id',
        list: 'items',
        render: (item) => {
          const value = item as CartItem;
          return `<li kovo-key="${escapeAttr(value.id)}" data-row="${escapeAttr(value.id)}">
            <span data-bind=".qty">${escapeHtml(String(value.qty))}</span>
            <span data-bind=".name">${escapeHtml(value.name)}</span>
          </li>`;
        },
        selector: '[data-bind-list="cart.items"]',
      },
    ],
  },
};

installInlineQueryEventHydration({
  queryPlans,
  root: document,
  store: createQueryStore(),
  target: window,
});

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
