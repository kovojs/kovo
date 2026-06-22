/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Parking icon (Lucide). https://lucide.dev/icons/circle-parking */
export function CircleParking(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M9 17V7h4a3 3 0 0 1 0 6H9"></path>
    </svg>
  );
}
