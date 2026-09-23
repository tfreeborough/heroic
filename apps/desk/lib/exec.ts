/**
 * Run a child process WITHOUT blocking Bun's event loop.
 *
 * Never Bun.spawnSync inside a Bun.serve handler for anything that can run
 * longer than a moment (rclone to Drive, an ffmpeg encode): the loop freezes,
 * the browser's connection idles out under it, and when the handler finally
 * returns Bun writes the reply to a dead socket — on 1.2.x that was a
 * segfault inside uWS (HttpResponse::writeMark), taking the whole Desk down.
 */
export type ExecResult = { ok: boolean; exitCode: number; out: string; err: string };

export const exec = async (cmd: string[], cwd?: string): Promise<ExecResult> => {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, exitCode] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { ok: exitCode === 0, exitCode, out, err };
};
