/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Videotape icon (Lucide). https://lucide.dev/icons/videotape */
export function Videotape(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="20" height="16" x="2" y="4" rx="2"></rect>
      <path d="M2 8h20"></path>
      <circle cx="8" cy="14" r="2"></circle>
      <path d="M8 12h8"></path>
      <circle cx="16" cy="14" r="2"></circle>
    </svg>
  );
}
