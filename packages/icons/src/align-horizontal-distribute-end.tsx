/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Align Horizontal Distribute End icon (Lucide). https://lucide.dev/icons/align-horizontal-distribute-end */
export function AlignHorizontalDistributeEnd(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="6" height="14" x="4" y="5" rx="2"></rect>
      <rect width="6" height="10" x="14" y="7" rx="2"></rect>
      <path d="M10 2v20"></path>
      <path d="M20 2v20"></path>
    </svg>
  );
}
