/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Scaling icon (Lucide). https://lucide.dev/icons/scaling */
export function Scaling(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
      <path d="M14 15H9v-5"></path>
      <path d="M16 3h5v5"></path>
      <path d="M21 3 9 15"></path>
    </svg>
  );
}
