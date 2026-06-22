/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** List Chevrons Up Down icon (Lucide). https://lucide.dev/icons/list-chevrons-up-down */
export function ListChevronsUpDown(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 5h8"></path>
      <path d="M3 12h8"></path>
      <path d="M3 19h8"></path>
      <path d="m15 8 3-3 3 3"></path>
      <path d="m15 16 3 3 3-3"></path>
    </svg>
  );
}
