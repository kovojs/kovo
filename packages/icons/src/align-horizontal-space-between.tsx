/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Align Horizontal Space Between icon (Lucide). https://lucide.dev/icons/align-horizontal-space-between */
export function AlignHorizontalSpaceBetween(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="6" height="14" x="3" y="5" rx="2"></rect>
      <rect width="6" height="10" x="15" y="7" rx="2"></rect>
      <path d="M3 2v20"></path>
      <path d="M21 2v20"></path>
    </svg>
  );
}
