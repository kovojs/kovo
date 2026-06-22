/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Search Check icon (Lucide). https://lucide.dev/icons/search-check */
export function SearchCheck(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m8 11 2 2 4-4"></path>
      <circle cx="11" cy="11" r="8"></circle>
      <path d="m21 21-4.3-4.3"></path>
    </svg>
  );
}
