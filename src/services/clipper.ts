import type { KVNamespace } from "@cloudflare/workers-types";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type { ReadablePage } from "../shared/types";
import { KVCache } from "./kvStore";
import { convertHtmlToMarkdown } from "./markdown";
import { sanitize } from "./sanitizer";

const ARTICLE_TTL = 60 * 60 * 24 * 30; // 30 days, in seconds

async function fetchPage(
	url: URL,
	etag?: string,
	lastModified?: string,
): Promise<{
	status: "new" | "unmodified";
	page: JSDOM | null;
	etag: string;
	lastModified: string;
}> {
	const response = await fetch(url.toString(), {
		headers: {
			"User-Agent": "YazzyWebClipper/0.0.1",
			"If-Modified-Since": lastModified || "",
			"If-None-Match": etag || "",
		},
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url.toString()}`);
	}
	if (response.status === 304) {
		return { status: "unmodified", page: null, etag: "", lastModified: "" };
	}
	const page = new JSDOM(await response.text(), { url: url.toString() });
	// force lazy-loaded images to load
	const LAZY_DATA_ATTRS = [
		"data-src",
		"data-lazy-src",
		"data-srcset",
		"data-td-src-property",
	];
	for (const dataAttr of LAZY_DATA_ATTRS) {
		const images = page.window.document.querySelectorAll(`img[${dataAttr}]`);
		for (const img of images) {
			const src = img.getAttribute(dataAttr);
			if (src) {
				img.setAttribute("src", src);
			}
		}
	}
	return {
		status: "new",
		page,
		etag: response.headers.get("etag") ?? "",
		lastModified: response.headers.get("last-modified") ?? "",
	};
}

// Utility function to get meta content by name or property
function getMetaContent(
	document: Document,
	attr: string,
	value: string,
): string {
	const element = document.querySelector(`meta[${attr}='${value}']`);
	const content = element?.getAttribute("content");
	if (!content) {
		return "";
	}
	return content.trim();
}

async function clip(url: URL, page: JSDOM): Promise<ReadablePage> {
	const tags = [
		"clippings",
		...(
			page.window.document
				.querySelector("meta[name='keywords' i]")
				?.getAttribute("content")
				?.split(",") ?? []
		).map((keyword) => keyword.split(" ").join("")),
	];

	const article = new Readability(page.window.document, {
		keepClasses: true,
	}).parse();
	if (!article) {
		throw new Error(`Failed to parse article contents of "${url.toString()}"`);
	}

	article.content = sanitize(article.content);

	const markdownBody = convertHtmlToMarkdown(article.content);
	// Fetch byline, meta author, property author, or site name
	const author =
		article.byline ||
		getMetaContent(page.window.document, "name", "author") ||
		getMetaContent(page.window.document, "property", "author") ||
		getMetaContent(page.window.document, "property", "og:site_name");

	/* Try to get published date */
	const publishedDate =
		article.publishedTime ??
		page.window.document.querySelector("time")?.getAttribute("datetime");
	const published = publishedDate ? new Date(publishedDate) : undefined;

	const description =
		article.excerpt ||
		getMetaContent(page.window.document, "name", "description") ||
		getMetaContent(page.window.document, "property", "og:description");

	return {
		title: article.title,
		url: url.toString(),
		published,
		description,
		author,
		tags,
		markdownContent: markdownBody,
		textContent: article.textContent,
		htmlContent: article.content,
	};
}

export async function getArticle(
	url: URL,
	kv: KVNamespace,
): Promise<ReadablePage | null> {
	const articleCache = new KVCache(url.toString(), kv);
	const oldEtag = (await articleCache.get("etag")) ?? undefined;
	const oldLastModified = (await articleCache.get("lastModified")) ?? undefined;
	const { status, page, etag, lastModified } = await fetchPage(
		url,
		oldEtag,
		oldLastModified,
	);
	let article: ReadablePage | null = null;
	if (status === "unmodified") {
		// use cache
		const cachedArticle = await articleCache.get("article");
		if (!cachedArticle) {
			return null;
		}
		const parsed = JSON.parse(cachedArticle);
		article = { ...parsed, published: new Date(parsed.published) };
	} else {
		// a brand new article
		if (!page) {
			return null;
		}
		article = await clip(url, page);
		await articleCache.put("article", JSON.stringify(article), {
			expirationTtl: ARTICLE_TTL,
		});
		await articleCache.put("etag", etag, { expirationTtl: ARTICLE_TTL });
		await articleCache.put("lastModified", lastModified, {
			expirationTtl: ARTICLE_TTL,
		});
	}

	return article;
}
