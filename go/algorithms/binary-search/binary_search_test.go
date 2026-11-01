// Testes do registro go.algorithms.binary-search.
// Cobrem entrada vazia, duplicatas, valores negativos e bordas ausentes.
package binarysearch

import "testing"

func TestFirstIndex(t *testing.T) {
    cases := []struct{ values []int; target, want int; found bool }{
        {nil, 5, -1, false},
        {[]int{1}, 1, 0, true},
        {[]int{1, 2, 2, 2, 9}, 2, 1, true},
        {[]int{-5, -1, 0}, -5, 0, true},
        {[]int{1, 3, 5}, 4, -1, false},
        {[]int{1, 1, 1}, 1, 0, true},
        {[]int{1, 3, 5}, 0, -1, false},
        {[]int{1, 3, 5}, 9, -1, false},
    }
    for _, tt := range cases {
        got, ok := FirstIndex(tt.values, tt.target)
        if got != tt.want || ok != tt.found {
            t.Fatalf("FirstIndex(%v, %d) = (%d, %v); want (%d, %v)", tt.values, tt.target, got, ok, tt.want, tt.found)
        }
    }
}
