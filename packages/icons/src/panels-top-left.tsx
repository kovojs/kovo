/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Panels Top Left icon (Lucide). https://lucide.dev/icons/panels-top-left */
export function PanelsTopLeft(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M3 9h18"></path>
      <path d="M9 21V9"></path>
    </svg>
  );
}
