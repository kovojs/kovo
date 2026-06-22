/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Centerline Dashed Vertical icon (Lucide). https://lucide.dev/icons/square-centerline-dashed-vertical */
export function SquareCenterlineDashedVertical(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3"></path>
      <path d="M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3"></path>
      <path d="M4 12H2"></path>
      <path d="M10 12H8"></path>
      <path d="M16 12h-2"></path>
      <path d="M22 12h-2"></path>
    </svg>
  );
}
