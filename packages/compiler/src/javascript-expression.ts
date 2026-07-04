import * as ts from 'typescript';

const expressionBinding = '__kovoDeriveExpression';
const expressionPrefix = `const ${expressionBinding} = `;

const expressionCompilerOptions: ts.CompilerOptions = {
  jsx: ts.JsxEmit.Preserve,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
};

export function executableJavaScriptExpression(expression: string): string {
  const trimmed = expression.trim();
  const output = ts
    .transpileModule(`${expressionPrefix}${trimmed};`, {
      compilerOptions: expressionCompilerOptions,
      fileName: 'kovo-derive-expression.ts',
    })
    .outputText.trim();

  const expressionStart = output.indexOf(expressionPrefix);
  if (expressionStart === -1 || !output.endsWith(';')) return trimmed;

  return output.slice(expressionStart + expressionPrefix.length, -1).trim();
}
