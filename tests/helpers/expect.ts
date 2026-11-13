import assert from 'node:assert/strict';

/**
 * A very small `expect` on top of node:assert, so the tests run on Node's
 * built-in test runner with no extra packages (and no native binaries).
 */

type Ctor = abstract new (...args: never[]) => unknown;

function build(actual: unknown, negate: boolean) {
  const check = (pass: boolean, message: string) => {
    if (pass === negate) assert.fail(`expected ${negate ? 'not ' : ''}${message}\nreceived: ${safe(actual)}`);
  };
  const tryAssert = (fn: () => void) => {
    try {
      fn();
      return true;
    } catch {
      return false;
    }
  };
  return {
    toBe: (expected: unknown) => check(Object.is(actual, expected), `to be ${safe(expected)}`),
    toEqual: (expected: unknown) =>
      check(tryAssert(() => assert.deepStrictEqual(actual, expected)), `to equal ${safe(expected)}`),
    toMatchObject: (expected: object) =>
      check(tryAssert(() => assert.partialDeepStrictEqual(toPlain(actual), expected)), `to match ${safe(expected)}`),
    toBeInstanceOf: (ctor: Ctor) => check(actual instanceof ctor, `to be an instance of ${ctor.name}`),
    toContain: (item: unknown) =>
      check(
        typeof actual === 'string' ? actual.includes(String(item)) : Array.isArray(actual) && actual.includes(item),
        `to contain ${safe(item)}`,
      ),
    toHaveLength: (n: number) => check((actual as { length?: number })?.length === n, `to have length ${n}`),
    toMatch: (re: RegExp) => check(typeof actual === 'string' && re.test(actual), `to match ${re}`),
    toBeGreaterThan: (n: number) => check((actual as number) > n, `to be > ${n}`),
    toBeGreaterThanOrEqual: (n: number) => check((actual as number) >= n, `to be >= ${n}`),
    toBeLessThan: (n: number) => check((actual as number) < n, `to be < ${n}`),
    toBeUndefined: () => check(actual === undefined, 'to be undefined'),
    toBeNull: () => check(actual === null, 'to be null'),
    toThrow: (ctor?: Ctor) => {
      let thrown: unknown;
      let didThrow = false;
      try {
        (actual as () => unknown)();
      } catch (e) {
        didThrow = true;
        thrown = e;
      }
      check(didThrow && (!ctor || thrown instanceof ctor), `to throw${ctor ? ` ${ctor.name}` : ''}`);
    },
  };
}

/** Errors keep `name`/`message` off the enumerable surface; copy them so they can be matched. */
function toPlain(value: unknown): unknown {
  if (value instanceof Error) return { ...value, name: value.name, message: value.message };
  return value;
}

function safe(value: unknown): string {
  try {
    const s = JSON.stringify(toPlain(value));
    return s === undefined ? String(value) : s.length > 400 ? `${s.slice(0, 400)}…` : s;
  } catch {
    return String(value);
  }
}

async function settle(promise: unknown): Promise<{ rejected: boolean; reason?: unknown }> {
  try {
    await promise;
    return { rejected: false };
  } catch (reason) {
    return { rejected: true, reason };
  }
}

export function expect(actual: unknown) {
  return {
    ...build(actual, false),
    not: build(actual, true),
    rejects: {
      async toMatchObject(expected: object) {
        const r = await settle(actual);
        if (!r.rejected) assert.fail('expected the promise to reject, but it resolved');
        build(r.reason, false).toMatchObject(expected);
      },
      async toBeInstanceOf(ctor: Ctor) {
        const r = await settle(actual);
        if (!r.rejected) assert.fail('expected the promise to reject, but it resolved');
        build(r.reason, false).toBeInstanceOf(ctor);
      },
    },
  };
}
