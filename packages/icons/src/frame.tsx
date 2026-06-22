/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Frame icon (Lucide). https://lucide.dev/icons/frame */
export function Frame(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <line x1="22" x2="2" y1="6" y2="6"></line>
      <line x1="22" x2="2" y1="18" y2="18"></line>
      <line x1="6" x2="6" y1="2" y2="22"></line>
      <line x1="18" x2="18" y1="2" y2="22"></line>
    </svg>
  );
}
