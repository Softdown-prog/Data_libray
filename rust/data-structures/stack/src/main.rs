struct Stack<T> {
    items: Vec<T>,
}

impl<T> Stack<T> {
    fn new() -> Self {
        Self { items: Vec::new() }
    }
    fn push(&mut self, value: T) {
        self.items.push(value);
    }
    fn pop(&mut self) -> Option<T> {
        self.items.pop()
    }
    fn len(&self) -> usize {
        self.items.len()
    }
}

fn main() {
    let mut stack = Stack::new();
    stack.push("a");
    stack.push("b");
    assert_eq!(stack.pop(), Some("b"));
    assert_eq!(stack.pop(), Some("a"));
    assert_eq!(stack.pop(), None);
    assert_eq!(stack.len(), 0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_and_lifo() {
        let mut stack: Stack<i32> = Stack::new();
        assert_eq!(stack.pop(), None);
        stack.push(2);
        stack.push(3);
        assert_eq!(stack.len(), 2);
        assert_eq!(stack.pop(), Some(3));
    }
}
