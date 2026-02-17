import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect } from "vitest";

afterEach(() => {
  cleanup();
});

// --- Test Components ---

function Greeting({ name }: { name: string }) {
  return <div data-testid="greeting">Hello, {name}!</div>;
}

function Counter({ initial = 0 }: { initial?: number }) {
  const [count, setCount] = useState(initial);
  return (
    <div>
      <span data-testid="count">{count}</span>
      <button
        data-testid="increment"
        onClick={() => {
          setCount((c) => c + 1);
        }}
      >
        +
      </button>
      <button
        data-testid="decrement"
        onClick={() => {
          setCount((c) => c - 1);
        }}
      >
        -
      </button>
    </div>
  );
}

// --- Tests ---

// Test 1: Basic rendering with $subject
given("a Greeting component", () => {
  $inputs = { name: "World" };
  $subject = render(<Greeting name={$inputs.name} />);

  it("renders the greeting text", () => {
    expect($subject.getByTestId("greeting").textContent).toEqual("Hello, World!");
  });
});

// Test 2: Input modification via when()
given("a Greeting with modifiable name", () => {
  $inputs = { name: "World" };
  $subject = render(<Greeting name={$inputs.name} />);

  when("the name is changed to Alice", () => {
    $inputs.name = "Alice";

    it("renders Hello, Alice!", () => {
      expect($subject.getByTestId("greeting").textContent).toEqual("Hello, Alice!");
    });
  });

  when("the name is changed to Bob", () => {
    $inputs.name = "Bob";

    it("renders Hello, Bob!", () => {
      expect($subject.getByTestId("greeting").textContent).toEqual("Hello, Bob!");
    });
  });
});

// Test 3: User interaction via perform (references $subject)
given("a Counter component", () => {
  $inputs = { initial: 0 };
  $subject = render(<Counter initial={$inputs.initial} />);

  it("starts at 0", () => {
    expect($subject.getByTestId("count").textContent).toEqual("0");
  });

  when("the increment button is clicked", () => {
    fireEvent.click($subject.getByTestId("increment"));

    it("shows count of 1", () => {
      expect($subject.getByTestId("count").textContent).toEqual("1");
    });
  });

  when("the decrement button is clicked", () => {
    fireEvent.click($subject.getByTestId("decrement"));

    it("shows count of -1", () => {
      expect($subject.getByTestId("count").textContent).toEqual("-1");
    });
  });
});

// Test 4: Test isolation - each it() gets fresh render
given("a Counter proving isolation", () => {
  $inputs = { initial: 0 };
  $subject = render(<Counter initial={$inputs.initial} />);

  when("the increment button is clicked", () => {
    fireEvent.click($subject.getByTestId("increment"));

    it("shows 1 (first assertion)", () => {
      expect($subject.getByTestId("count").textContent).toEqual("1");
    });

    it("shows 1 (second assertion, proving fresh state)", () => {
      expect($subject.getByTestId("count").textContent).toEqual("1");
    });
  });
});

// Test 5: Nested when blocks with inputs and performs
given("a Counter with nested interactions", () => {
  $inputs = { initial: 10 };
  $subject = render(<Counter initial={$inputs.initial} />);

  when("starting from 5", () => {
    $inputs.initial = 5;

    it("renders 5", () => {
      expect($subject.getByTestId("count").textContent).toEqual("5");
    });

    when("the increment button is clicked", () => {
      fireEvent.click($subject.getByTestId("increment"));

      it("shows 6", () => {
        expect($subject.getByTestId("count").textContent).toEqual("6");
      });
    });
  });
});
