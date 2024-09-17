import type { APIRoute } from "astro";

function isUrl(potentialUrl: string): boolean {
	try {
		new URL(decodeURIComponent(potentialUrl));
		return true;
	} catch {
		return false;
	}
}

export const prerender = false;
export const GET: APIRoute = ({ url }) => {
	const urlToClip = url.searchParams.get("url");
	if (!urlToClip || !isUrl(urlToClip)) {
		// bad url
		return new Response(`Value '${urlToClip} is not a valid URL'`, {
			status: 400,
		});
	}
	return new Response(null, {
		status: 303,
		headers: {
			Location: `/yazzy/${urlToClip}`,
		},
	});
};
