export interface ReadablePage {
	title: string;
	url: string;
	published?: Date;
	author: string;
	tags: string[];
	description: string;
	markdownContent: string;
	textContent: string;
	htmlContent: string;
	createdAt?: Date;
	summary?: string;
}
