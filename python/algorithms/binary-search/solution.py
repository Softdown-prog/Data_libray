from collections.abc import Sequence


def first_index(values: Sequence[int], target: int) -> int:
    """Retorna o índice inicial de target, ou -1 se não existir."""
    low, high = 0, len(values)
    while low < high:
        middle = low + (high - low) // 2
        if values[middle] < target:
            low = middle + 1
        else:
            high = middle
    return low if low < len(values) and values[low] == target else -1
