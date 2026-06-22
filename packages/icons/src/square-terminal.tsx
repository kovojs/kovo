/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Terminal icon (Lucide). https://lucide.dev/icons/square-terminal */
export function SquareTerminal(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m7 11 2-2-2-2"></path>
      <path d="M11 13h4"></path>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
    </svg>
  );
}
