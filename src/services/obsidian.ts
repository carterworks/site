import type { ReadablePage } from "../shared/types";
import { createFilename, formatDate } from "../shared/utils";

export function generateObsidianContents(article: ReadablePage): string {
	const today = formatDate(new Date());

	// Check if there's an author and add brackets
	const authorBrackets = article.author ? `"[[${article.author}]]"` : "";
	const params = {
		category: '"[[Clippings]]"',
		author: `${authorBrackets}`,
		title: `"${article.title}"`,
		url: article.url,
		clipped: `"${today}"`,
		published: `"${formatDate(article.published)}"`,
		tags: article.tags.map((t) => `"${t}"`).join(" "),
	};
	let fileContent = "---\n";
	fileContent += Object.entries(params)
		.map(([key, value]) => `${key}: ${value}`)
		.join("\n");
	fileContent += "\n---\n";
	fileContent += `\n# ${article.title}\n`;
	fileContent += `\n${article.markdownContent}\n`;

	return fileContent;
}

export function generateObsidianUri(
	fileContent: string,
	title: string,
	folder = "Clippings/",
	vault = "",
): string {
	const fileName = createFilename(title);
	const vaultName = vault ? `&vault=${encodeURIComponent(vault)}` : "";
	return `obsidian://new?file=${encodeURIComponent(folder + fileName)}&content=${encodeURIComponent(fileContent)}${vaultName}`;
}
