/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Panel Right Dashed icon (Lucide). https://lucide.dev/icons/panel-right-dashed */
export function PanelRightDashed(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M15 14v1"></path>
      <path d="M15 19v2"></path>
      <path d="M15 3v2"></path>
      <path d="M15 9v1"></path>
    </svg>
  );
}
