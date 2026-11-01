import assert from 'node:assert/strict';
import test from 'node:test';
import { firstIndex } from './index.mjs';

test('lista vazia', () => assert.equal(firstIndex([], 1), -1));
test('primeira ocorrência', () => assert.equal(firstIndex([1, 2, 2, 4], 2), 1));
test('ausente', () => assert.equal(firstIndex([1, 3], 2), -1));
