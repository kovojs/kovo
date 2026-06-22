/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Map Pin Check Inside icon (Lucide). https://lucide.dev/icons/map-pin-check-inside */
export function MapPinCheckInside(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path>
      <path d="m9 10 2 2 4-4"></path>
    </svg>
  );
}
