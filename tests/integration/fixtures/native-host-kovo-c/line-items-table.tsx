/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

const rows = [
  { label: 'Notebook', quantity: 2, sku: 'sku-notebook' },
  { label: 'Pencil', quantity: 6, sku: 'sku-pencil' },
];

export const LineItemsTable = component({
  render: () => (
    <table>
      <caption>Order lines</caption>
      <tbody>
        {rows.map((row) => (
          <tr data-row={row.sku}>
            <th scope="row">{row.label}</th>
            <td>{row.quantity}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
});
