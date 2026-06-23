/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Arrow Down Left icon (Lucide). https://lucide.dev/icons/square-arrow-down-left */
export function SquareArrowDownLeft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 15H9l6-6"></path>
      <path d="M9 15V9"></path>
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
    </svg>
  );
}
