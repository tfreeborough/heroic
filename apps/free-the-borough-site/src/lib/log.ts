import { getCollection } from "astro:content";

// Astro warns on every page when a collection is empty, so only ask for the
// dev log once there is at least one markdown file in it.
const files = import.meta.glob("../content/log/*/index.md");

export async function logPosts() {
  if (Object.keys(files).length === 0) return [];
  const posts = await getCollection("log", (p) => !p.data.draft);
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}
