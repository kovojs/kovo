/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Construction icon (Lucide). https://lucide.dev/icons/construction */
export function Construction(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect x="2" y="6" width="20" height="8" rx="1"></rect>
      <path d="M17 14v7"></path>
      <path d="M7 14v7"></path>
      <path d="M17 3v3"></path>
      <path d="M7 3v3"></path>
      <path d="M10 14 2.3 6.3"></path>
      <path d="m14 6 7.7 7.7"></path>
      <path d="m8 6 8 8"></path>
    </svg>
  );
}
