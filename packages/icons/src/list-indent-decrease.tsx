/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** List Indent Decrease icon (Lucide). https://lucide.dev/icons/list-indent-decrease */
export function ListIndentDecrease(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 5H11"></path>
      <path d="M21 12H11"></path>
      <path d="M21 19H11"></path>
      <path d="m7 8-4 4 4 4"></path>
    </svg>
  );
}
