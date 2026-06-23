/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Panel Bottom Open icon (Lucide). https://lucide.dev/icons/panel-bottom-open */
export function PanelBottomOpen(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M3 15h18"></path>
      <path d="m9 10 3-3 3 3"></path>
    </svg>
  );
}
