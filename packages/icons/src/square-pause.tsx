/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Pause icon (Lucide). https://lucide.dev/icons/square-pause */
export function SquarePause(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <line x1="10" x2="10" y1="15" y2="9"></line>
      <line x1="14" x2="14" y1="15" y2="9"></line>
    </svg>
  );
}
