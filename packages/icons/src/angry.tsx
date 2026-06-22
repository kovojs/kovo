/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Angry icon (Lucide). https://lucide.dev/icons/angry */
export function Angry(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M16 16s-1.5-2-4-2-4 2-4 2"></path>
      <path d="M7.5 8 10 9"></path>
      <path d="m14 9 2.5-1"></path>
      <path d="M9 10h.01"></path>
      <path d="M15 10h.01"></path>
    </svg>
  );
}
