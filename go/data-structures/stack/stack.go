package stack

// Stack é uma pilha LIFO que não expõe o slice interno.
type Stack[T any] struct {
    items []T
}

func (s *Stack[T]) Push(value T) {
    s.items = append(s.items, value)
}

func (s *Stack[T]) Pop() (T, bool) {
    if len(s.items) == 0 {
        var zero T
        return zero, false
    }
    last := len(s.items) - 1
    value := s.items[last]
    var zero T
    s.items[last] = zero
    s.items = s.items[:last]
    return value, true
}

func (s *Stack[T]) Len() int { return len(s.items) }
