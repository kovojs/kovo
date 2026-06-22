/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Zodiac Gemini icon (Lucide). https://lucide.dev/icons/zodiac-gemini */
export function ZodiacGemini(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 4.525v14.948"></path>
      <path d="M20 3A17 17 0 0 1 4 3"></path>
      <path d="M4 21a17 17 0 0 1 16 0"></path>
      <path d="M8 4.525v14.948"></path>
    </svg>
  );
}
