/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Dollar Sign icon (Lucide). https://lucide.dev/icons/circle-dollar-sign */
export function CircleDollarSign(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"></path>
      <path d="M12 18V6"></path>
    </svg>
  );
}
