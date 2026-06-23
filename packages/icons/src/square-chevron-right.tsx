/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Chevron Right icon (Lucide). https://lucide.dev/icons/square-chevron-right */
export function SquareChevronRight(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="m10 8 4 4-4 4"></path>
    </svg>
  );
}
