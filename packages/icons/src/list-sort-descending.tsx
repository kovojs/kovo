/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** List Sort Descending icon (Lucide). https://lucide.dev/icons/list-sort-descending */
export function ListSortDescending(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 12H3"></path>
      <path d="M3 5h18"></path>
      <path d="M9 19H3"></path>
    </svg>
  );
}
