/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Chevron Left icon (Lucide). https://lucide.dev/icons/square-chevron-left */
export function SquareChevronLeft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="m14 16-4-4 4-4"></path>
    </svg>
  );
}
