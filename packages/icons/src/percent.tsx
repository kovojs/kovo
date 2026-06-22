/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Percent icon (Lucide). https://lucide.dev/icons/percent */
export function Percent(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <line x1="19" x2="5" y1="5" y2="19"></line>
      <circle cx="6.5" cy="6.5" r="2.5"></circle>
      <circle cx="17.5" cy="17.5" r="2.5"></circle>
    </svg>
  );
}
