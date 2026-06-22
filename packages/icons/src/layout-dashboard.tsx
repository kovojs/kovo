/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Layout Dashboard icon (Lucide). https://lucide.dev/icons/layout-dashboard */
export function LayoutDashboard(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="7" height="9" x="3" y="3" rx="1"></rect>
      <rect width="7" height="5" x="14" y="3" rx="1"></rect>
      <rect width="7" height="9" x="14" y="12" rx="1"></rect>
      <rect width="7" height="5" x="3" y="16" rx="1"></rect>
    </svg>
  );
}
