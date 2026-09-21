import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSchema } from "./extract-schema.ts";

test("extracts facts from the user's prose without swallowing surrounding words", () => {
  assert.deepEqual(extractSchema("hello this is a document that I can edit here is the report. my salary: 50,000 my rent: 1,000 my favourite_color: blue these are some random facts about me ohh and chinese: alan that was random"), {
    salary: 50000, rent: 1000, favourite_color: "blue", chinese: "alan",
  });
});

test("ignores plain prose, incomplete facts, separated colons, and URLs", () => {
  assert.deepEqual(extractSchema("ordinary prose salary : 50,000 https://example.com empty:\nrent:"), {});
  assert.deepEqual(extractSchema("empty: salary: 50,000"), { salary: 50000 });
});

test("supports quoted phrases, decimals, punctuation, and repeated keys", () => {
  assert.deepEqual(extractSchema('city: "New York" balance: -1,250.50. color: blue, color: green! id: "001"'), {
    city: "New York", balance: -1250.5, color: "green", id: "001",
  });
});

test("recomputing after deletion removes facts and handles special object keys", () => {
  assert.deepEqual(extractSchema("salary: 50,000"), { salary: 50000 });
  assert.deepEqual(extractSchema("salary:"), {});
  const result = extractSchema("__proto__: safe constructor: example");
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, "__proto__"), true);
  assert.equal(result.__proto__, "safe");
});
