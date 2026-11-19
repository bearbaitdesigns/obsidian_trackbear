/**
 * Counts words in Markdown roughly the way Obsidian's status bar does:
 * frontmatter, comments, and link/embed targets are ignored, and each
 * CJK character counts as one word.
 */
export function countWords(markdown: string): number {
  let text = markdown;
  // YAML frontmatter at the top of the file
  text = text.replace(/^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\s*(\r?\n|$)/, '');
  // Obsidian %% comments %% and HTML comments
  text = text.replace(/%%[\s\S]*?%%/g, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  // [text](url) -> text ; ![alt](url) -> alt
  text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  // [[target|alias]] -> alias ; [[target]] -> target ; ![[embed]] -> nothing
  text = text.replace(/!\[\[[^\]]*\]\]/g, ' ');
  text = text.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2');
  // HTML tags
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');

  const cjk = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g;
  const cjkCount = (text.match(cjk) ?? []).length;
  text = text.replace(cjk, ' ');

  // a "word" is a run containing at least one letter or digit
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-_.]*/gu) ?? [];
  return words.length + cjkCount;
}
