/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Align Vertical Justify End icon (Lucide). https://lucide.dev/icons/align-vertical-justify-end */
export function AlignVerticalJustifyEnd(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="14" height="6" x="5" y="12" rx="2"></rect>
      <rect width="10" height="6" x="7" y="2" rx="2"></rect>
      <path d="M2 22h20"></path>
    </svg>
  );
}
