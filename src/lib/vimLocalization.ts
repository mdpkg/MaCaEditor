import type { CodeMirror } from "@replit/codemirror-vim";

const modeNames: Readonly<Record<string, string>> = {
  NORMAL: "ノーマル",
  INSERT: "挿入",
  REPLACE: "置換",
  VISUAL: "選択",
  "VISUAL LINE": "行選択",
  "VISUAL BLOCK": "矩形選択",
};

const notificationTranslations: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Not an editor command "(:.*)"$/s, "不明な Vim コマンドです。$1"],
  [/^(\d+) lines yanked into "(.*)"$/s, "$1 行をレジスター「$2」にコピーしました。"],
  [/^(\d+) lines yanked$/, "$1 行をコピーしました。"],
  [/^Invalid regex: (.*)$/s, "無効な正規表現です。$1"],
  [/^Unknown option: (.*)$/s, "不明な Vim オプションです。$1"],
  [/^Invalid mapping: (.*)$/s, "無効なキーマッピングです。$1"],
  [/^No such mapping: (.*)$/s, "キーマッピングが見つかりません。$1"],
  [/^Invalid argument: (.*)$/s, "無効な引数です。$1"],
  [/^Argument (?:is )?required\.?$/, "引数を指定してください。"],
  [/^No word under cursor$/, "カーソル位置に単語がありません。"],
  [/^Mark not set$/, "マークが設定されていません。"],
  [/^Pattern not found(.*)$/s, "パターンが見つかりません。$1"],
  [/^Regular Expression missing from global$/, "正規表現を指定してください。"],
  [/^No previous substitute regular expression$/, "前回の置換パターンがありません。"],
  [/^Substitutions should be of the form (.*)$/s, "次の形式で置換を指定してください。$1"],
  [/^(?:No match found |No matches for |No matches found for pattern: )(.*)$/s, "一致する箇所がありません。$1"],
  [/^Found (\d+) matches for pattern: (.*)$/s, "$1 件一致しました。$2"],
  [/^Codemirror-vim version: (.*)$/s, "CodeMirror Vim のバージョン $1"],
];

function translateNotification(message: string): string {
  for (const [pattern, translation] of notificationTranslations) {
    if (!pattern.test(message)) continue;
    const hint = / \(set nopcre to use [Vv]im regexps\)$/.exec(message);
    if (hint && /^(No match|Found )/.test(message)) {
      return message.slice(0, hint.index).replace(pattern, translation) +
        "（Vim の正規表現を使うには `set nopcre` を実行してください。）";
    }
    return message.replace(pattern, translation);
  }
  return message;
}

function updatePanelLabels(panel: HTMLElement) {
  const indicator = panel.querySelector(":scope > span:first-child");
  const mode = /^--([A-Z ]+)(\(C-O\))?--$/.exec(indicator?.textContent ?? "");
  if (indicator && mode && modeNames[mode[1]]) {
    indicator.textContent = `--${modeNames[mode[1]]}${mode[2] ?? ""}--`;
  }
  const message = panel.querySelector(".cm-vim-message");
  const text = message?.firstChild;
  // Structured output can contain registers, document lines, and other user text.
  if (text instanceof Text && message?.childNodes.length === 1) {
    const translated = translateNotification(text.data);
    if (text.data !== translated) text.data = translated;
  }
  const searchMode = panel.querySelector("input")?.parentElement?.nextElementSibling?.firstElementChild;
  if (searchMode?.textContent === "(JavaScript regexp: set pcre)") {
    searchMode.textContent = "（JavaScript の正規表現: set pcre）";
  } else if (searchMode?.textContent === "(Vim regexp: set nopcre)") {
    searchMode.textContent = "（Vim の正規表現: set nopcre）";
  }
  const footer = message?.nextElementSibling;
  if (footer?.textContent === "Press ENTER or type command to continue") {
    footer.textContent = "Enter キーを押すか、コマンドを入力して続けます。";
  }
}

export function localizeVimPanel(panel: HTMLElement, editor: CodeMirror): () => void {
  // The extension recreates the status text after each key. Keep its panel and event handlers.
  updatePanelLabels(panel);
  const observer = new MutationObserver(() => updatePanelLabels(panel));
  observer.observe(panel, { childList: true, subtree: true });

  const openDialog = editor.openDialog;
  editor.openDialog = function (template, callback, options) {
    const input = template.querySelector("input");
    const prefix = input?.previousSibling;
    if (input && prefix?.textContent === ":") {
      input.setAttribute("aria-label", "Vim コマンド");
    } else if (input && (prefix?.textContent === "/" || prefix?.textContent === "?")) {
      input.setAttribute("aria-label", prefix.textContent === "/" ? "Vim 前方検索" : "Vim 後方検索");
    } else if (input && prefix?.firstChild instanceof Text && prefix.firstChild.data === "replace with ") {
      prefix.firstChild.data = "置換先 ";
      input.setAttribute("aria-label", "Vim の置換確認");
    }
    return openDialog.call(this, template, callback, options);
  };

  return () => {
    observer.disconnect();
    editor.openDialog = openDialog;
  };
}
