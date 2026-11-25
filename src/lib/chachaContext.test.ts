import { expect, test } from "vitest";
import { extractChachaContext } from "./chachaContext";

test("編集した段落と前後各1段落・直近の見出しだけを抽出する", () => {
  const source = "# 章\n\n遠い段落\n\n前の段落\n\n対象の段落\n継続行\n\n後の段落\n\n遠い末尾";
  const result = extractChachaContext(source, source.indexOf("対象"))!;
  expect(result.text).toEqual({ target: "対象の段落\n継続行", previous: "前の段落", next: "後の段落", heading: "章" });
  expect(source.slice(result.anchor.from, result.anchor.to)).toBe("対象の段落\n継続行");
  expect(result.ranges).toHaveLength(4);
  expect(result.key).toBe(JSON.stringify(result.text));
});
test.each(["", "\n\n", "```js\nsecret\n```", "<div>secret</div>", "---\nkey: secret\n---", "---\nkey: unclosed"])("空文書・除外ブロック %j を送信しない", (source) => {
  expect(extractChachaContext(source, Math.min(6, source.length))).toBeNull();
});
test("frontmatter・コード・HTMLは補助文脈にも入らない", () => {
  const source = "---\ntitle: 秘密\n---\n\n```\nコード秘密\n```\n\n前\n\n<div>HTML秘密</div>\n\n対象\n\n    indented-secret\n\n後";
  const result = extractChachaContext(source, source.indexOf("対象"))!;
  expect(result.text).toEqual({ target: "対象", previous: "前", next: "後" });
  expect(JSON.stringify(result.text)).not.toContain("秘密");
});
test("文書先頭・末尾と入れ子のMarkdown段落を扱う", () => {
  expect(extractChachaContext("先頭\n\n末尾", 0)?.text).toEqual({ target: "先頭", next: "末尾" });
  expect(extractChachaContext("先頭\n\n末尾", 6)?.text).toEqual({ target: "末尾", previous: "先頭" });
  expect(extractChachaContext("> 引用\n\n- リスト本文", 9)?.text.target).toBe("リスト本文");
});
test("送信文書は合計2000文字までで、補助文脈を先に削減する", () => {
  const source = `# 見出し\n\n${"前".repeat(900)}\n\n${"対".repeat(1500)}\n\n${"後".repeat(900)}`;
  const result = extractChachaContext(source, source.indexOf("対"))!;
  expect(result.text.target).toBe("対".repeat(1500));
  expect(Object.values(result.text).join("").length).toBeLessThanOrEqual(2000);
  expect(extractChachaContext("長".repeat(2001), 1)).toBeNull();
});
test("Unicode文字数とCodeMirrorのUTF-16位置を混同しない", () => {
  const target = "😀".repeat(1998) + "か\u3099";
  const result = extractChachaContext(target, 2)!;
  expect(result.text.target).toBe(target);
  expect(result.anchor.to).toBe(target.length);
  expect(extractChachaContext(target + "あ", 2)).toBeNull();
});
test("画像・添付URL・絶対パスやHTMLを送信しない", () => {
  const source = "本文 [添付](C:/secret/file.txt) ![画像](data:image/png;base64,SECRET)\n\nC:\\Users\\person\\secret\n\n本文 <img src=secret>";
  expect(extractChachaContext(source, 0)?.text).toEqual({ target: "本文 添付" });
  expect(extractChachaContext(source, source.indexOf("C:\\Users"))).toBeNull();
  expect(extractChachaContext(source, source.lastIndexOf("本文"))).toBeNull();
});

test.each(["参照先：/home/private/secret.txt", "場所（/Users/private/secret）です", "参照先/home/private.txt", "単一ファイル：/secret", "ルート：/"])("区切り記号や日本語に続くPOSIXパス %s を補助文脈にも送らない", (privateText) => {
  const source = `${privateText}\n\n安全な対象\n\n後の段落`;
  expect(extractChachaContext(source, 0)).toBeNull();
  expect(extractChachaContext(source, source.indexOf("安全"))?.text).toEqual({ target: "安全な対象", next: "後の段落" });
});
