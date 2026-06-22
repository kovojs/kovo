/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Down Up icon (Lucide). https://lucide.dev/icons/arrow-down-up */
export function ArrowDownUp(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m3 16 4 4 4-4"></path>
      <path d="M7 20V4"></path>
      <path d="m21 8-4-4-4 4"></path>
      <path d="M17 4v16"></path>
    </svg>
  );
}
