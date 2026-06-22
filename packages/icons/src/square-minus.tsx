/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Minus icon (Lucide). https://lucide.dev/icons/square-minus */
export function SquareMinus(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M8 12h8"></path>
    </svg>
  );
}
