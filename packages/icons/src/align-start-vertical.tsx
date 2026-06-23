/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Align Start Vertical icon (Lucide). https://lucide.dev/icons/align-start-vertical */
export function AlignStartVertical(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="9" height="6" x="6" y="14" rx="2"></rect>
      <rect width="16" height="6" x="6" y="4" rx="2"></rect>
      <path d="M2 2v20"></path>
    </svg>
  );
}
