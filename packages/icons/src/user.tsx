/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** User icon (Lucide). https://lucide.dev/icons/user */
export function User(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>
  );
}
