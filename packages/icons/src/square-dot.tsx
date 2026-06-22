/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Dot icon (Lucide). https://lucide.dev/icons/square-dot */
export function SquareDot(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <circle cx="12" cy="12" r="1"></circle>
    </svg>
  );
}
