// お知らせの本文（キー → 本文）。LLM（notes.js）に渡すためだけに持ち、JSON には入れない（事業者の文章はページに出さないため）
// キーは新日本海フェリーが "snf <お知らせの URL>"、シルバーフェリーが "silverferry"、さんふらわあが "sunflower"
export const noticeTexts = new Map();
export const MAX_TEXT = 6000; // LLM に渡す本文の文字数の上限
