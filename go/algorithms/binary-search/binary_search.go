// Data Library ID: go.algorithms.binary-search
// Propósito: localizar o primeiro índice de um inteiro em um slice ordenado.
// Quando usar: consultas em dados já ordenados e que permanecem estáveis.
// Quando evitar: dados não ordenados ou modificados concorrentemente.
// Erros: quando ausente ou vazio, retorna (-1, false), sem panic.
// Correções e pré-condições: consulte README.md e example.json.
package binarysearch

// FirstIndex retorna a primeira posição de target em sorted, ou -1 quando ausente.
// Pré-condição: sorted está em ordem crescente.
func FirstIndex(sorted []int, target int) (int, bool) {
    // Invariante: a primeira ocorrência, caso exista, está no intervalo [low, high).
    low, high := 0, len(sorted)
    for low < high {
        mid := low + (high-low)/2
        if sorted[mid] < target {
            low = mid + 1
        } else {
            // Em igualdade, mantenha mid como candidato para achar a primeira posição.
            high = mid
        }
    }
    if low < len(sorted) && sorted[low] == target {
        return low, true
    }
    return -1, false
}
