/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Toggle Left icon (Lucide). https://lucide.dev/icons/toggle-left */
export function ToggleLeft(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="9" cy="12" r="3"></circle>
      <rect width="20" height="14" x="2" y="5" rx="7"></rect>
    </svg>
  );
}
