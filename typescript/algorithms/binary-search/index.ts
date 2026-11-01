export function firstIndex(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    const value = values[mid];
    if (value === undefined) throw new RangeError('índice inesperado');
    if (value < target) low = mid + 1;
    else high = mid;
  }
  return values[low] === target ? low : -1;
}
