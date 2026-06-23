/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Square Activity icon (Lucide). https://lucide.dev/icons/square-activity */
export function SquareActivity(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M17 12h-2l-2 5-2-10-2 5H7"></path>
    </svg>
  );
}
