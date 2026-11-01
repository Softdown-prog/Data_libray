import { BoundedQueue } from './index.js';

const q = new BoundedQueue<string>(2);
if (!q.enqueue('a') || !q.enqueue('b') || q.enqueue('c')) throw new Error('capacity');
if (q.dequeue() !== 'a' || q.dequeue() !== 'b') throw new Error('FIFO');
if (q.dequeue() !== undefined || q.size !== 0) throw new Error('empty');
let invalid = false;
try { new BoundedQueue(0); } catch (error: unknown) { invalid = error instanceof RangeError; }
if (!invalid) throw new Error('expected RangeError');
