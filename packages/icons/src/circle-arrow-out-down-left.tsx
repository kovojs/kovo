/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Circle Arrow Out Down Left icon (Lucide). https://lucide.dev/icons/circle-arrow-out-down-left */
export function CircleArrowOutDownLeft(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 12a10 10 0 1 1 10 10"></path>
      <path d="m2 22 10-10"></path>
      <path d="M8 22H2v-6"></path>
    </svg>
  );
}
