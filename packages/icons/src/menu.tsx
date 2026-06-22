/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Menu icon (Lucide). https://lucide.dev/icons/menu */
export function Menu(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 5h16"></path>
      <path d="M4 12h16"></path>
      <path d="M4 19h16"></path>
    </svg>
  );
}
