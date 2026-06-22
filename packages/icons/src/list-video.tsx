/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** List Video icon (Lucide). https://lucide.dev/icons/list-video */
export function ListVideo(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 5H3"></path>
      <path d="M10 12H3"></path>
      <path d="M10 19H3"></path>
      <path d="M15 12.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z"></path>
    </svg>
  );
}
