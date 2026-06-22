/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Equal icon (Lucide). https://lucide.dev/icons/circle-equal */
export function CircleEqual(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M7 10h10"></path>
      <path d="M7 14h10"></path>
    </svg>
  );
}
