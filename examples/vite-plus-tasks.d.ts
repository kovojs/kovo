export interface KovoExampleServeTask {
  command: string;
  input: Array<{
    base: 'workspace';
    pattern: string;
  }>;
}

export function kovoExampleServeTask(): KovoExampleServeTask;
