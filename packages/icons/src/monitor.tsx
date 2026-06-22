/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Monitor icon (Lucide). https://lucide.dev/icons/monitor */
export function Monitor(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="20" height="14" x="2" y="3" rx="2"></rect>
      <line x1="8" x2="16" y1="21" y2="21"></line>
      <line x1="12" x2="12" y1="17" y2="21"></line>
    </svg>
  );
}
