/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Arrow Down Narrow Wide icon (Lucide). https://lucide.dev/icons/arrow-down-narrow-wide */
export function ArrowDownNarrowWide(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m3 16 4 4 4-4"></path>
      <path d="M7 20V4"></path>
      <path d="M11 4h4"></path>
      <path d="M11 8h7"></path>
      <path d="M11 12h10"></path>
    </svg>
  );
}
