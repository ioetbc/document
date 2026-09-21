import assert from "node:assert/strict";
import { test } from "node:test";
import { schema } from "prosemirror-schema-basic";
import { EditorState, TextSelection } from "prosemirror-state";
import { createSourcePlugin } from "./source-plugin.ts";
import { submitSource } from "./source-actions.ts";

function editor(text = "", submit, onError) {
  const calls = [];
  const plugin = createSourcePlugin(submit ?? (source => { calls.push(source); }), onError);
  const doc = schema.node("doc", null, [schema.node("paragraph", null, text ? schema.text(text) : null)]);
  const view = { state: EditorState.create({ doc, plugins: [plugin], selection: TextSelection.create(doc, 1 + text.length) }), composing: false };
  const lifecycle = plugin.spec.view(view);
  const apply = transaction => {
    const previous = view.state;
    view.state = view.state.apply(transaction);
    lifecycle.update(view, previous);
  };
  return {
    calls, view, lifecycle, apply,
    type: text => apply(view.state.tr.insertText(text)),
    enter: (extra = {}) => plugin.props.handleKeyDown(view, { key: "Enter", ...extra }),
  };
}

test("waits for whitespace after either source syntax, never each keystroke", () => {
  for (const prefix of ["source:", "source: ", "Some prose SOURCE: "]) {
    const e = editor();
    for (const character of `${prefix}https://example.com/path?q=a,b#fragment`) e.type(character);
    assert.deepEqual(e.calls, []);
    e.type(" ");
    assert.deepEqual(e.calls, ["https://example.com/path?q=a,b#fragment"]);
    e.type(" more words ");
    assert.equal(e.calls.length, 1);
  }
});

test("Enter completes sources without consuming paragraph/list key handling", () => {
  const e = editor("source: https://example.com");
  assert.equal(e.enter(), false);
  e.apply(e.view.state.tr.split(e.view.state.selection.from));
  assert.deepEqual(e.calls, ["https://example.com"]);
});

test("hard breaks complete a source and cannot connect an empty key to the next line", () => {
  const e = editor("source:https://example.com");
  e.apply(e.view.state.tr.replaceSelectionWith(schema.nodes.hard_break.create()));
  assert.deepEqual(e.calls, ["https://example.com"]);
  const empty = editor("source:");
  empty.apply(empty.view.state.tr.replaceSelectionWith(schema.nodes.hard_break.create()));
  empty.type("https://example.com ");
  assert.deepEqual(empty.calls, []);
});

test("rejects incomplete, invalid, and unsupported URLs and false key matches", () => {
  for (const value of ["https://", "http:", "https://[broken", "https://example.com:bad", "ftp://example.com", "javascript:alert(1)", "www.example.com", "example.com", "//example.com"]) {
    const e = editor(`source: ${value}`);
    e.enter();
    e.type(" ");
    assert.deepEqual(e.calls, [], value);
  }
  for (const text of ["resource:blue", "source:", "source: ", "not-source:blue"]) {
    const e = editor(text);
    e.type(" ");
    assert.deepEqual(e.calls, []);
  }
});

test("deduplicates all submitted values across repeated entries and edits", () => {
  const e = editor();
  e.type("source:alpha ");
  e.type("source:beta ");
  e.type("source:alpha ");
  e.enter();
  assert.deepEqual(e.calls, ["alpha", "beta"]);
});

test("selection-only changes and initialization do not submit saved sources", () => {
  const e = editor("source:https://example.com ");
  e.apply(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 1)));
  e.apply(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, e.view.state.doc.content.size - 1)));
  assert.deepEqual(e.calls, []);
});

test("Enter never submits a prefix in the middle of a URL or a selected range", () => {
  const e = editor("source:https://example.com/path");
  e.apply(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 23)));
  e.enter();
  e.apply(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 1, e.view.state.doc.content.size - 1)));
  e.enter();
  assert.deepEqual(e.calls, []);
});

test("composition and modified Enter do not submit, and teardown disables submission", () => {
  const e = editor("source:alpha");
  e.view.composing = true;
  e.type(" ");
  e.enter();
  e.view.composing = false;
  e.enter({ isComposing: true });
  e.enter({ ctrlKey: true });
  assert.deepEqual(e.calls, []);
  e.lifecycle.destroy();
  e.enter();
  assert.deepEqual(e.calls, []);
});

test("pending and failed requests are not repeated and rejections are handled", async () => {
  const errors = [];
  let count = 0;
  const error = new Error("offline");
  const e = editor("source:alpha", async () => { count++; throw error; }, error => errors.push(error));
  e.enter();
  e.type(" ");
  await new Promise(resolve => setImmediate(resolve));
  e.type(" ");
  assert.equal(count, 1);
  assert.deepEqual(errors, [error]);
});

test("server action independently validates page URLs", async () => {
  for (const source of [null, 42, "", "report-123", "has spaces", "https://", "file:///etc/passwd", "https://user:pass@example.com"]) {
    await assert.rejects(submitSource(source), /Invalid source/);
  }
});

test("server action extracts numeric facts and rejects failed or malformed responses", async t => {
  const previousAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const previousToken = process.env.CLOUDFLARE_API_TOKEN;
  const previousFetch = globalThis.fetch;
  t.after(() => {
    if (previousAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = previousAccount;
    if (previousToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = previousToken;
    globalThis.fetch = previousFetch;
  });
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  let payload = { success: true, result: [{ key: "Revenue 2025 (USD)", value: 1200000 }, { key: "Growth (%)", value: -2.5 }] };
  let status = 200;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/test-account/browser-rendering/json");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    const body = JSON.parse(options.body);
    assert.equal(body.url, "https://example.com/");
    assert.ok(body.prompt.includes("quantitative facts"));
    assert.equal(body.response_format.json_schema.type, "array");
    return Response.json(payload, { status });
  };
  assert.deepEqual(await submitSource("https://example.com"), payload.result);
  payload = { success: true, result: [] };
  assert.deepEqual(await submitSource("https://example.com"), []);
  for (const result of [null, {}, [{ key: "Price", value: "12" }], [{ key: " ", value: 12 }]]) {
    payload = { success: true, result };
    await assert.rejects(submitSource("https://example.com"), /invalid numeric source data/);
  }
  payload = { success: false, errors: [{ message: "Failed" }] };
  await assert.rejects(submitSource("https://example.com"), /extraction failed/);
  status = 429;
  await assert.rejects(submitSource("https://example.com"), /HTTP 429/);
  globalThis.fetch = async () => { throw new Error("network unavailable"); };
  await assert.rejects(submitSource("https://example.com"), /network unavailable/);
  delete process.env.CLOUDFLARE_API_TOKEN;
  await assert.rejects(submitSource("https://example.com"), /Configure CLOUDFLARE/);
});
