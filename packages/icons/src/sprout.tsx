/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Sprout icon (Lucide). https://lucide.dev/icons/sprout */
export function Sprout(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"></path>
      <path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"></path>
      <path d="M5 21h14"></path>
    </svg>
  );
}
