import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { SUBAGENT_RUNS_ROOT } from "./run-paths.js";
import { RpcSubagentSession } from "./rpc-session.js";
import type {
	TerminalSubagentOptions,
	TerminalSubagentResult,
} from "./terminal-runner.js";

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (
		currentScript &&
		!currentScript.startsWith("/$bunfs/root/") &&
		existsSync(currentScript)
	)
		return { command: process.execPath, args: [currentScript, ...args] };
	const executable = basename(process.execPath).toLowerCase();
	return /^(node|bun)(\.exe)?$/.test(executable)
		? { command: "pi", args }
		: { command: process.execPath, args };
}

async function prepareTask(
	runDir: string,
	task: string,
	artifactFiles: string[],
): Promise<string> {
	let prepared = task;
	const artifactsDir = join(runDir, "artifacts");
	await mkdir(artifactsDir, { recursive: true, mode: 0o700 });
	for (let index = 0; index < artifactFiles.length; index += 1) {
		const source = artifactFiles[index];
		const destination = join(artifactsDir, `${index + 1}-${basename(source)}`);
		await copyFile(source, destination);
		prepared = prepared.split(source).join(destination);
	}
	return prepared;
}

function buildArgs(options: TerminalSubagentOptions, runDir: string): string[] {
	const args = [
		"--mode",
		"rpc",
		"--session-dir",
		join(runDir, "sessions"),
		"--name",
		options.title,
		"--no-extensions",
	];
	for (const extension of options.extensionPaths ?? [])
		args.push("--extension", extension);
	args.push("--no-skills", "--no-prompt-templates");
	if (options.disableContextFiles) args.push("--no-context-files");
	args.push(
		"--tools",
		options.tools,
		"--model",
		options.model,
		"--system-prompt",
		options.systemPrompt,
	);
	return args;
}

async function writeLaunchMetadata(
	runDir: string,
	id: string,
	options: TerminalSubagentOptions,
): Promise<void> {
	await writeFile(
		join(runDir, "launch.json"),
		JSON.stringify(
			{
				id,
				title: options.title,
				model: options.model,
				cwd: options.cwd,
				parentSessionId: options.parentSessionId,
				mode: "manual-rpc",
				startedAt: new Date().toISOString(),
			},
			null,
			2,
		),
		{ encoding: "utf8", mode: 0o600 },
	);
}

export async function runRpcSubagent(
	options: TerminalSubagentOptions,
): Promise<TerminalSubagentResult> {
	await mkdir(SUBAGENT_RUNS_ROOT, { recursive: true, mode: 0o700 });
	const id = randomUUID();
	const runDir = join(SUBAGENT_RUNS_ROOT, id);
	await mkdir(join(runDir, "sessions"), { recursive: true, mode: 0o700 });
	const task = await prepareTask(
		runDir,
		options.task,
		options.artifactFiles ?? [],
	);
	await writeLaunchMetadata(runDir, id, options);
	const invocation = getPiInvocation(buildArgs(options, runDir));
	// Arguments are passed as an array with shell disabled; no user text is executed by a shell.
	// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
	const child = spawn(invocation.command, invocation.args, {
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		shell: false,
		stdio: ["pipe", "pipe", "pipe"],
	});
	return new RpcSubagentSession(child, id, runDir, options).start(task);
}
