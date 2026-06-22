/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Panel Left Open icon (Lucide). https://lucide.dev/icons/panel-left-open */
export function PanelLeftOpen(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M9 3v18"></path>
      <path d="m14 9 3 3-3 3"></path>
    </svg>
  );
}
