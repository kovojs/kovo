/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Snail icon (Lucide). https://lucide.dev/icons/snail */
export function Snail(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 13a6 6 0 1 0 12 0 4 4 0 1 0-8 0 2 2 0 0 0 4 0"></path>
      <circle cx="10" cy="13" r="8"></circle>
      <path d="M2 21h12c4.4 0 8-3.6 8-8V7a2 2 0 1 0-4 0v6"></path>
      <path d="M18 3 19.1 5.2"></path>
      <path d="M22 3 20.9 5.2"></path>
    </svg>
  );
}
