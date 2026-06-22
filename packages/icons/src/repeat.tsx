/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Repeat icon (Lucide). https://lucide.dev/icons/repeat */
export function Repeat(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m17 2 4 4-4 4"></path>
      <path d="M3 11v-1a4 4 0 0 1 4-4h14"></path>
      <path d="m7 22-4-4 4-4"></path>
      <path d="M21 13v1a4 4 0 0 1-4 4H3"></path>
    </svg>
  );
}
