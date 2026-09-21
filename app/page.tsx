"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Schema } from "prosemirror-model";
import { EditorState, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes, wrapInList, splitListItem, liftListItem, sinkListItem } from "prosemirror-schema-list";
import { baseKeymap, toggleMark, setBlockType, chainCommands } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { extractSchema } from "./extract-schema";

const schema = new Schema({ nodes: addListNodes(basicSchema.spec.nodes, "paragraph block*", "block"), marks: basicSchema.spec.marks });
const storageKey = "homepage-document-v1";
const initialDocument = {
  type: "doc", content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "A little space for your ideas." }] },
    { type: "paragraph", content: [{ type: "text", text: "Every good idea starts with a few words. Make this page your own." }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Start right here" }] },
    { type: "paragraph", content: [{ type: "text", text: "Click anywhere in this page and start writing. You can change the title, replace these words, or begin something entirely new." }] },
    { type: "bullet_list", content: ["Capture a thought before it slips away", "Write a story, a plan, or a fresh start", "Make room for whatever comes next"].map(text => ({ type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })) },
    { type: "paragraph", content: [{ type: "text", text: "This is your page. See where it takes you.", marks: [{ type: "em" }] }] },
  ],
};

export default function Home() {
  const mount = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [status, setStatus] = useState("Loading your page…");
  const [words, setWords] = useState(0);
  const [editorState, setEditorState] = useState<EditorState | null>(null);

  useEffect(() => {
    if (!mount.current) return;
    let doc = schema.nodeFromJSON(initialDocument);
    let message = "Saved in this browser";
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) { const restored = schema.nodeFromJSON(JSON.parse(saved)); restored.check(); doc = restored; }
    } catch { message = "Couldn’t restore saved content"; }
    const view = new EditorView(mount.current, {
      state: EditorState.create({
        doc,
        plugins: [
          history(),
          inputRules({ rules: [textblockTypeInputRule(/^(#{1,3})\s$/, schema.nodes.heading, match => ({ level: match[1].length })), wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list)] }),
          keymap({ "Mod-z": undo, "Mod-Shift-z": redo, "Mod-y": redo, "Mod-b": toggleMark(schema.marks.strong), "Mod-i": toggleMark(schema.marks.em), Enter: chainCommands(splitListItem(schema.nodes.list_item), baseKeymap.Enter), "Mod-[": liftListItem(schema.nodes.list_item), "Mod-]": sinkListItem(schema.nodes.list_item) }),
          keymap(baseKeymap),
        ],
      }),
      attributes: { "aria-label": "Page content", role: "textbox", "aria-multiline": "true", spellcheck: "true" },
      dispatchTransaction(transaction) {
        const next = view.state.apply(transaction);
        view.updateState(next);
        setEditorState(next);
        if (transaction.docChanged) {
          setWords(next.doc.textBetween(0, next.doc.content.size, " ").trim().split(/\s+/).filter(Boolean).length);
          try { localStorage.setItem(storageKey, JSON.stringify(next.doc.toJSON())); setStatus("Saved in this browser"); }
          catch { setStatus("Couldn’t save — browser storage unavailable"); }
        }
      },
    });
    viewRef.current = view;
    const frame = requestAnimationFrame(() => {
      setEditorState(view.state);
      setWords(view.state.doc.textBetween(0, view.state.doc.content.size, " ").trim().split(/\s+/).filter(Boolean).length);
      setStatus(message);
    });
    return () => { cancelAnimationFrame(frame); view.destroy(); viewRef.current = null; };
  }, []);

  function run(command: Command) {
    const view = viewRef.current;
    if (view) { command(view.state, view.dispatch, view); view.focus(); }
  }
  function marked(name: string) {
    if (!editorState) return false;
    const { from, to, empty, $from } = editorState.selection;
    return empty ? !!schema.marks[name].isInSet(editorState.storedMarks || $from.marks()) : editorState.doc.rangeHasMark(from, to, schema.marks[name]);
  }
  const block = editorState?.selection.$from.parent;
  const format = block?.type.name === "heading" ? String(block.attrs.level) : "paragraph";
  const extractedSchema = extractSchema(editorState?.doc.textBetween(0, editorState.doc.content.size, "\n", "\n") ?? "");

  return (
      <main>
        <section className="editor-shell" aria-label="Homepage editor">
          <div className="toolbar" role="toolbar" aria-label="Text formatting">
            <select aria-label="Text style" value={format} disabled={!editorState} onChange={event => run(event.target.value === "paragraph" ? setBlockType(schema.nodes.paragraph) : setBlockType(schema.nodes.heading, { level: Number(event.target.value) }))}>
              <option value="paragraph">Normal text</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option>
            </select>
            <span className="divider" />
            <button title="Bold (Ctrl/⌘ B)" aria-label="Bold" aria-pressed={marked("strong")} onMouseDown={e => e.preventDefault()} onClick={() => run(toggleMark(schema.marks.strong))}><b>B</b></button>
            <button title="Italic (Ctrl/⌘ I)" aria-label="Italic" aria-pressed={marked("em")} onMouseDown={e => e.preventDefault()} onClick={() => run(toggleMark(schema.marks.em))}><i>I</i></button>
            <button title="Bullet list" aria-label="Bullet list" disabled={!editorState || !wrapInList(schema.nodes.bullet_list)(editorState)} onMouseDown={e => e.preventDefault()} onClick={() => run(wrapInList(schema.nodes.bullet_list))}>☷</button>
            <span className="divider" />
            <button title="Undo" aria-label="Undo" disabled={!editorState || !undo(editorState)} onMouseDown={e => e.preventDefault()} onClick={() => run(undo)}>↶</button>
            <button title="Redo" aria-label="Redo" disabled={!editorState || !redo(editorState)} onMouseDown={e => e.preventDefault()} onClick={() => run(redo)}>↷</button>
          </div>
          <div ref={mount} className="editor-mount" />
        </section>
        <aside className="schema-panel" aria-labelledby="schema-title">
          <pre aria-label="Extracted document schema"><code>{JSON.stringify(extractedSchema, null, 2)}</code></pre>
        </aside>
      </main>
  );
}
