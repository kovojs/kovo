/**
 * Numeric CLI-flag parsing for the benchmark harness.
 *
 * Every count in this harness used to be `Number(readArg(flag) ?? default)`. `Number('three')` is
 * `NaN`, and every consumer of these values degrades silently rather than throwing:
 * `for (let i = 0; i < NaN; i += 1)` runs zero times, so `--bfcache-iterations three` produced a
 * plausible-looking `n/a (same-document)` cell with `0/0` applicable runs for EVERY entrant — the
 * probe reported "this framework never leaves its document" about a framework it never probed.
 * A NaN settle window collapses the byte-accounting window the same way.
 *
 * These parsers therefore refuse the value instead of degrading. A benchmark that cannot be trusted
 * to fail loudly on a typo cannot be trusted to report a regression.
 */

/**
 * Reads the token following `name` in `argv`.
 *
 * Returns `undefined` only when the flag is ABSENT. A flag that is present with no operand returns
 * the empty string, so the caller can reject it instead of silently taking the default — the two
 * cases mean different things and only one of them is a typo.
 *
 * @param {string} name
 * @param {readonly string[]} [argv]
 * @returns {string | undefined}
 */
export function readArg(name, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index !== -1) return argv[index + 1] ?? '';
  // Equals form (`--iterations=5`). Without this, the equals form parses as an unrecognized
  // operand and the run silently proceeds on defaults — a false-looking result rather than an
  // error, which is exactly the failure mode this harness exists to prevent.
  const equals = argv.find((token) => token.startsWith(`${name}=`));
  if (equals !== undefined) return equals.slice(name.length + 1);
  return undefined;
}

/**
 * Parses an integer CLI flag, rejecting anything that is not a whole number in `[min, max]`.
 *
 * A flag-shaped operand (`--iterations --skip-build`) fails this check too, because `Number('--x')`
 * is `NaN`; the error names the value that was actually read so the mistake is obvious.
 *
 * @param {string} name Flag name as typed on the command line, for the error message.
 * @param {string | number | undefined} raw Raw value; `undefined` selects `fallback`.
 * @param {{ fallback: number, max?: number, min?: number }} options
 * @returns {number}
 */
export function parseIntegerFlag(name, raw, { fallback, max = Number.MAX_SAFE_INTEGER, min = 1 }) {
  if (raw === undefined) return fallback;
  if (raw === '')
    throw new Error(`${name} requires a value (an integer between ${min} and ${max}).`);
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `${name} must be an integer between ${min} and ${max}, got ${JSON.stringify(String(raw))}.`,
    );
  }
  return value;
}

/**
 * Reads and validates an integer flag in one step.
 *
 * @param {string} name
 * @param {{ argv?: readonly string[], fallback: number, max?: number, min?: number }} options
 * @returns {number}
 */
export function readIntegerArg(name, { argv = process.argv, fallback, max, min }) {
  return parseIntegerFlag(name, readArg(name, argv), { fallback, max, min });
}
