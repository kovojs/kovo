/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Paint Roller icon (Lucide). https://lucide.dev/icons/paint-roller */
export function PaintRoller(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="16" height="6" x="2" y="2" rx="2"></rect>
      <path d="M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"></path>
      <rect width="4" height="6" x="8" y="16" rx="1"></rect>
    </svg>
  );
}
