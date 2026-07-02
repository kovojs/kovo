export interface ParanoidGeneratorAcceptanceCase {
  expectation: 'legitimate-build-green' | 'static-classifiers-stubbed' | 'unsafe-runtime-choke';
  id: string;
  kind: 'build-env' | 'runtime-route';
  route?: string;
  sink?: string;
  surface: string;
}

export function generateParanoidGeneratorAcceptanceCases(options?: {
  seed?: string;
}): ParanoidGeneratorAcceptanceCase[];
