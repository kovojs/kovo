/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Align Vertical Space Around icon (Lucide). https://lucide.dev/icons/align-vertical-space-around */
export function AlignVerticalSpaceAround(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="10" height="6" x="7" y="9" rx="2"></rect>
      <path d="M22 20H2"></path>
      <path d="M22 4H2"></path>
    </svg>
  );
}
