export function isUrl(potentialUrl: string): boolean {
	try {
		new URL(decodeURIComponent(potentialUrl));
		return true;
	} catch {
		return false;
	}
}

export function formatDate(date: Date | undefined): string {
	if (!date) {
		return "";
	}
	return date.toISOString().split("T")[0];
}

export function createFilename(title: string): string {
	return (
		title
			// make title windows-friendly
			.replace(":", "")
			.replace(/[/\\?%*|"<>]/g, "-")
			// get rid of spaces
			.replace(/\s+/g, "-")
			// lowercase is bestcase
			.toLocaleLowerCase()
	);
}
