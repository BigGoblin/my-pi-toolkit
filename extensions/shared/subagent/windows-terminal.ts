import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TerminalSubagentOptions } from "./terminal-runner.js";

const BRIDGE_EXTENSION = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"child-bridge.ts",
);

function getPiInvocation(): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (
		currentScript &&
		!currentScript.startsWith("/$bunfs/root/") &&
		existsSync(currentScript)
	)
		return { command: process.execPath, args: [currentScript] };
	const executable = basename(process.execPath).toLowerCase();
	return /^(node|bun)(\.exe)?$/.test(executable)
		? { command: "pi", args: [] }
		: { command: process.execPath, args: [] };
}

function buildPiArgs(
	options: TerminalSubagentOptions,
	runDir: string,
	taskPath: string,
): string[] {
	const args = [
		"--session-dir",
		join(runDir, "sessions"),
		"--name",
		options.title,
		"--no-extensions",
		"--extension",
		BRIDGE_EXTENSION,
	];
	for (const extension of options.extensionPaths ?? [])
		args.push("--extension", extension);
	args.push("--no-skills", "--no-prompt-templates");
	if (options.disableContextFiles) args.push("--no-context-files");
	args.push("--tools", options.tools, "--model", options.model, `@${taskPath}`);
	return args;
}

export async function launchWindowsTerminal(
	runDir: string,
	options: TerminalSubagentOptions,
	presentation: "split" | "tab",
	size: number,
	shell: string,
	keepOpen: boolean,
): Promise<void> {
	const taskPath = join(runDir, "task.md");
	const invocation = getPiInvocation();
	const launch = {
		title: options.title,
		model: options.model,
		startedAt: new Date().toISOString(),
		command: invocation.command,
		arguments: [...invocation.args, ...buildPiArgs(options, runDir, taskPath)],
		cwd: options.cwd,
		parentSessionId: options.parentSessionId,
		runDir,
		keepOpen,
	};
	const launchPath = join(runDir, "launch.json");
	await writeFile(launchPath, JSON.stringify(launch, null, 2), {
		encoding: "utf8",
		mode: 0o600,
	});
	const scriptPath = join(runDir, "launch.ps1");
	await writeFile(
		scriptPath,
		[
			"$ErrorActionPreference = 'Stop'",
			`$launch = Get-Content -LiteralPath '${launchPath.replace(/'/g, "''")}' -Raw | ConvertFrom-Json`,
			"$env:PI_SUBAGENT_RUN_DIR = [string]$launch.runDir",
			"$env:PI_SUBAGENT_KEEP_OPEN = if ($launch.keepOpen) { '1' } else { '0' }",
			"Set-Location -LiteralPath ([string]$launch.cwd)",
			"$piArgs = @($launch.arguments | ForEach-Object { [string]$_ })",
			"& ([string]$launch.command) @piArgs",
			"exit $LASTEXITCODE",
		].join("\r\n"),
		{ encoding: "utf8", mode: 0o600 },
	);
	const command = presentation === "split" ? "split-pane" : "new-tab";
	const wtArgs = ["-w", "0", command];
	if (presentation === "split")
		wtArgs.push("--vertical", "--size", String(size));
	wtArgs.push(
		"--title",
		options.title,
		"--startingDirectory",
		options.cwd,
		shell,
		"-NoLogo",
		"-NoProfile",
		"-File",
		scriptPath,
	);
	await new Promise<void>((resolveLaunch, reject) => {
		const child = spawn("wt.exe", wtArgs, {
			cwd: options.cwd,
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		});
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolveLaunch();
		});
	});
}
