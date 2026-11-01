import { firstIndex } from './index.js';

function equal(actual: number, expected: number): void {
  if (actual !== expected) throw new Error(`expected ${expected}, got ${actual}`);
}
equal(firstIndex([], 1), -1);
equal(firstIndex([1, 2, 2, 4], 2), 1);
equal(firstIndex([1, 3], 2), -1);
