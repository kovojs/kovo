/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Down 0 1 icon (Lucide). https://lucide.dev/icons/arrow-down-0-1 */
export function ArrowDown01(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m3 16 4 4 4-4"></path>
      <path d="M7 20V4"></path>
      <rect x="15" y="4" width="4" height="6" ry="2"></rect>
      <path d="M17 20v-6h-2"></path>
      <path d="M15 20h4"></path>
    </svg>
  );
}
