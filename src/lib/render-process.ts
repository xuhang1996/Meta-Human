import { spawn } from "node:child_process";

interface CommandOptions {
  cwd?: string;
}

export function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code}\n${stderr}`,
        ),
      );
    });
  });
}
