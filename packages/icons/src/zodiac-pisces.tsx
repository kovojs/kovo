/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Zodiac Pisces icon (Lucide). https://lucide.dev/icons/zodiac-pisces */
export function ZodiacPisces(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M19 21a15 15 0 0 1 0-18"></path>
      <path d="M20 12H4"></path>
      <path d="M5 3a15 15 0 0 1 0 18"></path>
    </svg>
  );
}
