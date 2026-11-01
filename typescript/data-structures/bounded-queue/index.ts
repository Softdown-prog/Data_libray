export class BoundedQueue<T> {
  private readonly items: T[] = [];

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError('capacity deve ser inteiro positivo');
    }
  }

  enqueue(value: T): boolean {
    if (this.items.length >= this.capacity) return false;
    this.items.push(value);
    return true;
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  get size(): number {
    return this.items.length;
  }
}
