/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Clock Arrow Left icon (Lucide). https://lucide.dev/icons/clock-arrow-left */
export function ClockArrowLeft(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 6v6l1.5.8"></path>
      <path d="M12.338 21.994a10 10 0 1 1 9.587-8.767"></path>
      <path d="M14 18h8"></path>
      <path d="m18 22-4-4 4-4"></path>
    </svg>
  );
}
