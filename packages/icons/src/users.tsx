/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Users icon (Lucide). https://lucide.dev/icons/users */
export function Users(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
      <path d="M16 3.128a4 4 0 0 1 0 7.744"></path>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
      <circle cx="9" cy="7" r="4"></circle>
    </svg>
  );
}
