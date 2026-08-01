import {
  freezeSecurityValue,
  securityArrayAppend,
  securityDefineProperty,
} from '#security-witness-intrinsics';

/** @internal Fixed retention ceiling for process-local runtime audit observations (SPEC §9.5). */
const RUNTIME_AUDIT_FACT_CAPACITY = 256;

/** @internal Bounded process-local audit observation buffer. */
interface BoundedRuntimeAuditCollector<Fact> {
  /** Drain retained facts in observation order and reset the collector for reuse. */
  drain(): Fact[];
  /** Record one fact, dropping the oldest retained fact on overflow. */
  record(fact: Fact): void;
}

/**
 * Build a fixed-capacity process-local audit collector (SPEC §9.5 bounded availability).
 *
 * Runtime audit observations are defense-in-depth; for audited escapes with build/explain
 * call-site facts, those static facts remain the authoritative inventory. The collector therefore
 * retains the most recent bounded window and drops the oldest observation on overflow. Draining is
 * destructive, preserves chronological order, releases retained object references, and leaves the
 * collector reusable.
 *
 * @internal
 */
export function createBoundedRuntimeAuditCollector<Fact>(
  capacity = RUNTIME_AUDIT_FACT_CAPACITY,
): BoundedRuntimeAuditCollector<Fact> {
  if (
    typeof capacity !== 'number' ||
    capacity !== capacity ||
    capacity % 1 !== 0 ||
    capacity <= 0 ||
    capacity > RUNTIME_AUDIT_FACT_CAPACITY
  ) {
    throw new TypeError(
      `Runtime audit collector capacity must be an integer from 1 to ${RUNTIME_AUDIT_FACT_CAPACITY}.`,
    );
  }

  const retained: (Fact | undefined)[] = [];
  for (let index = 0; index < capacity; index += 1) {
    securityArrayAppend(retained, undefined);
  }
  let head = 0;
  let size = 0;

  return freezeSecurityValue({
    drain(): Fact[] {
      const facts: Fact[] = [];
      for (let index = 0; index < size; index += 1) {
        securityArrayAppend(facts, retained[(head + index) % capacity]!);
      }
      for (let index = 0; index < capacity; index += 1) {
        securityDefineProperty(retained, index, {
          configurable: true,
          enumerable: true,
          value: undefined,
          writable: true,
        });
      }
      head = 0;
      size = 0;
      return facts;
    },
    record(fact: Fact): void {
      if (size < capacity) {
        retained[(head + size) % capacity] = fact;
        size += 1;
        return;
      }
      retained[head] = fact;
      head = (head + 1) % capacity;
    },
  });
}
