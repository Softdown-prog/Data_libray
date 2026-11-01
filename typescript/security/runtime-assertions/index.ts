
/**
 * Data Library ID: typescript.security.runtime-assertions
 * Propósito: estreitar valores unknown em fronteiras de entrada, usando type guards reais.
 * Quando usar: payloads de APIs, arquivos e eventos externos antes de acessar propriedades.
 * Quando evitar: tratar TypeScript genérico como validação runtime automática.
 * Erros: lança CodeRigidityError em guard falso ou valor nullish.
 * Correções: consulte README.md e example.json deste diretório.
 */
export class CodeRigidityError extends Error {
  constructor(message: string) {
    super(`[CodeRigidity Violation]: ${message}`);
    this.name = 'CodeRigidityError';
  }
}

/**
 * Aceita apenas um predicado que inspeciona os dados de verdade.
 * Um predicado que sempre retorna true compromete a segurança de tipos runtime.
 */
export function assertType<T>(
  value: unknown,
  validator: (candidate: unknown) => candidate is T,
  errorMessage: string,
): asserts value is T {
  if (!validator(value)) {
    throw new CodeRigidityError(errorMessage);
  }
}

/** Rejeita null e undefined, mas não rejeita strings vazias, NaN ou objetos inválidos. */
export function assertNonNullable<T>(
  value: T,
  fieldName: string,
): asserts value is NonNullable<T> {
  if (value === null || value === undefined) {
    throw new CodeRigidityError(
      `O campo obrigatório '${fieldName}' veio nulo ou indefinido.`,
    );
  }
}
