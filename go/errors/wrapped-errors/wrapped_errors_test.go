package wrappederrors

import (
    "errors"
    "testing"
)

func TestLoad(t *testing.T) {
    if err := Load("ok"); err != nil { t.Fatalf("inesperado: %v", err) }
    if err := Load(""); !errors.Is(err, ErrNotFound) { t.Fatalf("esperado ErrNotFound: %v", err) }
}
