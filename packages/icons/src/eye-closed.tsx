/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Eye Closed icon (Lucide). https://lucide.dev/icons/eye-closed */
export function EyeClosed(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m15 18-.722-3.25"></path>
      <path d="M2 8a10.645 10.645 0 0 0 20 0"></path>
      <path d="m20 15-1.726-2.05"></path>
      <path d="m4 15 1.726-2.05"></path>
      <path d="m9 18 .722-3.25"></path>
    </svg>
  );
}
