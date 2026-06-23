/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Table Cells Split icon (Lucide). https://lucide.dev/icons/table-cells-split */
export function TableCellsSplit(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 15V9"></path>
      <path d="M3 15h18"></path>
      <path d="M3 9h18"></path>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
    </svg>
  );
}
