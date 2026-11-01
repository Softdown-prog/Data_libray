/**
 * Data Library ID: javascript.security.safe-redirect
 * Propósito: transformar destinos em URLs da mesma origem confiável sem navegar.
 * Quando usar: links/redirecionamentos que não podem apontar para outro host.
 * Quando evitar: como controle de autorização ou allowlist de rotas.
 * Erros: TypeError para origem, destino ou protocolo proibidos.
 * Diagnóstico e integração: README.md e example.json.
 */

/**
 * Retorna URL absoluta se o destino for da mesma origem confiável.
 * @param {string} candidate Destino a validar.
 * @param {string} origin Origem de confiança, sem rota, query, hash ou credenciais.
 * @returns {string} URL canônica.
 * @throws {TypeError} Valor não permitido ou URL malformada.
 */
export function sameOriginUrl(candidate, origin) {
  if (typeof origin !== 'string' || !origin || origin.trim() !== origin) {
    throw new TypeError('origem base inválida');
  }

  const base = new URL(origin);
  // Um valor chamado origin deve representar APENAS uma origem de confiança.
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username || base.password || base.pathname !== '/' ||
    base.search || base.hash || origin.includes('?') || origin.includes('#')
  ) {
    throw new TypeError('origem base inválida');
  }

  // WHATWG URL normaliza CR/LF e backslashes: rejeite ambiguidades ANTES do parse.
  if (
    typeof candidate !== 'string' || candidate.length === 0 ||
    candidate.trim() !== candidate ||
    /[\u0000-\u001F\u007F\\]/u.test(candidate) ||
    candidate.startsWith('//')
  ) {
    throw new TypeError('destino inválido ou ambíguo');
  }

  const result = new URL(candidate, base);
  if (
    !['http:', 'https:'].includes(result.protocol) ||
    result.origin !== base.origin ||
    result.username || result.password
  ) {
    throw new TypeError('origem não permitida');
  }

  // Não acessa a rede nem autoriza a rota ou redirecionamentos posteriores.
  return result.href;
}
