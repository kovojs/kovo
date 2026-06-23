/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Underline icon (Lucide). https://lucide.dev/icons/underline */
export function Underline(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M6 4v6a6 6 0 0 0 12 0V4"></path>
      <line x1="4" x2="20" y1="20" y2="20"></line>
    </svg>
  );
}
