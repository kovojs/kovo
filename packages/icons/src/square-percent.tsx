/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Percent icon (Lucide). https://lucide.dev/icons/square-percent */
export function SquarePercent(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="m15 9-6 6"></path>
      <path d="M9 9h.01"></path>
      <path d="M15 15h.01"></path>
    </svg>
  );
}
