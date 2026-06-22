/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Gallery Thumbnails icon (Lucide). https://lucide.dev/icons/gallery-thumbnails */
export function GalleryThumbnails(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="14" x="3" y="3" rx="2"></rect>
      <path d="M4 21h1"></path>
      <path d="M9 21h1"></path>
      <path d="M14 21h1"></path>
      <path d="M19 21h1"></path>
    </svg>
  );
}
