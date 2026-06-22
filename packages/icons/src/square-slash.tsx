/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Slash icon (Lucide). https://lucide.dev/icons/square-slash */
export function SquareSlash(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <line x1="9" x2="15" y1="15" y2="9"></line>
    </svg>
  );
}
