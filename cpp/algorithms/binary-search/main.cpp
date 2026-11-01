#include <cassert>
#include <cstddef>
#include <optional>
#include <vector>

std::optional<std::size_t> first_index(const std::vector<int>& values, int target) {
    std::size_t low = 0;
    std::size_t high = values.size();
    while (low < high) {
        const std::size_t mid = low + (high - low) / 2;
        if (values[mid] < target) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    if (low < values.size() && values[low] == target) return low;
    return std::nullopt;
}

int main() {
    assert(!first_index({}, 2).has_value());
    assert(first_index({1, 2, 2, 4}, 2) == 1);
    assert(first_index({-3, 0, 3}, -3) == 0);
    assert(!first_index({1, 4, 6}, 5).has_value());
}
