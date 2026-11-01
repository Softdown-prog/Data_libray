public final class Main {
    private Main() {}

    static int firstIndex(int[] values, int target) {
        int low = 0;
        int high = values.length;
        while (low < high) {
            int mid = low + (high - low) / 2;
            if (values[mid] < target) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        return low < values.length && values[low] == target ? low : -1;
    }

    public static void main(String[] args) {
        if (firstIndex(new int[] {}, 1) != -1) throw new AssertionError("empty");
        if (firstIndex(new int[] {1, 2, 2, 4}, 2) != 1) throw new AssertionError("first");
        if (firstIndex(new int[] {1, 3, 5}, 4) != -1) throw new AssertionError("missing");
    }
}
