/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Paw Print icon (Lucide). https://lucide.dev/icons/paw-print */
export function PawPrint(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <circle cx="11" cy="4" r="2"></circle>
      <circle cx="18" cy="8" r="2"></circle>
      <circle cx="20" cy="16" r="2"></circle>
      <path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"></path>
    </svg>
  );
}
