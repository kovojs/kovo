/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Gallery Vertical End icon (Lucide). https://lucide.dev/icons/gallery-vertical-end */
export function GalleryVerticalEnd(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M7 2h10"></path>
      <path d="M5 6h14"></path>
      <rect width="18" height="12" x="3" y="10" rx="2"></rect>
    </svg>
  );
}
