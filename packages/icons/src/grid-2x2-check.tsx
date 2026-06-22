/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Grid 2x2 Check icon (Lucide). https://lucide.dev/icons/grid-2x2-check */
export function Grid2x2Check(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 3v17a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1H3"></path>
      <path d="m16 19 2 2 4-4"></path>
    </svg>
  );
}
