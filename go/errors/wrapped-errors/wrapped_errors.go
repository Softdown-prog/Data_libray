package wrappederrors

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("registro não encontrado")

func Load(id string) error {
    if id == "" {
        return fmt.Errorf("load: id vazio: %w", ErrNotFound)
    }
    return nil
}
