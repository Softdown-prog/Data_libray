export function sameOriginUrl(candidate, origin) {
  const base = new URL(origin);
  if (!['https:', 'http:'].includes(base.protocol)) {
    throw new TypeError('protocolo base inválido');
  }
  const result = new URL(candidate, base);
  if (result.origin !== base.origin) {
    throw new TypeError('origem não permitida');
  }
  return result.href;
}
