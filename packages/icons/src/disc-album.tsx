/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Disc Album icon (Lucide). https://lucide.dev/icons/disc-album */
export function DiscAlbum(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <circle cx="12" cy="12" r="5"></circle>
      <path d="M12 12h.01"></path>
    </svg>
  );
}
