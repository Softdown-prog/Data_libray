#include <array>
#include <cassert>
#include <cstddef>
#include <optional>

template <typename T, std::size_t N>
class RingBuffer {
    static_assert(N > 0);
    std::array<T, N> data_{};
    std::size_t start_ = 0;
    std::size_t size_ = 0;
public:
    [[nodiscard]] bool push(const T& value) {
        if (size_ == N) return false;
        data_[(start_ + size_) % N] = value;
        ++size_;
        return true;
    }
    [[nodiscard]] std::optional<T> pop() {
        if (size_ == 0) return std::nullopt;
        T value = data_[start_];
        start_ = (start_ + 1) % N;
        --size_;
        return value;
    }
    [[nodiscard]] std::size_t size() const { return size_; }
};

int main() {
    RingBuffer<int, 2> q;
    assert(!q.pop().has_value());
    assert(q.push(10));
    assert(q.push(20));
    assert(!q.push(30));
    assert(q.pop() == 10);
    assert(q.push(30));
    assert(q.pop() == 20);
    assert(q.pop() == 30);
    assert(q.size() == 0);
}
