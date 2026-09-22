import type { MarkSpec } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { isValidSource } from "./source";

// Generated statuses remain ordinary editable text, like calculation results.
export const sourceStatusMark: MarkSpec = {
  attrs: { source: {}, generated: {}, status: {} },
  inclusive: false,
  toDOM: mark => ["span", {
    "data-source-status": mark.attrs.status,
    "data-source-url": mark.attrs.source,
    "data-source-generated": mark.attrs.generated,
  }, 0],
  parseDOM: [{
    tag: "span[data-source-status]",
    getAttrs: element => ({
      source: element.getAttribute("data-source-url"),
      generated: element.getAttribute("data-source-generated"),
      status: element.getAttribute("data-source-status"),
    }),
  }],
};

function completedSource(view: EditorView, enter: boolean): string | undefined {
  const { empty, $from } = view.state.selection;
  if (!empty || !$from.parent.isTextblock || view.composing) return;
  let before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n");
  $from.parent.forEach((node, offset) => {
    if (node.marks.some(mark => mark.type.name === "source_status") && offset < before.length) {
      const end = Math.min(offset + node.nodeSize, before.length);
      before = before.slice(0, offset) + " ".repeat(end - offset) + before.slice(end);
    }
  });
  // Enter in the middle of a token must not submit its truncated prefix.
  const after = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, "\n", "\n");
  if (enter && after && !/^\s/.test(after)) return;
  const match = (enter
    ? /(?:^|\s)source:[ \t]*(\S+)[ \t]*$/i
    : /(?:^|\s)source:[ \t]*(\S+)\s+$/i).exec(before);
  if (!match) return;
  return isValidSource(match[1]) ? match[1] : undefined;
}

/** Bind the editor's completion detection to the application's source API. */
export function createSourcePlugin(
  submitSource: (source: string) => void | Promise<unknown>,
  onError: (error: unknown) => void = error => console.error("Could not submit source", error),
) {
  type Status = "loading" | "success" | "error";
  const statuses = new WeakMap<EditorView, Map<string, Status>>();
  const submittedByView = new WeakMap<EditorView, Set<string>>();

  function updateStatus(view: EditorView, source: string, status: Status) {
    if (!submittedByView.has(view)) return;
    statuses.get(view)?.set(source, status);
    const { state } = view;
    const markType = state.schema.marks.source_status;
    if (!markType) return;
    const text = status === "loading" ? " (Loading...)" : status === "success" ? " (Source loaded)" : " (Couldn’t load source. Press Enter here to retry.)";
    const changes: { from: number; to: number }[] = [];
    state.doc.descendants((node, position) => {
      if (!node.isTextblock) return;
      const content = node.textBetween(0, node.content.size, "\n", "\n");
      for (const match of content.matchAll(/(?:^|\s)source:[ \t]*(\S+)/gi)) {
        if (match[1] !== source) continue;
        const end = match.index + match[0].length;
        const next = node.nodeAt(end);
        const mark = next?.marks.find(mark => mark.type === markType && mark.attrs.source === source);
        // Leave deleted or manually edited status text alone when a request completes.
        if (mark && next && next.text === mark.attrs.generated) {
          changes.push({ from: position + 1 + end, to: position + 1 + end + next.nodeSize });
        } else if (!mark && status === "loading") {
          changes.push({ from: position + 1 + end, to: position + 1 + end });
        }
      }
      return false;
    });
    const transaction = state.tr;
    for (const change of changes.reverse()) {
      transaction.replaceWith(change.from, change.to, state.schema.text(text, [markType.create({ source, status, generated: text })]));
    }
    if (transaction.docChanged) {
      transaction.setStoredMarks(null);
      view.dispatch(transaction.setMeta("sourceStatusUpdate", true).setMeta("addToHistory", false));
    }
  }

  function request(view: EditorView, source: string, retry = false) {
    const submitted = submittedByView.get(view);
    if (!submitted || (submitted.has(source) && !retry)) return;
    if (retry && statuses.get(view)?.get(source) !== "error") return;
    // Reserve before invoking the API so rapid edits cannot duplicate a request.
    // Failed attempts remain reserved to avoid retrying on every later space.
    submitted.add(source);
    updateStatus(view, source, "loading");
    function failed(error: unknown) {
      updateStatus(view, source, "error");
      onError(error);
    }
    try {
      void Promise.resolve(submitSource(source)).then(
        () => updateStatus(view, source, "success"),
        failed,
      );
    } catch (error) {
      failed(error);
    }
  }

  function submit(view: EditorView, enter = false) {
    const source = completedSource(view, enter);
    if (source) request(view, source, enter && statuses.get(view)?.get(source) === "error");
  }

  return new Plugin({
    appendTransaction(transactions, _previous, state) {
      if (!transactions.some(transaction => transaction.docChanged || transaction.getMeta("initializeCalculations"))) return null;
      const transaction = state.tr;
      const positions: number[] = [];
      state.doc.descendants((node, position) => {
        if (!node.isText || !node.marks.some(mark => mark.type.name === "source_status") || /^\s/.test(node.text ?? "")) return;
        const $position = state.doc.resolve(position);
        const previous = $position.nodeBefore;
        // Keep a real space between the URL and its editable status, including restored text.
        if (previous?.isText && !previous.marks.some(mark => mark.type.name === "source_status") && /\S$/.test(previous.text ?? "")) {
          positions.push(position);
        }
      });
      for (const position of positions.reverse()) {
        transaction.replaceWith(position, position, state.schema.text(" "));
      }
      return transaction.docChanged ? transaction.setMeta("addToHistory", false) : null;
    },
    props: {
      handleKeyDown(view, event) {
        if (event.key === "Enter" && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) submit(view, true);
        // Preserve the existing paragraph and list-item Enter commands.
        return false;
      },
    },
    view(view) {
      submittedByView.set(view, new Set());
      statuses.set(view, new Map());
      return {
        update(view, previousState) {
          if (!view.state.doc.eq(previousState.doc)) submit(view);
        },
        destroy() {
          submittedByView.delete(view);
          statuses.delete(view);
        },
      };
    },
  });
}
