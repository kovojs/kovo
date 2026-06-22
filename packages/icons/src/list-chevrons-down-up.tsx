/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** List Chevrons Down Up icon (Lucide). https://lucide.dev/icons/list-chevrons-down-up */
export function ListChevronsDownUp(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 5h8"></path>
      <path d="M3 12h8"></path>
      <path d="M3 19h8"></path>
      <path d="m15 5 3 3 3-3"></path>
      <path d="m15 19 3-3 3 3"></path>
    </svg>
  );
}
