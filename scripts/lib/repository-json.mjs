import { isDeepStrictEqual } from 'node:util';

const REPOSITORY_FORMAT_OPTIONS = Object.freeze({
  semi: true,
  singleQuote: true,
  sortPackageJson: true,
});

/** Serialize JSON with the same pinned formatter contract enforced by `vp check`. */
export async function formatRepositoryJson(fileName, value, options = {}) {
  if (typeof fileName !== 'string' || fileName.length === 0 || !fileName.endsWith('.json')) {
    throw new TypeError('repository JSON formatting requires a non-empty .json file name');
  }
  const formatter = options.format ?? (await loadRepositoryFormatter());
  const source = `${JSON.stringify(value, null, 2)}\n`;
  const result = await formatter(fileName, source, REPOSITORY_FORMAT_OPTIONS);
  assertFormatResult(fileName, result);
  const fixedPoint = await formatter(fileName, result.code, REPOSITORY_FORMAT_OPTIONS);
  assertFormatResult(fileName, fixedPoint);
  if (fixedPoint.code !== result.code) {
    throw new Error(`repository JSON formatting is not a byte-stable fixed point for ${fileName}`);
  }
  let formatted;
  try {
    formatted = JSON.parse(result.code);
  } catch (error) {
    throw new Error(`repository JSON formatter emitted invalid JSON for ${fileName}`, {
      cause: error,
    });
  }
  if (!isDeepStrictEqual(formatted, value)) {
    throw new Error(`repository JSON formatter changed the value for ${fileName}`);
  }
  return result.code;
}

let repositoryFormatterPromise;

async function loadRepositoryFormatter() {
  repositoryFormatterPromise ??= import('vite-plus/fmt').then((module) => module.format);
  return repositoryFormatterPromise;
}

function assertFormatResult(fileName, result) {
  if (
    !result ||
    typeof result.code !== 'string' ||
    !Array.isArray(result.errors) ||
    result.errors.length > 0
  ) {
    const detail = Array.isArray(result?.errors)
      ? result.errors.map((error) => error?.message ?? String(error)).join('; ')
      : 'formatter returned an invalid result';
    throw new Error(`repository JSON formatting failed for ${fileName}: ${detail}`);
  }
}
