/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Bike icon (Lucide). https://lucide.dev/icons/bike */
export function Bike(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="18.5" cy="17.5" r="3.5"></circle>
      <circle cx="5.5" cy="17.5" r="3.5"></circle>
      <circle cx="15" cy="5" r="1"></circle>
      <path d="M12 17.5V14l-3-3 4-3 2 3h2"></path>
    </svg>
  );
}
