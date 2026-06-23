/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Arrow Out Down Right icon (Lucide). https://lucide.dev/icons/square-arrow-out-down-right */
export function SquareArrowOutDownRight(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"></path>
      <path d="m21 21-9-9"></path>
      <path d="M21 15v6h-6"></path>
    </svg>
  );
}
