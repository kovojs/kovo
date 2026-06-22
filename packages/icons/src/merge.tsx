/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Merge icon (Lucide). https://lucide.dev/icons/merge */
export function Merge(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m8 6 4-4 4 4"></path>
      <path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"></path>
      <path d="m20 22-5-5"></path>
    </svg>
  );
}
