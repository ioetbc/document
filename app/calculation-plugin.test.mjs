import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo, redo, closeHistory } from "prosemirror-history";
import { calculationPlugin, calculationResultMark } from "./calculation-plugin.ts";

const schema = new Schema({ nodes: basicSchema.spec.nodes, marks: basicSchema.spec.marks.addToEnd("calculation_result", calculationResultMark) });
function create(expression = "a + b =") {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("a: 1 b: 2")),
    schema.node("paragraph", null, schema.text(expression)),
  ]);
  let state = EditorState.create({ doc, plugins: [history(), calculationPlugin] });
  state = state.apply(state.tr.setMeta("initializeCalculations", true).setMeta("addToHistory", false));
  return state;
}
const lastLine = state => state.doc.lastChild.textContent;

test("results are saved text and refresh with inputs, undo, and redo", () => {
  let state = create();
  assert.equal(lastLine(state), "a + b = 3");
  state = state.apply(closeHistory(state.tr).insertText("4", 4, 5));
  assert.equal(lastLine(state), "a + b = 6");
  undo(state, transaction => { state = state.apply(transaction); });
  assert.equal(lastLine(state), "a + b = 3");
  redo(state, transaction => { state = state.apply(transaction); });
  assert.equal(lastLine(state), "a + b = 6");
  state = state.apply(state.tr.insertText("blue", 9, 10));
  assert.equal(lastLine(state), "a + b = invalid calc");
  state = EditorState.create({ doc: schema.nodeFromJSON(state.doc.toJSON()), plugins: [calculationPlugin] });
  state = state.apply(state.tr.setMeta("initializeCalculations", true));
  assert.equal(lastLine(state), "a + b = invalid calc");
});

test("cursor can move after the output and edited results stay editable", () => {
  let state = create();
  const end = state.doc.content.size - 1;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)));
  assert.equal(state.selection.head, end);
  state = state.apply(state.tr.insertText("4"));
  assert.equal(lastLine(state), "a + b = 34");
  state = state.apply(state.tr.insertText("9", 4, 5));
  assert.equal(lastLine(state), "a + b = 11");
});

test("deleting the output does not immediately regenerate it", () => {
  let state = create();
  state = state.apply(state.tr.delete(19, 21));
  assert.equal(lastLine(state), "a + b =");
  state = state.apply(state.tr.insertText("4", 4, 5));
  assert.equal(lastLine(state), "a + b =");
});

test("typing equals finalizes the calculation and places the cursor after the result", () => {
  let state = create("a / ");
  const end = state.doc.content.size - 1;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)).insertText("2"));
  assert.equal(lastLine(state), "a / 2");
  state = state.apply(state.tr.insertText("0"));
  assert.equal(lastLine(state), "a / 20");
  state = state.apply(closeHistory(state.tr).insertText(" ="));
  assert.equal(lastLine(state), "a / 20 = 0.05");
  assert.equal(state.selection.head, state.doc.content.size - 1);
  undo(state, transaction => { state = state.apply(transaction); });
  assert.equal(lastLine(state), "a / 20");
  redo(state, transaction => { state = state.apply(transaction); });
  assert.equal(lastLine(state), "a / 20 = 0.05");
});

function typeEquals(state) {
  const end = state.doc.content.size - 1;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)));
  const view = { state, dispatch(transaction) { state = state.apply(transaction); } };
  const handled = calculationPlugin.props.handleTextInput(view, end, end, "=");
  if (!handled) state = state.apply(state.tr.insertText("="));
  return state;
}

test("retyping equals recalculates after deleting the answer with or without its equals sign", () => {
  for (const deleteFrom of [17, 19, 20]) {
    let state = create();
    state = state.apply(state.tr.delete(deleteFrom, 21));
    state = state.apply(state.tr.insertText("4", 4, 5));
    state = typeEquals(state);
    assert.match(lastLine(state), /^a \+ b\s*= 6$/);
    assert.equal(state.selection.head, state.doc.content.size - 1);
    const end = state.doc.content.size - 1;
    state = state.apply(state.tr.delete(end - 1, end));
    state = typeEquals(state);
    assert.match(lastLine(state), /^a \+ b\s*= 6$/);
  }
});

test("labeled calculations keep their prose and update their editable result", () => {
  let state = create("per square feet a / b =");
  assert.equal(lastLine(state), "per square feet a / b = 0.5");
  state = state.apply(state.tr.insertText("4", 4, 5));
  assert.equal(lastLine(state), "per square feet a / b = 2");
});

test("restores tracking on saved plain-text results and updates square footage repeatedly", () => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("house_price: 400000")),
    schema.node("paragraph", null, schema.text("square_feet: 800")),
    schema.node("paragraph", null, schema.text("per square feet house_price / square_feet = 444.44444444444446")),
  ]);
  let state = EditorState.create({ doc, plugins: [calculationPlugin] });
  state = state.apply(state.tr.setMeta("initializeCalculations", true));
  assert.equal(lastLine(state), "per square feet house_price / square_feet = 500");
  for (const value of ["900", "1000", "800"]) {
    const from = state.doc.child(0).nodeSize + 1 + "square_feet: ".length;
    const to = state.doc.child(0).nodeSize + state.doc.child(1).nodeSize - 1;
    state = state.apply(state.tr.insertText(value, from, to));
    assert.equal(lastLine(state), `per square feet house_price / square_feet = ${400000 / Number(value)}`);
  }
});

test("calculation metadata survives HTML serialization including manual edits", () => {
  for (const manual of [false, true]) {
    const attrs = { generated: " 500", manual, inputs: '{"house_price":400000,"square_feet":800}' };
    const dom = calculationResultMark.toDOM(schema.marks.calculation_result.create(attrs));
    const restored = calculationResultMark.parseDOM[0].getAttrs({ getAttribute: name => dom[1][name] ?? null });
    assert.deepEqual(restored, attrs);
  }
});

test("legacy manual results resume updating when house_price changes", () => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("house_price: 500000")),
    schema.node("paragraph", null, schema.text("square_feet: 200")),
    schema.node("paragraph", null, [
      schema.text("per square feet house_price / square_feet ="),
      schema.text(" 444.44444444444446", [schema.marks.calculation_result.create({ generated: " 444.44444444444446", manual: true })]),
    ]),
  ]);
  let state = EditorState.create({ doc, plugins: [calculationPlugin] });
  state = state.apply(state.tr.setMeta("initializeCalculations", true));
  assert.equal(lastLine(state), "per square feet house_price / square_feet = 2500");
  const from = 1 + "house_price: ".length;
  state = state.apply(state.tr.insertText("300000", from, from + 6));
  assert.equal(lastLine(state), "per square feet house_price / square_feet = 1500");
  state = state.apply(state.tr.insertText("400000", from, from + 6));
  assert.equal(lastLine(state), "per square feet house_price / square_feet = 2000");
});
