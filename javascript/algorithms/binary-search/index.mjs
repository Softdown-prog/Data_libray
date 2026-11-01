export function firstIndex(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low < values.length && values[low] === target ? low : -1;
}
