/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Pilcrow icon (Lucide). https://lucide.dev/icons/pilcrow */
export function Pilcrow(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M13 4v16"></path>
      <path d="M17 4v16"></path>
      <path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"></path>
    </svg>
  );
}
