/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Arrow Up Narrow Wide icon (Lucide). https://lucide.dev/icons/arrow-up-narrow-wide */
export function ArrowUpNarrowWide(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m3 8 4-4 4 4"></path>
      <path d="M7 4v16"></path>
      <path d="M11 12h4"></path>
      <path d="M11 16h7"></path>
      <path d="M11 20h10"></path>
    </svg>
  );
}
