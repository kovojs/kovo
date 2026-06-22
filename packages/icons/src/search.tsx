/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Search icon (Lucide). https://lucide.dev/icons/search */
export function Search(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m21 21-4.34-4.34"></path>
      <circle cx="11" cy="11" r="8"></circle>
    </svg>
  );
}
