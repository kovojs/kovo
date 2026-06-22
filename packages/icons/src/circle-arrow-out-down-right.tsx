/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Arrow Out Down Right icon (Lucide). https://lucide.dev/icons/circle-arrow-out-down-right */
export function CircleArrowOutDownRight(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 22a10 10 0 1 1 10-10"></path>
      <path d="M22 22 12 12"></path>
      <path d="M22 16v6h-6"></path>
    </svg>
  );
}
