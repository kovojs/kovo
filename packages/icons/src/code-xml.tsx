/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Code Xml icon (Lucide). https://lucide.dev/icons/code-xml */
export function CodeXml(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m18 16 4-4-4-4"></path>
      <path d="m6 8-4 4 4 4"></path>
      <path d="m14.5 4-5 16"></path>
    </svg>
  );
}
