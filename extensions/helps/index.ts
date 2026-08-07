import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openUrl } from "../shared/open-url.js";

export const TOOLKIT_REPO_URL = "https://github.com/BigGoblin/my-pi-toolkit";

export default function helpsExtension(pi: ExtensionAPI): void {
	pi.registerCommand("helps", {
		description: "Open my-pi-toolkit documentation on GitHub",
		handler: async (_args, ctx) => {
			const error = await openUrl(TOOLKIT_REPO_URL);
			if (error) {
				ctx.ui.notify(`无法打开文档：${error}`, "error");
				return;
			}
			ctx.ui.notify(`已打开 ${TOOLKIT_REPO_URL}`, "info");
		},
	});
}
