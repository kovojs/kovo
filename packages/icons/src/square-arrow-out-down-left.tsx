/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Arrow Out Down Left icon (Lucide). https://lucide.dev/icons/square-arrow-out-down-left */
export function SquareArrowOutDownLeft(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M13 21h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6"></path>
      <path d="m3 21 9-9"></path>
      <path d="M9 21H3v-6"></path>
    </svg>
  );
}
