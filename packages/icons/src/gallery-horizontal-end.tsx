/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Gallery Horizontal End icon (Lucide). https://lucide.dev/icons/gallery-horizontal-end */
export function GalleryHorizontalEnd(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 7v10"></path>
      <path d="M6 5v14"></path>
      <rect width="12" height="18" x="10" y="3" rx="2"></rect>
    </svg>
  );
}
