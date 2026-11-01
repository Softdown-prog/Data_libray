package binarysearch

// FirstIndex retorna a primeira posição de target em sorted, ou -1 quando ausente.
// Pré-condição: sorted está em ordem crescente.
func FirstIndex(sorted []int, target int) (int, bool) {
    low, high := 0, len(sorted)
    for low < high {
        mid := low + (high-low)/2
        if sorted[mid] < target {
            low = mid + 1
        } else {
            high = mid
        }
    }
    if low < len(sorted) && sorted[low] == target {
        return low, true
    }
    return -1, false
}
