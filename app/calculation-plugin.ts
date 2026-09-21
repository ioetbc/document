import type { MarkSpec, Node } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import { extractSchema } from "./extract-schema";
import { findCalculations } from "./calculate";

// A mark keeps the calculation's metadata while the result remains ordinary,
// selectable text in the document, clipboard, history, and saved JSON.
export const calculationResultMark: MarkSpec = {
  attrs: { generated: { default: "" }, manual: { default: false }, inputs: { default: null } },
  toDOM: mark => ["span", {
    "data-calculation-result": mark.attrs.generated,
    "data-calculation-manual": String(mark.attrs.manual),
    "data-calculation-inputs": mark.attrs.inputs,
  }, 0],
  parseDOM: [{
    tag: "span[data-calculation-result]",
    getAttrs: element => ({
      generated: element.getAttribute("data-calculation-result") ?? "",
      manual: element.getAttribute("data-calculation-manual") === "true",
      inputs: element.getAttribute("data-calculation-inputs"),
    }),
  }],
};

function results(doc: Node) {
  const ranges: { from: number; to: number; generated: string; manual: boolean; inputs: string | null }[] = [];
  doc.descendants((node, position) => {
    const mark = node.marks.find(mark => mark.type.name === "calculation_result");
    if (!node.isText || !mark) return;
    const previous = ranges.at(-1);
    if (previous?.to === position && previous.generated === mark.attrs.generated && previous.manual === mark.attrs.manual && previous.inputs === mark.attrs.inputs) {
      previous.to += node.nodeSize;
    } else {
      ranges.push({ from: position, to: position + node.nodeSize, generated: mark.attrs.generated, manual: mark.attrs.manual, inputs: mark.attrs.inputs });
    }
  });
  return ranges;
}

export const calculationPlugin = new Plugin<Set<number>>({
  state: {
    init: () => new Set(),
    apply(transaction, previous, oldState) {
      const blocked = new Set(Array.from(previous, position => transaction.mapping.map(position, -1)));
      // Deleting an entire result is an intentional edit, not a request to regenerate it.
      if (transaction.docChanged && !transaction.getMeta("calculationUpdate")) {
        for (const range of results(oldState.doc)) {
          const from = transaction.mapping.map(range.from, 1);
          const to = transaction.mapping.map(range.to, -1);
          if (from >= to) blocked.add(transaction.doc.resolve(from).start());
        }
        // A newly entered equals sign explicitly requests another calculation.
        transaction.steps.forEach((step, index) => {
          step.getMap().forEach((_from, _to, newFrom, newTo) => {
            const mapping = transaction.mapping.slice(index + 1);
            const from = mapping.map(newFrom, -1);
            const to = mapping.map(newTo, 1);
            if (transaction.doc.textBetween(from, to).includes("=")) {
              blocked.delete(transaction.doc.resolve(from).start());
            }
          });
        });
      }
      return blocked;
    },
  },
  props: {
    handleTextInput(view, from, to, text) {
      if (text !== "=" || from !== to) return false;
      const { state } = view;
      const $from = state.doc.resolve(from);
      if (!$from.parent.isTextblock) return false;
      const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n");
      const retry = /=[ \t]*$/.exec(before);
      if (!retry) return false;
      // Reuse the existing equals sign when the user deleted just the answer.
      // Also clear the result mark left behind by deleting only its digits.
      const start = $from.start() + retry.index;
      const transaction = state.tr.insertText("=", start, to);
      transaction.removeMark(start, start + 1, state.schema.marks.calculation_result);
      transaction.setSelection(TextSelection.create(transaction.doc, start + 1));
      transaction.setStoredMarks(null);
      view.dispatch(transaction);
      return true;
    },
  },
  appendTransaction(transactions, _oldState, state) {
    if (!transactions.some(transaction => transaction.docChanged || transaction.getMeta("initializeCalculations"))) return null;
    const markType = state.schema.marks.calculation_result;
    if (!markType) return null;
    const values = extractSchema(state.doc.textBetween(0, state.doc.content.size, "\n", "\n"));
    const inputs = JSON.stringify(values);
    const ranges = results(state.doc);
    const changes: { from: number; to: number; text: string }[] = [];
    const transaction = state.tr;

    for (const range of ranges) {
      const current = state.doc.textBetween(range.from, range.to);
      // A deleted answer should remain deleted until '=' is entered again.
      if (!current.trim()) {
        if (!range.manual || range.inputs !== inputs) {
          transaction.addMark(range.from, range.to, markType.create({ generated: range.generated, manual: true, inputs }));
        }
        continue;
      }
      const inputsChanged = range.inputs !== inputs;
      if (range.manual && !inputsChanged) continue;
      if (current !== range.generated && !inputsChanged) {
        transaction.addMark(range.from, range.to, markType.create({ generated: range.generated, manual: true, inputs }));
        continue;
      }
      const $from = state.doc.resolve(range.from);
      const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n");
      const calculation = findCalculations(before, values).find(item => item.position === before.length);
      const text = calculation ? `${calculation.prefix}${calculation.result}` : "";
      if (text !== current || inputsChanged) changes.push({ from: range.from, to: range.to, text });
    }

    state.doc.descendants((node, position) => {
      if (!node.isTextblock) return;
      const start = position + 1;
      if (this.getState(state)?.has(start)) return false;
      const text = node.textBetween(0, node.content.size, "\n", "\n");
      for (const calculation of findCalculations(text, values)) {
        const end = start + calculation.position;
        const lineStart = start + text.lastIndexOf("\n", calculation.position - 1) + 1;
        if (ranges.some(range => range.from <= end && range.to > lineStart)) continue;
        changes.push({ from: end, to: end, text: `${calculation.prefix}${calculation.result}` });
      }
      // Repair saved or pasted equation results whose tracking mark was lost.
      // Marked results are handled above, including those edited manually.
      for (const match of text.matchAll(/^([^\n=]+=[ \t]*)([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?|invalid calc)[ \t]*$/gm)) {
        if (!/[+*/-]/.test(match[1])) continue;
        const from = start + match.index;
        const to = from + match[0].length;
        if (ranges.some(range => range.from < to && range.to > from)) continue;
        const expression = match[1].trimEnd();
        const calculation = findCalculations(expression, values)[0];
        if (!calculation) continue;
        changes.push({ from: from + expression.length, to, text: `${calculation.prefix}${calculation.result}` });
      }
      return false;
    });

    for (const change of changes.sort((a, b) => b.from - a.from)) {
      if (change.text) {
        transaction.replaceWith(change.from, change.to, state.schema.text(change.text, [markType.create({ generated: change.text, inputs })]));
      } else {
        transaction.delete(change.from, change.to);
      }
    }
    if (!transaction.docChanged) return null;
    // Finalizing with equals leaves the cursor after the editable result.
    if (state.selection instanceof TextSelection) {
      transaction.setSelection(TextSelection.create(transaction.doc,
        transaction.mapping.map(state.selection.anchor, 1),
        transaction.mapping.map(state.selection.head, 1)));
      transaction.setStoredMarks(null);
    }
    return transaction.setMeta("calculationUpdate", true);
  },
});
