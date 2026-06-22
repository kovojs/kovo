/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Gallery Vertical icon (Lucide). https://lucide.dev/icons/gallery-vertical */
export function GalleryVertical(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 2h18"></path>
      <rect width="18" height="12" x="3" y="6" rx="2"></rect>
      <path d="M3 22h18"></path>
    </svg>
  );
}
