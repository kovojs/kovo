/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Smartphone Charging icon (Lucide). https://lucide.dev/icons/smartphone-charging */
export function SmartphoneCharging(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2"></rect>
      <path d="M12.667 8 10 12h4l-2.667 4"></path>
    </svg>
  );
}
