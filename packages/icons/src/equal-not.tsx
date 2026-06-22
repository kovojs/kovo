/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Equal Not icon (Lucide). https://lucide.dev/icons/equal-not */
export function EqualNot(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <line x1="5" x2="19" y1="9" y2="9"></line>
      <line x1="5" x2="19" y1="15" y2="15"></line>
      <line x1="19" x2="5" y1="5" y2="19"></line>
    </svg>
  );
}
