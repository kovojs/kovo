/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Equal icon (Lucide). https://lucide.dev/icons/square-equal */
export function SquareEqual(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M7 10h10"></path>
      <path d="M7 14h10"></path>
    </svg>
  );
}
