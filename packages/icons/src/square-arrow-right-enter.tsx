/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Arrow Right Enter icon (Lucide). https://lucide.dev/icons/square-arrow-right-enter */
export function SquareArrowRightEnter(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m10 16 4-4-4-4"></path>
      <path d="M3 12h11"></path>
      <path d="M3 8V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3"></path>
    </svg>
  );
}
