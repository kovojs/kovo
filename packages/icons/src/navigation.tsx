/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Navigation icon (Lucide). https://lucide.dev/icons/navigation */
export function Navigation(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
    </svg>
  );
}
