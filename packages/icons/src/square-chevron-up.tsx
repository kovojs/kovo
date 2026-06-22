/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Chevron Up icon (Lucide). https://lucide.dev/icons/square-chevron-up */
export function SquareChevronUp(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="m8 14 4-4 4 4"></path>
    </svg>
  );
}
