import { execFile } from "node:child_process";

function browserCandidates(url: string): Array<[string, string[]]> {
	if (process.platform === "win32")
		return [["cmd.exe", ["/d", "/s", "/c", "start", "", url]]];
	if (process.platform === "darwin") return [["open", [url]]];
	return [
		["xdg-open", [url]],
		["gio", ["open", url]],
		["sensible-browser", [url]],
		["wslview", [url]],
		["cmd.exe", ["/d", "/s", "/c", "start", "", url]],
	];
}

/** Open a URL in the system browser. Returns an error message, or null on success. */
export async function openUrl(url: string): Promise<string | null> {
	const errors: string[] = [];
	for (const [command, args] of browserCandidates(url)) {
		const error = await new Promise<Error | null>((resolve) =>
			execFile(command, args, (value) => resolve(value)),
		);
		if (!error) return null;
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			errors.push(`${command}: ${error.message}`);
	}
	return errors.pop() ?? "系统中未找到可用的浏览器打开命令";
}
