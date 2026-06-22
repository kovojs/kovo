/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Fence icon (Lucide). https://lucide.dev/icons/fence */
export function Fence(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 3 2 5v15c0 .6.4 1 1 1h2c.6 0 1-.4 1-1V5Z"></path>
      <path d="M6 8h4"></path>
      <path d="M6 18h4"></path>
      <path d="m12 3-2 2v15c0 .6.4 1 1 1h2c.6 0 1-.4 1-1V5Z"></path>
      <path d="M14 8h4"></path>
      <path d="M14 18h4"></path>
      <path d="m20 3-2 2v15c0 .6.4 1 1 1h2c.6 0 1-.4 1-1V5Z"></path>
    </svg>
  );
}
