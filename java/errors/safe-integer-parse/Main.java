import java.util.OptionalInt;

public final class Main {
    private Main() {}

    static OptionalInt parse(String input) {
        if (input == null || input.isBlank()) return OptionalInt.empty();
        try {
            return OptionalInt.of(Integer.parseInt(input.trim()));
        } catch (NumberFormatException exception) {
            return OptionalInt.empty();
        }
    }

    public static void main(String[] args) {
        if (parse(null).isPresent()) throw new AssertionError("null");
        if (parse(" ").isPresent()) throw new AssertionError("blank");
        if (parse("abc").isPresent()) throw new AssertionError("invalid");
        if (parse("42").orElseThrow() != 42) throw new AssertionError("valid");
        if (parse("99999999999999").isPresent()) throw new AssertionError("overflow");
    }
}
