import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Dev log: one FOLDER per post in src/content/log/, named for the URL
// (`my-post/` → /log/my-post/), holding `index.md`, its `cover.jpg` and its
// pictures. Delete the folder, the post is gone. Images beside the markdown
// are processed by Astro (sized, optimised) both in the frontmatter (`cover:
// ./cover.jpg`) and in the body (`![alt](./1.jpg)`). Most posts are a YouTube
// video written up; `youtube` is the video id and puts a click-to-play player
// at the top of the page.
const log = defineCollection({
  loader: glob({ pattern: "*/index.md", base: "./src/content/log", generateId: ({ entry }) => entry.split("/")[0]! }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      // The answer-first opening: two or three plain sentences that answer the
      // title's question, shown above the video. Answer engines quote passages
      // like this, so it stands on its own and only says what the post says.
      summary: z.string().optional(),
      date: z.coerce.date(),
      updated: z.coerce.date().optional(),
      youtube: z.string().optional(),
      // The poster for the player and the social image (1280×720). Without one the
      // player shows a plain plate, so nothing is fetched from YouTube until play.
      cover: image().optional(),
      draft: z.boolean().default(false),
    }),
});

export const collections = { log };
