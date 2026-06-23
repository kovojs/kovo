/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Picture In Picture 2 icon (Lucide). https://lucide.dev/icons/picture-in-picture-2 */
export function PictureInPicture2(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"></path>
      <rect width="10" height="7" x="12" y="13" rx="2"></rect>
    </svg>
  );
}
