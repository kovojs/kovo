/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Touchpad icon (Lucide). https://lucide.dev/icons/touchpad */
export function Touchpad(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="20" height="16" x="2" y="4" rx="2"></rect>
      <path d="M2 14h20"></path>
      <path d="M12 20v-6"></path>
    </svg>
  );
}
