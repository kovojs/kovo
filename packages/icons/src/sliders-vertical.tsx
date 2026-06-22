/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Sliders Vertical icon (Lucide). https://lucide.dev/icons/sliders-vertical */
export function SlidersVertical(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 8h4"></path>
      <path d="M12 21v-9"></path>
      <path d="M12 8V3"></path>
      <path d="M17 16h4"></path>
      <path d="M19 12V3"></path>
      <path d="M19 21v-5"></path>
      <path d="M3 14h4"></path>
      <path d="M5 10V3"></path>
      <path d="M5 21v-7"></path>
    </svg>
  );
}
