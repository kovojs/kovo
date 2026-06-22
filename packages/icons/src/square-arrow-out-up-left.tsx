/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Arrow Out Up Left icon (Lucide). https://lucide.dev/icons/square-arrow-out-up-left */
export function SquareArrowOutUpLeft(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6"></path>
      <path d="m3 3 9 9"></path>
      <path d="M3 9V3h6"></path>
    </svg>
  );
}
