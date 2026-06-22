/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Layout Grid icon (Lucide). https://lucide.dev/icons/layout-grid */
export function LayoutGrid(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="7" height="7" x="3" y="3" rx="1"></rect>
      <rect width="7" height="7" x="14" y="3" rx="1"></rect>
      <rect width="7" height="7" x="14" y="14" rx="1"></rect>
      <rect width="7" height="7" x="3" y="14" rx="1"></rect>
    </svg>
  );
}
