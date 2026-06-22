/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** List Sort Ascending icon (Lucide). https://lucide.dev/icons/list-sort-ascending */
export function ListSortAscending(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 19h18"></path>
      <path d="M15 12H3"></path>
      <path d="M9 5H3"></path>
    </svg>
  );
}
