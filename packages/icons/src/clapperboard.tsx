/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Clapperboard icon (Lucide). https://lucide.dev/icons/clapperboard */
export function Clapperboard(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m12.296 3.464 3.02 3.956"></path>
      <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"></path>
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
      <path d="m6.18 5.276 3.1 3.899"></path>
    </svg>
  );
}
