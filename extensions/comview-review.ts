import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type CommentDraft = {
	path?: string;
	line?: number;
	side?: string;
	start_line?: number;
	start_side?: string;
	body?: string;
};

type CommentFile = {
	comments?: CommentDraft[];
};

type ReviewState = {
	version: 1;
	seenCommentIds: string[];
};

const STATE_FILE = ".comview/pi-review-state.json";
const COMMENT_FILE = ".comview/comments.json";

function normalizeBody(body: string | undefined): string {
	return (body ?? "").trim();
}

function commentId(comment: CommentDraft): string {
	const key = [
		comment.path ?? "",
		String(comment.line ?? ""),
		comment.side ?? "",
		String(comment.start_line ?? ""),
		comment.start_side ?? "",
		normalizeBody(comment.body),
	].join("|");
	return createHash("sha256").update(key).digest("hex");
}

function loadComments(commentFilePath: string): CommentDraft[] {
	if (!existsSync(commentFilePath)) return [];
	try {
		const raw = readFileSync(commentFilePath, "utf8");
		const parsed = JSON.parse(raw) as CommentFile;
		const deduped = new Map<string, CommentDraft>();
		for (const comment of parsed.comments ?? []) {
			if (normalizeBody(comment.body).length === 0) continue;
			deduped.set(commentId(comment), comment);
		}
		return [...deduped.values()];
	} catch {
		return [];
	}
}

function loadState(statePath: string): ReviewState {
	if (!existsSync(statePath)) {
		return { version: 1, seenCommentIds: [] };
	}
	try {
		const raw = readFileSync(statePath, "utf8");
		const parsed = JSON.parse(raw) as Partial<ReviewState>;
		return {
			version: 1,
			seenCommentIds: Array.isArray(parsed.seenCommentIds) ? parsed.seenCommentIds : [],
		};
	} catch {
		return { version: 1, seenCommentIds: [] };
	}
}

function saveState(statePath: string, state: ReviewState): void {
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function formatCommentsForPrompt(comments: CommentDraft[]): string {
	return comments
		.map((comment, i) => {
			const location = `${comment.path ?? "unknown file"}${comment.line ? `:${comment.line}` : ""}`;
			return `${i + 1}. ${location}\n   ${normalizeBody(comment.body)}`;
		})
		.join("\n\n");
}

function parseFlags(args: string): { staged: boolean; all: boolean; reset: boolean } {
	const flags = new Set(args.split(/\s+/).filter(Boolean));
	return {
		staged: flags.has("--staged"),
		all: flags.has("--all"),
		reset: flags.has("--reset"),
	};
}

function commandExists(command: string): boolean {
	const check = spawnSync("sh", ["-lc", `command -v ${command}`], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return check.status === 0;
}

function resolveBundledComview(): string | null {
	const currentDir = dirname(fileURLToPath(import.meta.url));
	const ext = process.platform === "win32" ? ".exe" : "";
	const binaryPath = resolve(currentDir, "..", "bin", `comview-${process.platform}-${process.arch}${ext}`);
	if (existsSync(binaryPath)) {
		return binaryPath;
	}
	return null;
}

function resolveComviewPath(): string | null {
	const envPath = process.env.PI_COMVIEW_BIN;
	if (envPath && existsSync(envPath)) {
		return envPath;
	}

	const bundled = resolveBundledComview();
	if (bundled) {
		return bundled;
	}

	if (commandExists("comview")) {
		return "comview";
	}

	return null;
}

function runComview(cwd: string, staged: boolean, comviewCommand: string): number {
	const diff = spawnSync("git", staged ? ["diff", "--staged"] : ["diff"], {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});

	if (diff.status !== 0) {
		return diff.status ?? 1;
	}

	const comview = spawnSync(comviewCommand, {
		cwd,
		stdio: ["pipe", "inherit", "inherit"],
		input: diff.stdout,
		encoding: "utf8",
	});

	return comview.status ?? 1;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("review", {
		description:
			"Open comview on git diff, then auto-send new .comview/comments.json items for fixes. Flags: --staged, --all, --reset",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/review needs interactive TUI mode", "warning");
				return;
			}

			const comviewCommand = resolveComviewPath();
			if (!comviewCommand) {
				ctx.ui.notify(
					"comview binary not found. Reinstall pi-comview package or set PI_COMVIEW_BIN=/path/to/comview",
					"error",
				);
				return;
			}

			const { staged, all, reset } = parseFlags(args);
			const statePath = resolve(ctx.cwd, STATE_FILE);
			const commentFilePath = resolve(ctx.cwd, COMMENT_FILE);

			if (reset) {
				saveState(statePath, { version: 1, seenCommentIds: [] });
				ctx.ui.notify("Reset comview review state", "info");
				if (!staged && !all) {
					return;
				}
			}

			const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
				tui.stop();
				process.stdout.write("\x1b[2J\x1b[H");
				const status = runComview(ctx.cwd, staged, comviewCommand);
				tui.start();
				tui.requestRender(true);
				done(status);
				return { render: () => [], invalidate: () => {} };
			});

			if ((exitCode ?? 1) !== 0) {
				ctx.ui.notify(`comview exited with code ${exitCode ?? 1}`, "warning");
				return;
			}

			const comments = loadComments(commentFilePath);
			if (comments.length === 0) {
				ctx.ui.notify("No saved comments found in .comview/comments.json", "info");
				return;
			}

			const state = loadState(statePath);
			const seen = new Set(state.seenCommentIds);
			const pending = all ? comments : comments.filter((comment) => !seen.has(commentId(comment)));

			if (pending.length === 0) {
				ctx.ui.notify("No new comments to address (use /review --all to resend all)", "info");
				return;
			}

			const prompt = [
				"Address the following code review comments from comview.",
				"Apply code changes directly.",
				"After editing, summarize what you changed per comment.",
				"If a comment is outdated or not applicable, explain why.",
				"",
				formatCommentsForPrompt(pending),
			].join("\n");

			for (const comment of pending) {
				seen.add(commentId(comment));
			}
			saveState(statePath, { version: 1, seenCommentIds: [...seen] });

			pi.sendUserMessage(prompt);
			ctx.ui.notify(`Queued ${pending.length} new comment(s) for auto-fix`, "info");
		},
	});
}
