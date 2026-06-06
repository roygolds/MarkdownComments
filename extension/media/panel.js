// Webview script for the interactive comments preview panel.
//
// SECURITY: this script never receives document-derived data through a string
// literal. All comment content lives in the server-rendered, HTML-escaped DOM;
// here we only read `data-` attributes and element text and assign user input
// to `textarea.value` (never `innerHTML`). Messages posted to the host are
// re-validated there.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const body = document.body;
  const docVersion = Number(body.getAttribute("data-doc-version"));
  const docUri = body.getAttribute("data-uri") || "";

  const TOGGLE_CLASS = {
    "hide-comments": "mdc-hide-comments",
    "collapse-comments": "mdc-collapse-comments",
    "hide-resolved": "mdc-hide-resolved"
  };

  const SELECTED_CLASS = "mdc-thread--selected";

  const defaultState = {
    uri: docUri,
    toggles: { "hide-comments": false, "collapse-comments": false, "hide-resolved": false },
    collapsed: {},
    drafts: {},
    scrollY: 0,
    selected: null
  };

  function loadState() {
    const s = vscode.getState();
    if (!s) {
      return JSON.parse(JSON.stringify(defaultState));
    }
    // If the panel is showing a different document than the saved state, drop
    // per-document data (drafts/collapsed/scroll) so nothing bleeds across files.
    if (s.uri !== docUri) {
      return {
        uri: docUri,
        toggles: Object.assign({}, defaultState.toggles, s.toggles),
        collapsed: {},
        drafts: {},
        scrollY: 0,
        selected: null
      };
    }
    return {
      uri: docUri,
      toggles: Object.assign({}, defaultState.toggles, s.toggles),
      collapsed: s.collapsed || {},
      drafts: s.drafts || {},
      scrollY: s.scrollY || 0,
      selected: s.selected || null
    };
  }

  let state = loadState();

  function saveState() {
    state.uri = docUri;
    vscode.setState(state);
  }

  // --- Thread selection ----------------------------------------------------
  // Mark the card matching the persisted selection. Called after each render so
  // the bolder border survives the sidebar's frequent re-renders.
  function applySelected() {
    if (!state.selected) {
      return;
    }
    let found = false;
    document.querySelectorAll(".mdc-thread").forEach((el) => {
      const on = el.getAttribute("data-thread-id") === state.selected;
      el.classList.toggle(SELECTED_CLASS, on);
      if (on) {
        found = true;
      }
    });
    // The previously-selected thread is gone (e.g. deleted) -> forget it.
    if (!found) {
      state.selected = null;
      saveState();
    }
  }

  function selectThread(id) {
    state.selected = id || null;
    document.querySelectorAll(".mdc-thread").forEach((el) => {
      el.classList.toggle(SELECTED_CLASS, !!id && el.getAttribute("data-thread-id") === id);
    });
    saveState();
  }

  // --- Toolbar toggles -----------------------------------------------------
  function applyToggle(name, on) {
    const cls = TOGGLE_CLASS[name];
    if (cls) {
      body.classList.toggle(cls, on);
    }
  }

  document.querySelectorAll(".mdc-toolbar__btn").forEach((btn) => {
    const name = btn.getAttribute("data-toggle");
    const on = !!state.toggles[name];
    btn.setAttribute("aria-pressed", String(on));
    applyToggle(name, on);
    btn.addEventListener("click", () => {
      const next = !state.toggles[name];
      state.toggles[name] = next;
      btn.setAttribute("aria-pressed", String(next));
      applyToggle(name, next);
      saveState();
    });
  });

  // --- Per-thread state ----------------------------------------------------
  document.querySelectorAll(".mdc-thread").forEach((thread) => {
    const id = thread.getAttribute("data-thread-id");
    if (id && state.collapsed[id]) {
      thread.classList.add("mdc-thread--collapsed");
    }
  });

  function threadOf(el) {
    return el.closest(".mdc-thread");
  }

  function threadId(el) {
    const t = threadOf(el);
    return t ? t.getAttribute("data-thread-id") : null;
  }

  function post(message) {
    message.docVersion = docVersion;
    message.uri = docUri;
    vscode.postMessage(message);
  }

  // --- Inline editors ------------------------------------------------------
  function buildEditor(initialText, handlers, onCancel) {
    const wrap = document.createElement("div");
    wrap.className = "mdc-editor";
    const ta = document.createElement("textarea");
    ta.className = "mdc-editor__input";
    ta.rows = 3;
    ta.value = initialText || "";
    const actions = document.createElement("div");
    actions.className = "mdc-editor__actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "mdc-btn mdc-btn--primary";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "mdc-btn";
    cancel.textContent = "Cancel";
    actions.appendChild(save);
    actions.appendChild(cancel);
    wrap.appendChild(ta);
    wrap.appendChild(actions);

    ta.addEventListener("input", () => handlers.onInput(ta.value));
    save.addEventListener("click", () => {
      const value = ta.value.trim();
      if (value.length === 0) {
        ta.focus();
        return;
      }
      handlers.commit(value);
    });
    cancel.addEventListener("click", () => onCancel());
    return { wrap, textarea: ta };
  }

  function draftKey(kind, id, index) {
    return index === undefined ? kind + ":" + id : kind + ":" + id + ":" + index;
  }

  function clearDraft(key) {
    delete state.drafts[key];
    saveState();
  }

  // Reply -------------------------------------------------------------------
  function openReply(thread, restoreText) {
    const id = thread.getAttribute("data-thread-id");
    const replyBox = thread.querySelector(".mdc-reply");
    if (!replyBox || replyBox.querySelector(".mdc-editor")) {
      return;
    }
    const key = draftKey("reply", id);
    const editor = buildEditor(
      restoreText !== undefined ? restoreText : state.drafts[key] || "",
      {
        onInput: (v) => {
          state.drafts[key] = v;
          saveState();
        },
        commit: (v) => {
          clearDraft(key);
          post({ type: "reply", threadId: id, body: v });
        }
      },
      () => {
        clearDraft(key);
        editor.wrap.remove();
      }
    );
    replyBox.appendChild(editor.wrap);
    editor.textarea.focus();
  }

  // Edit --------------------------------------------------------------------
  function openEdit(comment, restoreText) {
    const thread = threadOf(comment);
    const id = thread.getAttribute("data-thread-id");
    const index = Number(comment.getAttribute("data-comment-index"));
    const textEl = comment.querySelector(".mdc-comment__text");
    if (!textEl || comment.querySelector(".mdc-editor")) {
      return;
    }
    const key = draftKey("edit", id, index);
    const original = textEl.textContent || "";
    const saved = state.drafts[key];
    const initial =
      restoreText !== undefined ? restoreText : saved && typeof saved === "object" ? saved.v : original;
    const editor = buildEditor(
      initial,
      {
        onInput: (v) => {
          // Persist the in-progress value together with the original comment
          // text, so a re-render after an external edit can detect whether this
          // draft still targets the same comment before restoring it.
          state.drafts[key] = { v: v, o: original };
          saveState();
        },
        commit: (v) => {
          clearDraft(key);
          post({ type: "edit", threadId: id, commentIndex: index, newText: v });
        }
      },
      () => {
        clearDraft(key);
        editor.wrap.remove();
        textEl.style.display = "";
      }
    );
    textEl.style.display = "none";
    textEl.parentNode.insertBefore(editor.wrap, textEl.nextSibling);
    editor.textarea.focus();
  }

  // --- Click delegation ----------------------------------------------------
  body.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) {
      return;
    }
    const btn = target.closest("[data-action]");
    if (!btn) {
      // A click elsewhere on a comment thread (not a button, not inside an open
      // editor) reveals the anchored line in the Markdown document. Ignore the
      // click when the user is selecting text so copying never navigates away.
      if (target.closest(".mdc-editor")) {
        return;
      }
      const selection = window.getSelection && window.getSelection();
      if (selection && String(selection).length > 0) {
        return;
      }
      const thread = target.closest(".mdc-thread");
      const id = thread && thread.getAttribute("data-thread-id");
      if (id) {
        post({ type: "reveal", threadId: id });
        selectThread(id);
      }
      return;
    }
    const action = btn.getAttribute("data-action");
    const id = threadId(btn);

    switch (action) {
      case "collapse": {
        const thread = threadOf(btn);
        const collapsed = thread.classList.toggle("mdc-thread--collapsed");
        if (collapsed) {
          state.collapsed[id] = true;
        } else {
          delete state.collapsed[id];
        }
        saveState();
        break;
      }
      case "reply":
        openReply(threadOf(btn));
        break;
      case "edit":
        openEdit(btn.closest(".mdc-comment"));
        break;
      case "resolve":
        post({ type: "resolve", threadId: id });
        break;
      case "reopen":
        post({ type: "reopen", threadId: id });
        break;
      case "delete-thread":
        post({ type: "deleteThread", threadId: id });
        break;
      case "delete-comment": {
        const index = Number(btn.getAttribute("data-comment-index"));
        post({ type: "deleteComment", threadId: id, commentIndex: index });
        break;
      }
      default:
        break;
    }
  });

  // --- Restore drafts & scroll after a (re-)render -------------------------
  Object.keys(state.drafts).forEach((key) => {
    const parts = key.split(":");
    const kind = parts[0];
    const id = parts[1];
    if (kind === "reply") {
      const thread = document.querySelector(
        '.mdc-thread[data-thread-id="' + cssEscape(id) + '"]'
      );
      if (thread) {
        openReply(thread, state.drafts[key]);
      } else {
        clearDraft(key);
      }
    } else if (kind === "edit") {
      const index = parts[2];
      const comment = document.querySelector(
        '.mdc-thread[data-thread-id="' +
          cssEscape(id) +
          '"] .mdc-comment[data-comment-index="' +
          cssEscape(index) +
          '"]'
      );
      const draft = state.drafts[key];
      const textEl = comment ? comment.querySelector(".mdc-comment__text") : null;
      const currentOriginal = textEl ? textEl.textContent || "" : null;
      if (comment && draft && typeof draft === "object" && draft.o === currentOriginal) {
        openEdit(comment, draft.v);
      } else {
        // The comment moved or its text changed underneath the draft; discard it
        // rather than risk saving an edit onto the wrong comment.
        clearDraft(key);
      }
    }
  });

  window.scrollTo(0, state.scrollY || 0);
  applySelected();
  window.addEventListener("scroll", () => {
    state.scrollY = window.scrollY;
    saveState();
  });

  // Inbound host messages. The sidebar asks the panel to bring a comment into
  // view (Word-style: clicking a side comment focuses it in the preview).
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "revealThread" || typeof msg.threadId !== "string") {
      return;
    }
    const el = document.querySelector(
      '.mdc-thread[data-thread-id="' + cssEscape(msg.threadId) + '"]'
    );
    if (!el) {
      return;
    }
    el.classList.remove("mdc-thread--collapsed");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    selectThread(msg.threadId);
    el.classList.add("mdc-thread--flash");
    setTimeout(() => el.classList.remove("mdc-thread--flash"), 1200);
  });

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\\]]/g, "\\$&");
  }
})();
