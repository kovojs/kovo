/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Maximize 2 icon (Lucide). https://lucide.dev/icons/maximize-2 */
export function Maximize2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 3h6v6"></path>
      <path d="m21 3-7 7"></path>
      <path d="m3 21 7-7"></path>
      <path d="M9 21H3v-6"></path>
    </svg>
  );
}
