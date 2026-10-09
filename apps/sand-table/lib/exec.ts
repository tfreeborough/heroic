/** Run a child process without blocking Bun's event loop (never spawnSync in a Bun.serve handler). */
export type ExecResult = { ok: boolean; exitCode: number; out: string; err: string };

export const exec = async (cmd: string[], cwd?: string, signal?: AbortSignal): Promise<ExecResult> => {
  const p = Bun.spawn(cmd, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const kill = () => p.kill("SIGKILL");
  if (signal?.aborted) kill();
  signal?.addEventListener("abort", kill, { once: true });
  try {
    const [out, err, exitCode] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { ok: exitCode === 0, exitCode, out, err };
  } finally {
    signal?.removeEventListener("abort", kill);
  }
};
