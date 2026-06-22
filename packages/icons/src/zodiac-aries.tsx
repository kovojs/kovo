/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Zodiac Aries icon (Lucide). https://lucide.dev/icons/zodiac-aries */
export function ZodiacAries(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 7.5a4.5 4.5 0 1 1 5 4.5"></path>
      <path d="M7 12a4.5 4.5 0 1 1 5-4.5V21"></path>
    </svg>
  );
}
