/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Up Wide Narrow icon (Lucide). https://lucide.dev/icons/arrow-up-wide-narrow */
export function ArrowUpWideNarrow(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m3 8 4-4 4 4"></path>
      <path d="M7 4v16"></path>
      <path d="M11 12h10"></path>
      <path d="M11 16h7"></path>
      <path d="M11 20h4"></path>
    </svg>
  );
}
