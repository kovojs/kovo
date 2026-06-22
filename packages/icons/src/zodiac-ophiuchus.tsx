/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Zodiac Ophiuchus icon (Lucide). https://lucide.dev/icons/zodiac-ophiuchus */
export function ZodiacOphiuchus(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 10A6.06 6.06 0 0 1 12 10 A6.06 6.06 0 0 0 21 10"></path>
      <path d="M6 3v12a6 6 0 0 0 12 0V3"></path>
    </svg>
  );
}
