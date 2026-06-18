import {
  createQueryStore,
  installInlineQueryEventHydration,
  type CompiledQueryUpdatePlans,
} from '@kovojs/runtime/client';

interface BoardItem {
  id: string;
  label: string;
  rank: number;
}

const queryPlans: CompiledQueryUpdatePlans = {
  board: {
    bindings: false,
    templateStamps: [
      {
        key: 'id',
        list: 'items',
        render: (item) => {
          const value = item as BoardItem;
          return `<li kovo-key="${escapeAttr(value.id)}" data-row="${escapeAttr(value.id)}">
            <span data-bind=".rank">${escapeHtml(String(value.rank))}</span>
            <span data-bind=".label">${escapeHtml(value.label)}</span>
          </li>`;
        },
        selector: '[data-bind-list="board.items"]',
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
