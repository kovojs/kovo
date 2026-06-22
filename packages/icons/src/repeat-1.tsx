/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Repeat 1 icon (Lucide). https://lucide.dev/icons/repeat-1 */
export function Repeat1(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m17 2 4 4-4 4"></path>
      <path d="M3 11v-1a4 4 0 0 1 4-4h14"></path>
      <path d="m7 22-4-4 4-4"></path>
      <path d="M21 13v1a4 4 0 0 1-4 4H3"></path>
      <path d="M11 10h1v4"></path>
    </svg>
  );
}
