/** Custom footer: default-style model line with optional "• fast". */
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import type { Theme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ModelFamily } from "./collapse.js";
import { isFast } from "./fast-state.js";

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function formatCwd(cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    relativeToHome === "" ||
    (relativeToHome !== ".." &&
      !relativeToHome.startsWith(`..${sep}`) &&
      !isAbsolute(relativeToHome));
  if (!isInsideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function shouldShowFast(
  ctx: ExtensionContext,
  families: Map<string, ModelFamily>,
): boolean {
  if (!isFast()) return false;
  if (ctx.model?.provider !== "cursor-agent") return false;
  return !!families.get(ctx.model.id)?.hasFast;
}

function formatModelRight(
  ctx: ExtensionContext,
  families: Map<string, ModelFamily>,
  providerCount: number,
): string {
  const model = ctx.model;
  const modelName = model?.id || "no-model";
  let right = modelName;

  if (model?.reasoning) {
    const thinkingLevel = ctx.thinkingLevel || "off";
    right =
      thinkingLevel === "off"
        ? `${modelName} • thinking off`
        : `${modelName} • ${thinkingLevel}`;
  }

  if (shouldShowFast(ctx, families)) {
    right = `${right} • fast`;
  }

  if (providerCount > 1 && model) {
    return `(${model.provider}) ${right}`;
  }
  return right;
}

export function createFastAwareFooter(
  getCtx: () => ExtensionContext | null,
  getFamilies: () => Map<string, ModelFamily>,
  onReady: (requestRender: () => void) => void,
) {
  return (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => {
    const unsub = footerData.onBranchChange(() => tui.requestRender());
    onReady(() => tui.requestRender());

    return {
      dispose() {
        unsub();
      },
      invalidate() {},
      render(width: number): string[] {
        const ctx = getCtx();
        if (!ctx) return [theme.fg("dim", "")];

        let pwd = formatCwd(ctx.cwd);
        const branch = footerData.getGitBranch();
        if (branch) pwd = `${pwd} (${branch})`;
        const sessionName = ctx.sessionManager.getSessionName();
        if (sessionName) pwd = `${pwd} • ${sessionName}`;

        let input = 0;
        let output = 0;
        let cost = 0;
        for (const entry of ctx.sessionManager.getBranch()) {
          if (entry.type === "message" && entry.message.role === "assistant") {
            const msg = entry.message as AssistantMessage;
            input += msg.usage.input;
            output += msg.usage.output;
            cost += msg.usage.cost.total;
          }
        }

        const statsParts: string[] = [];
        if (input) statsParts.push(`↑${formatTokens(input)}`);
        if (output) statsParts.push(`↓${formatTokens(output)}`);
        if (cost) statsParts.push(`$${cost.toFixed(3)}`);

        const usage = ctx.getContextUsage?.();
        const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
        if (contextWindow > 0) {
          const windowLabel = formatTokens(contextWindow);
          if (usage?.percent !== null && usage?.percent !== undefined) {
            const left = Math.max(0, Math.min(100, 100 - usage.percent));
            // Match "99%left • 256k" style (integer remaining).
            statsParts.push(`${Math.round(left)}%left • ${windowLabel}`);
          } else {
            statsParts.push(`?%left • ${windowLabel}`);
          }
        }

        let statsLeft = statsParts.join(" ");
        let statsLeftWidth = visibleWidth(statsLeft);
        if (statsLeftWidth > width) {
          statsLeft = truncateToWidth(statsLeft, width, "...");
          statsLeftWidth = visibleWidth(statsLeft);
        }

        let rightSide = formatModelRight(
          ctx,
          getFamilies(),
          footerData.getAvailableProviderCount(),
        );
        if (
          statsLeftWidth + 2 + visibleWidth(rightSide) > width &&
          ctx.model &&
          rightSide.startsWith(`(${ctx.model.provider}) `)
        ) {
          rightSide = formatModelRight(ctx, getFamilies(), 1);
        }

        const rightSideWidth = visibleWidth(rightSide);
        let statsLine: string;
        if (statsLeftWidth + 2 + rightSideWidth <= width) {
          const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
          statsLine = statsLeft + padding + rightSide;
        } else {
          const availableForRight = width - statsLeftWidth - 2;
          if (availableForRight > 0) {
            const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
            const truncatedRightWidth = visibleWidth(truncatedRight);
            const padding = " ".repeat(
              Math.max(0, width - statsLeftWidth - truncatedRightWidth),
            );
            statsLine = statsLeft + padding + truncatedRight;
          } else {
            statsLine = statsLeft;
          }
        }

        const dimStatsLeft = theme.fg("dim", statsLeft);
        const remainder = statsLine.slice(statsLeft.length);
        const dimRemainder = theme.fg("dim", remainder);
        const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));

        const lines = [pwdLine, dimStatsLeft + dimRemainder];
        const statuses = footerData.getExtensionStatuses();
        const extras = Array.from(statuses.entries())
          .filter(([key]) => key !== "cursor-fast")
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, text]) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
          .filter(Boolean);
        if (extras.length > 0) {
          lines.push(truncateToWidth(extras.join(" "), width, theme.fg("dim", "...")));
        }
        return lines;
      },
    };
  };
}
