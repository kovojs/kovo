/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Zodiac Taurus icon (Lucide). https://lucide.dev/icons/zodiac-taurus */
export function ZodiacTaurus(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="12" cy="15" r="6"></circle>
      <path d="M18 3A6 6 0 0 1 6 3"></path>
    </svg>
  );
}
