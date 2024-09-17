import createDomPurify from "dompurify";
import { JSDOM } from "jsdom";

export function sanitize(content: string): string {
	const DOMPurify = createDomPurify(new JSDOM("<!DOCTYPE html>").window);
	return DOMPurify.sanitize(content);
}
