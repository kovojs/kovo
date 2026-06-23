/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Table Cells Merge icon (Lucide). https://lucide.dev/icons/table-cells-merge */
export function TableCellsMerge(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 21v-6"></path>
      <path d="M12 9V3"></path>
      <path d="M3 15h18"></path>
      <path d="M3 9h18"></path>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
    </svg>
  );
}
