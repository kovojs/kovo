/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Battery Full icon (Lucide). https://lucide.dev/icons/battery-full */
export function BatteryFull(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 10v4"></path>
      <path d="M14 10v4"></path>
      <path d="M22 14v-4"></path>
      <path d="M6 10v4"></path>
      <rect x="2" y="6" width="16" height="12" rx="2"></rect>
    </svg>
  );
}
