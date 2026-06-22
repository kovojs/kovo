/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Arrow Down Wide Narrow icon (Lucide). https://lucide.dev/icons/arrow-down-wide-narrow */
export function ArrowDownWideNarrow(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m3 16 4 4 4-4"></path>
      <path d="M7 20V4"></path>
      <path d="M11 4h10"></path>
      <path d="M11 8h7"></path>
      <path d="M11 12h4"></path>
    </svg>
  );
}
