/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Panel Bottom Close icon (Lucide). https://lucide.dev/icons/panel-bottom-close */
export function PanelBottomClose(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M3 15h18"></path>
      <path d="m15 8-3 3-3-3"></path>
    </svg>
  );
}
