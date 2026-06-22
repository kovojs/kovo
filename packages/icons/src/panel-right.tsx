/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Panel Right icon (Lucide). https://lucide.dev/icons/panel-right */
export function PanelRight(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M15 3v18"></path>
    </svg>
  );
}
