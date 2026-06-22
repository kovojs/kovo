/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Pilcrow Left icon (Lucide). https://lucide.dev/icons/pilcrow-left */
export function PilcrowLeft(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M14 3v11"></path>
      <path d="M14 9h-3a3 3 0 0 1 0-6h9"></path>
      <path d="M18 3v11"></path>
      <path d="M22 18H2l4-4"></path>
      <path d="m6 22-4-4"></path>
    </svg>
  );
}
