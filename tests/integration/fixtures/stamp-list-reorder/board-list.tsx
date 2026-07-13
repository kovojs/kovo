/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { boardQuery, type BoardItem, type BoardResult } from './shared';

function BoardRow({ item }: { item: BoardItem }) {
  return (
    <li kovo-key={item.id} data-row={item.id}>
      <span data-bind=".rank">{item.rank}</span> <span data-bind=".label">{item.label}</span>
    </li>
  );
}

export const BoardList = component({
  queries: { board: boardQuery },
  render: ({ board }: { board: BoardResult }) => (
    <board-list>
      <ol data-bind-list="board.items" kovo-key="id" aria-label="Board order">
        {board.items.map((item) => (
          <BoardRow item={item} />
        ))}
        <template kovo-stamp>
          <BoardRow item={{ id: '', label: '', rank: 0 }} />
        </template>
      </ol>
    </board-list>
  ),
});
