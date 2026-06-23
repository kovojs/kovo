/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Align Vertical Distribute End icon (Lucide). https://lucide.dev/icons/align-vertical-distribute-end */
export function AlignVerticalDistributeEnd(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="14" height="6" x="5" y="14" rx="2"></rect>
      <rect width="10" height="6" x="7" y="4" rx="2"></rect>
      <path d="M2 20h20"></path>
      <path d="M2 10h20"></path>
    </svg>
  );
}
