/**
 * /llms.txt (llmstxt.org): a plain markdown map of the site for AI tools. No
 * big engine has said it reads one yet, so this is cheap insurance rather than
 * a ranking lever. Built from the dev log so new posts land in it on their own.
 */
import type { APIRoute } from "astro";
import { logPosts } from "../lib/log";
import { SITE, AUTHOR_NAME, YOUTUBE } from "../lib/studio";

export const GET: APIRoute = async () => {
  const posts = await logPosts();
  const lines = [
    "# Free the Borough",
    "",
    `> Free the Borough is a one-person indie game studio run by ${AUTHOR_NAME}. It makes Blood in the Sand, a short, bloody multiplayer arena game for iPhone and Android, and a dev log of written-up videos about how games and the games industry work.`,
    "",
    `Every dev log post is the full written version of a video on the studio's YouTube channel (${YOUTUBE}), with sources listed at the end.`,
    "",
    "## Games",
    "",
    `- [Blood in the Sand](${SITE}/): Short, bloody duels for iPhone and Android. You don't aim, you time it: every attack has a windup you can see coming, one life a round, first to three wins.`,
    "",
    ...(posts.length
      ? ["## Dev log", "", ...posts.map((p) => `- [${p.data.title}](${SITE}/log/${p.id}/): ${p.data.summary ?? p.data.description}`), ""]
      : []),
    "## About",
    "",
    `- [About ${AUTHOR_NAME}](${SITE}/about/): Who makes the games and the dev log, and how to get in touch.`,
    `- [Support](${SITE}/support/): Help with Blood in the Sand, purchases and accounts.`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
