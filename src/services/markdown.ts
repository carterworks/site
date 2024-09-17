import TurndownService from "turndown";

export function convertHtmlToMarkdown(html: string): string {
	const turndown = new TurndownService({
		headingStyle: "atx",
		hr: "---",
		bulletListMarker: "-",
		codeBlockStyle: "fenced",
		emDelimiter: "*",
	});
	turndown.keep([
		"iframe",
		"sub",
		"sup",
		"u",
		"ins",
		"del",
		"small",
		"big" as keyof HTMLElementTagNameMap,
	]);
	return turndown.turndown(html);
}
