/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** List Music icon (Lucide). https://lucide.dev/icons/list-music */
export function ListMusic(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 5H3"></path>
      <path d="M11 12H3"></path>
      <path d="M11 19H3"></path>
      <path d="M21 16V5"></path>
      <circle cx="18" cy="16" r="3"></circle>
    </svg>
  );
}
