/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Arrow Out Up Right icon (Lucide). https://lucide.dev/icons/square-arrow-out-up-right */
export function SquareArrowOutUpRight(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"></path>
      <path d="m21 3-9 9"></path>
      <path d="M15 3h6v6"></path>
    </svg>
  );
}
