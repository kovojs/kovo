/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Film icon (Lucide). https://lucide.dev/icons/film */
export function Film(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M7 3v18"></path>
      <path d="M3 7.5h4"></path>
      <path d="M3 12h18"></path>
      <path d="M3 16.5h4"></path>
      <path d="M17 3v18"></path>
      <path d="M17 7.5h4"></path>
      <path d="M17 16.5h4"></path>
    </svg>
  );
}
