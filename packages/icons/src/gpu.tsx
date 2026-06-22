/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Gpu icon (Lucide). https://lucide.dev/icons/gpu */
export function Gpu(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M2 17h18a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H2"></path>
      <path d="M2 21V3"></path>
      <path d="M7 17v3a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-3"></path>
      <circle cx="16" cy="11" r="2"></circle>
      <circle cx="8" cy="11" r="2"></circle>
    </svg>
  );
}
