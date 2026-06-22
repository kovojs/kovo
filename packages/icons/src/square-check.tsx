/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Check icon (Lucide). https://lucide.dev/icons/square-check */
export function SquareCheck(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="m9 12 2 2 4-4"></path>
    </svg>
  );
}
