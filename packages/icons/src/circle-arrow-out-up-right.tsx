/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Arrow Out Up Right icon (Lucide). https://lucide.dev/icons/circle-arrow-out-up-right */
export function CircleArrowOutUpRight(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M22 12A10 10 0 1 1 12 2"></path>
      <path d="M22 2 12 12"></path>
      <path d="M16 2h6v6"></path>
    </svg>
  );
}
