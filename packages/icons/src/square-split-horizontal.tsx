/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Split Horizontal icon (Lucide). https://lucide.dev/icons/square-split-horizontal */
export function SquareSplitHorizontal(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M8 19H5c-1 0-2-1-2-2V7c0-1 1-2 2-2h3"></path>
      <path d="M16 5h3c1 0 2 1 2 2v10c0 1-1 2-2 2h-3"></path>
      <line x1="12" x2="12" y1="4" y2="20"></line>
    </svg>
  );
}
