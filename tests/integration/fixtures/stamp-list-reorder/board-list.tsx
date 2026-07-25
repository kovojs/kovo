/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { boardQuery, type BoardItem, type BoardResult } from './shared';

function BoardRow({ item }: { item: BoardItem }) {
  return (
    <li key={item.id} data-row={item.id}>
      <span>{item.rank}</span> <span>{item.label}</span>
    </li>
  );
}

export const BoardList = component({
  queries: { board: boardQuery },
  render: ({ board }: { board: BoardResult }) => (
    <board-list>
      <ol aria-label="Board order">
        {board.items.map((item) => (
          <BoardRow item={item} />
        ))}
      </ol>
    </board-list>
  ),
});
