/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Spray Can icon (Lucide). https://lucide.dev/icons/spray-can */
export function SprayCan(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M3 3h.01"></path>
      <path d="M7 5h.01"></path>
      <path d="M11 7h.01"></path>
      <path d="M3 7h.01"></path>
      <path d="M7 9h.01"></path>
      <path d="M3 11h.01"></path>
      <rect width="4" height="4" x="15" y="5"></rect>
      <path d="m19 9 2 2v10c0 .6-.4 1-1 1h-6c-.6 0-1-.4-1-1V11l2-2"></path>
      <path d="m13 14 8-2"></path>
      <path d="m13 19 8-2"></path>
    </svg>
  );
}
