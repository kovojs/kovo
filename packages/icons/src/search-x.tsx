/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Search X icon (Lucide). https://lucide.dev/icons/search-x */
export function SearchX(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m13.5 8.5-5 5"></path>
      <path d="m8.5 8.5 5 5"></path>
      <circle cx="11" cy="11" r="8"></circle>
      <path d="m21 21-4.3-4.3"></path>
    </svg>
  );
}
