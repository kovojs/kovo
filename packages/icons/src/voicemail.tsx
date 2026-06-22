/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Voicemail icon (Lucide). https://lucide.dev/icons/voicemail */
export function Voicemail(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="6" cy="12" r="4"></circle>
      <circle cx="18" cy="12" r="4"></circle>
      <line x1="6" x2="18" y1="16" y2="16"></line>
    </svg>
  );
}
