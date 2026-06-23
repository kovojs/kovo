/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Align Horizontal Distribute Start icon (Lucide). https://lucide.dev/icons/align-horizontal-distribute-start */
export function AlignHorizontalDistributeStart(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="6" height="14" x="4" y="5" rx="2"></rect>
      <rect width="6" height="10" x="14" y="7" rx="2"></rect>
      <path d="M4 2v20"></path>
      <path d="M14 2v20"></path>
    </svg>
  );
}
