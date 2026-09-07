import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let unavailableCommand: string | undefined;
const warnedCommands = new Set<string>();

export type RipgrepExecutionResult = {
  available: boolean;
  stdout: string;
  stderr: string;
};

function ripgrepCommand(): string {
  return process.env.REPOSCOPE_RG_PATH?.trim() || "rg";
}

export async function executeRipgrep(
  args: string[],
  options: { maxBuffer?: number } = {},
): Promise<RipgrepExecutionResult> {
  const command = ripgrepCommand();

  if (unavailableCommand === command) {
    return { available: false, stdout: "", stderr: "" };
  }

  try {
    const result = await execFileAsync(command, args, {
      maxBuffer: options.maxBuffer,
    });
    return {
      available: true,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }

    unavailableCommand = command;

    if (!warnedCommands.has(command)) {
      warnedCommands.add(command);
      console.error(
        `RepoScope: ripgrep executable not found (${command}); using portable Git/Node fallback. Search may be slower.`,
      );
    }

    return { available: false, stdout: "", stderr: "" };
  }
}
