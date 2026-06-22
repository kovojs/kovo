/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Picture In Picture icon (Lucide). https://lucide.dev/icons/picture-in-picture */
export function PictureInPicture(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 10h6V4"></path>
      <path d="m2 4 6 6"></path>
      <path d="M21 10V7a2 2 0 0 0-2-2h-7"></path>
      <path d="M3 14v2a2 2 0 0 0 2 2h3"></path>
      <rect x="12" y="14" width="10" height="7" rx="1"></rect>
    </svg>
  );
}
