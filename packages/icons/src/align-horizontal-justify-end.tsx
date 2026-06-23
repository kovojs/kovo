/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Align Horizontal Justify End icon (Lucide). https://lucide.dev/icons/align-horizontal-justify-end */
export function AlignHorizontalJustifyEnd(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="6" height="14" x="2" y="5" rx="2"></rect>
      <rect width="6" height="10" x="12" y="7" rx="2"></rect>
      <path d="M22 2v20"></path>
    </svg>
  );
}
