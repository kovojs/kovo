/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Scissors icon (Lucide). https://lucide.dev/icons/scissors */
export function Scissors(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="6" cy="6" r="3"></circle>
      <path d="M8.12 8.12 12 12"></path>
      <path d="M20 4 8.12 15.88"></path>
      <circle cx="6" cy="18" r="3"></circle>
      <path d="M14.8 14.8 20 20"></path>
    </svg>
  );
}
