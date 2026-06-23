/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Zodiac Capricorn icon (Lucide). https://lucide.dev/icons/zodiac-capricorn */
export function ZodiacCapricorn(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M11 21a3 3 0 0 0 3-3V6.5a1 1 0 0 0-7 0"></path>
      <path d="M7 19V6a3 3 0 0 0-3-3h0"></path>
      <circle cx="17" cy="17" r="3"></circle>
    </svg>
  );
}
