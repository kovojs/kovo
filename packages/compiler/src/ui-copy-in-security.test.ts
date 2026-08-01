import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const compilerSourceDirectory = dirname(fileURLToPath(import.meta.url));
const uiSourceDirectory = resolve(compilerSourceDirectory, '../../ui/src');

describe('@kovojs/ui copy-in compiler security', () => {
  it('keeps every vendored anchor free of opaque execution-control spreads', () => {
    const findings = readdirSync(uiSourceDirectory)
      .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
      .sort((left, right) => left.localeCompare(right))
      .flatMap((name) => {
        const fileName = join(uiSourceDirectory, name);
        const source = readFileSync(fileName, 'utf8');
        const sourceFile = ts.createSourceFile(
          fileName,
          source,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        );
        const fileFindings: {
          readonly column: number;
          readonly file: string;
          readonly line: number;
        }[] = [];
        const visit = (node: ts.Node): void => {
          const opening = ts.isJsxElement(node)
            ? node.openingElement
            : ts.isJsxSelfClosingElement(node)
              ? node
              : null;
          if (opening?.tagName.getText(sourceFile) === 'a') {
            for (const attribute of opening.attributes.properties) {
              if (
                ts.isJsxSpreadAttribute(attribute) &&
                ts.isCallExpression(attribute.expression) &&
                ts.isIdentifier(attribute.expression.expression) &&
                attribute.expression.expression.text === 'passThroughProps'
              ) {
                const position = sourceFile.getLineAndCharacterOfPosition(
                  attribute.getStart(sourceFile),
                );
                fileFindings.push({
                  column: position.character + 1,
                  file: name,
                  line: position.line + 1,
                });
              }
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return fileFindings;
      });

    expect(findings).toEqual([]);
  });
});
