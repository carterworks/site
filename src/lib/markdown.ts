import MarkdownIt from "markdown-it";

export const markdown = new MarkdownIt({ html: true });

export function renderMarkdown(content: string | null | undefined): string {
  return markdown.render(content ?? "");
}
