fn first_index(values: &[i32], target: i32) -> Option<usize> {
    let (mut low, mut high) = (0, values.len());
    while low < high {
        let mid = low + (high - low) / 2;
        if values[mid] < target {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    (low < values.len() && values[low] == target).then_some(low)
}

fn main() {
    assert_eq!(first_index(&[1, 2, 2, 4], 2), Some(1));
    assert_eq!(first_index(&[], 10), None);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cases() {
        assert_eq!(first_index(&[1, 2, 2, 2], 2), Some(1));
        assert_eq!(first_index(&[-5, 0, 5], -5), Some(0));
        assert_eq!(first_index(&[1, 3], 2), None);
    }
}
