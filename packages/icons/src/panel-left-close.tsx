/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Panel Left Close icon (Lucide). https://lucide.dev/icons/panel-left-close */
export function PanelLeftClose(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M9 3v18"></path>
      <path d="m16 15-3-3 3-3"></path>
    </svg>
  );
}
