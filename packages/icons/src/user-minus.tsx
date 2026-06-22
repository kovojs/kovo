/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** User Minus icon (Lucide). https://lucide.dev/icons/user-minus */
export function UserMinus(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <line x1="22" x2="16" y1="11" y2="11"></line>
    </svg>
  );
}
