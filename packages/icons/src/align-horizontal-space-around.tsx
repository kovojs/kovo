/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Align Horizontal Space Around icon (Lucide). https://lucide.dev/icons/align-horizontal-space-around */
export function AlignHorizontalSpaceAround(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="6" height="10" x="9" y="7" rx="2"></rect>
      <path d="M4 22V2"></path>
      <path d="M20 22V2"></path>
    </svg>
  );
}
