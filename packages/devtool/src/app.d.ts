import type { AppManifestEntry, DataflowBundle } from './index.js';

export type NodeRequestHandler = (req: unknown, res: unknown) => void | Promise<void>;

export function createDevtoolApp(opts: { bundles: DataflowBundle[]; base?: string }): {
  app: unknown;
  requestHandler: unknown;
  nodeHandler: NodeRequestHandler;
  manifest: AppManifestEntry[];
  base: string;
};
