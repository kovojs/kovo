/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Slice icon (Lucide). https://lucide.dev/icons/slice */
export function Slice(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M11 16.586V19a1 1 0 0 1-1 1H2L18.37 3.63a1 1 0 1 1 3 3l-9.663 9.663a1 1 0 0 1-1.414 0L8 14"></path>
    </svg>
  );
}
