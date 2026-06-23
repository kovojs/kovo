/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Align End Horizontal icon (Lucide). https://lucide.dev/icons/align-end-horizontal */
export function AlignEndHorizontal(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="6" height="16" x="4" y="2" rx="2"></rect>
      <rect width="6" height="9" x="14" y="9" rx="2"></rect>
      <path d="M22 22H2"></path>
    </svg>
  );
}
