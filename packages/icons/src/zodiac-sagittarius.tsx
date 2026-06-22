/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Zodiac Sagittarius icon (Lucide). https://lucide.dev/icons/zodiac-sagittarius */
export function ZodiacSagittarius(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 3h6v6"></path>
      <path d="M21 3 3 21"></path>
      <path d="m9 9 6 6"></path>
    </svg>
  );
}
