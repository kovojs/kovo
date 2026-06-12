import { compileComponentModule } from './compile.js';
import type { CompileComponentOptions, CompileResult, EmittedFile } from './types.js';

type EmittedFileByKind = Partial<Record<EmittedFile['kind'], EmittedFile>>;

export interface CompileFixtureResult extends CompileResult {
  filesByKind: EmittedFileByKind;
}

export function compileFixture(options: CompileComponentOptions): CompileFixtureResult {
  const result = compileComponentModule(options);
  const filesByKind: EmittedFileByKind = {};

  for (const file of result.files) {
    filesByKind[file.kind] = file;
  }

  return { ...result, filesByKind };
}
