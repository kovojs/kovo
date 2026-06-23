/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Arrow Right Exit icon (Lucide). https://lucide.dev/icons/square-arrow-right-exit */
export function SquareArrowRightExit(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 12h11"></path>
      <path d="m17 16 4-4-4-4"></path>
      <path d="M21 6.344V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1.344"></path>
    </svg>
  );
}
