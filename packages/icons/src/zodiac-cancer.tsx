/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Zodiac Cancer icon (Lucide). https://lucide.dev/icons/zodiac-cancer */
export function ZodiacCancer(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M21 14.5A9 6.5 0 0 1 5.5 19"></path>
      <path d="M3 9.5A9 6.5 0 0 1 18.5 5"></path>
      <circle cx="17.5" cy="14.5" r="3.5"></circle>
      <circle cx="6.5" cy="9.5" r="3.5"></circle>
    </svg>
  );
}
