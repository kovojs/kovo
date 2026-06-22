/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Disc 3 icon (Lucide). https://lucide.dev/icons/disc-3 */
export function Disc3(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M6 12c0-1.7.7-3.2 1.8-4.2"></path>
      <circle cx="12" cy="12" r="2"></circle>
      <path d="M18 12c0 1.7-.7 3.2-1.8 4.2"></path>
    </svg>
  );
}
