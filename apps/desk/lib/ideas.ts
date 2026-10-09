/**
 * Video ideas: a list of things worth filming, ticked off when made. One
 * JSON file next to the renders (<rendersDir>/ideas.json, like the queue's
 * schedule.json). This is the pure half (types) — the page imports it too.
 * The file store is ideasStore.ts.
 */
export type Idea = {
  id: string;
  /** One line: the gist, or the title as it'd read on the video. */
  title: string;
  /** Anything more: the items, footage to use, the opening line. Basic markdown (bold, italics, bullets, numbered lists). */
  description: string;
  /** ISO timestamp once it's made. */
  done?: string;
  createdAt: string;
};
export type IdeaPatch = Partial<Pick<Idea, "title" | "description">> & { done?: boolean };
