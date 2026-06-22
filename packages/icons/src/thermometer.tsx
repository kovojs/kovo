/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Thermometer icon (Lucide). https://lucide.dev/icons/thermometer */
export function Thermometer(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"></path>
    </svg>
  );
}
