import assert from "node:assert/strict";
import { test } from "node:test";
import { calculate, findCalculations } from "./calculate.ts";
import { extractSchema } from "./extract-schema.ts";

test("calculates the requested examples using numeric schema values", () => {
  const values = extractSchema("a: 1 and b: 2");
  assert.equal(calculate("a + b", values), 3);
  assert.equal(calculate("a * b", values), 2);
  assert.equal(calculate("a / 2", values), 0.5);
});

test("rejects strings even when numeric, missing keys, and non-finite results", () => {
  for (const values of [{ a: 1, b: "2" }, { a: "1", b: "2" }, { a: 1 }]) {
    for (const operator of ["+", "-", "*", "/"]) {
      assert.equal(calculate(`a ${operator} b`, values), "invalid calc");
    }
  }
  for (const expression of ["1 / 0", "0 / 0", "constructor + 1", "a +", "(a + 2", "Math.random()", "alert(1)"]) {
    assert.equal(calculate(expression, { a: 1 }), "invalid calc");
  }
});

test("supports precedence, parentheses, decimals, unary signs, and subtraction", () => {
  assert.equal(calculate("a + b * 3", { a: 1, b: 2 }), 7);
  assert.equal(calculate("(a + b) * 3", { a: 1, b: 2 }), 9);
  assert.equal(calculate("-a + .5", { a: 1 }), -0.5);
  assert.equal(calculate("a-b", { a: 1, b: 2 }), -1);
});

test("finds calculation lines and recomputes results after edits and deletion", () => {
  const text = "a + b =\na * b =\na / 2 =";
  assert.deepEqual(findCalculations(text, { a: 1, b: 2 }).map(item => item.result), [3, 2, 0.5]);
  assert.deepEqual(findCalculations(text, { a: 4, b: 2 }).map(item => item.result), [6, 8, 2]);
  assert.equal(findCalculations(text, { a: 1 })[0].result, "invalid calc");
  assert.deepEqual(findCalculations("a", { a: 1, b: 2 }), []);
  assert.equal(findCalculations("a + b =", { a: 1, b: 2 })[0].position, 7);
});

test("calculations require an explicit equals sign", () => {
  for (const text of ["a: 1 b: 2", "This is a document", "Write a story, a plan, or a fresh start", "a +", "", "a + b", "a * b", "a / 2"]) {
    assert.deepEqual(findCalculations(text, { a: 1, b: 2 }), []);
  }
  assert.deepEqual(findCalculations("a+b=", { a: 1, b: 2 }), [{ position: 4, result: 3, prefix: " " }]);
  assert.equal(findCalculations("a + b =", { a: "one", b: "two" })[0].result, "invalid calc");
  assert.equal(findCalculations("(a + b) / 2 =", { a: 1, b: 2 })[0].result, 1.5);
  assert.equal(findCalculations("a + b =", { a: 1, b: 2 })[0].prefix, " ");
});

test("prose labels before expressions are not treated as operands", () => {
  const values = extractSchema("house_price: 400000\nsquare_feet: 800");
  assert.equal(findCalculations("per square feet house_price / square_feet =", values)[0].result, 500);
  assert.equal(findCalculations("total (house_price / square_feet) * 2 =", values)[0].result, 1000);
  assert.equal(findCalculations("per square feet house_price / square_feet =", { ...values, square_feet: "800" })[0].result, "invalid calc");
  assert.equal(findCalculations("a ** b + 1 =", { a: 1, b: 2 })[0].result, "invalid calc");
});

test("API keys support spaces, units, punctuation, and overlapping names", () => {
  const values = { "Number of bedrooms": 3, "Guide Price": 430000, "Price": 2, "Size (sqft)": 924, "Reservation Fee (% of purchase price)": 4.5 };
  assert.equal(calculate("Number of bedrooms / Guide Price", values), 3 / 430000);
  assert.equal(findCalculations("Number of bedrooms / Guide Price =", values)[0].result, 3 / 430000);
  assert.equal(findCalculations("per square foot Guide Price / Size (sqft) =", values)[0].result, 430000 / 924);
  assert.equal(calculate("Guide Price * Reservation Fee (% of purchase price) / 100", values), 19350);
  assert.equal(calculate("Guide Prices / 2", values), "invalid calc");
});
