/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Zodiac Libra icon (Lucide). https://lucide.dev/icons/zodiac-libra */
export function ZodiacLibra(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 16h6.857c.162-.012.19-.323.038-.38a6 6 0 1 1 4.212 0c-.153.057-.125.368.038.38H21"></path>
      <path d="M3 20h18"></path>
    </svg>
  );
}
