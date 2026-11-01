package stack

import "testing"

func TestStack(t *testing.T) {
    var s Stack[string]
    if _, ok := s.Pop(); ok { t.Fatal("pilha vazia não deve remover item") }
    s.Push("a")
    s.Push("b")
    if value, ok := s.Pop(); !ok || value != "b" { t.Fatal("esperado b") }
    if value, ok := s.Pop(); !ok || value != "a" { t.Fatal("esperado a") }
    if s.Len() != 0 { t.Fatalf("tamanho final: %d", s.Len()) }
}
