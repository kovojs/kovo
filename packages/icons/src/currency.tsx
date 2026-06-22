/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Currency icon (Lucide). https://lucide.dev/icons/currency */
export function Currency(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="8"></circle>
      <line x1="3" x2="6" y1="3" y2="6"></line>
      <line x1="21" x2="18" y1="3" y2="6"></line>
      <line x1="3" x2="6" y1="21" y2="18"></line>
      <line x1="21" x2="18" y1="21" y2="18"></line>
    </svg>
  );
}
