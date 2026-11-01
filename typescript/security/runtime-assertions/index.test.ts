
/** Verificações comportamentais de assertions em modo TypeScript strict. */
import { assertNonNullable, assertType, CodeRigidityError } from './index.js';

function expect(condition: boolean, detail: string): void {
  if (!condition) throw new Error(detail);
}

type GatewayPayload = { requestId: string; retries: number };

function isGatewayPayload(value: unknown): value is GatewayPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const data = value as Record<string, unknown>;
  return typeof data['requestId'] === 'string'
    && data['requestId'].length > 0
    && typeof data['retries'] === 'number'
    && Number.isSafeInteger(data['retries'])
    && data['retries'] >= 0;
}

const valid: unknown = { requestId: 'abc', retries: 2 };
assertType(valid, isGatewayPayload, 'Payload inválido');
expect(valid.requestId === 'abc' && valid.retries === 2, 'guard deve estreitar unknown');

for (const invalid of [
  null, undefined, 12, [], { requestId: '' }, { requestId: 'a', retries: -1 },
  { requestId: 'a', retries: Number.NaN },
]) {
  let thrown = false;
  try {
    assertType(invalid, isGatewayPayload, 'Payload inválido');
  } catch (error: unknown) {
    thrown = error instanceof CodeRigidityError
      && error.message.startsWith('[CodeRigidity Violation]');
  }
  expect(thrown, 'guard deve rejeitar entrada inesperada');
}

for (const invalid of [null, undefined]) {
  let thrown = false;
  try {
    assertNonNullable(invalid, 'identificador');
  } catch (error: unknown) {
    thrown = error instanceof CodeRigidityError
      && error.message.includes('identificador');
  }
  expect(thrown, 'nullish deve ser rejeitado');
}

const allowed: string | null = '';
assertNonNullable(allowed, 'texto');
expect(allowed === '', 'string vazia é non-nullish');
