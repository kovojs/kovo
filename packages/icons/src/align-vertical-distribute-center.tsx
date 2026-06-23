/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Align Vertical Distribute Center icon (Lucide). https://lucide.dev/icons/align-vertical-distribute-center */
export function AlignVerticalDistributeCenter(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M22 17h-3"></path>
      <path d="M22 7h-5"></path>
      <path d="M5 17H2"></path>
      <path d="M7 7H2"></path>
      <rect x="5" y="14" width="14" height="6" rx="2"></rect>
      <rect x="7" y="4" width="10" height="6" rx="2"></rect>
    </svg>
  );
}
