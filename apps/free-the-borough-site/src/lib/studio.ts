/**
 * Who makes the site, as schema.org data. One source for the studio and the
 * author so every page describes them the same way, with the same `@id`s:
 * answer engines (ChatGPT search, Perplexity, AI Overviews) lean on knowing
 * which real person and studio stand behind a page before they cite it.
 */
export const SITE = "https://free-the-borough.com";
export const YOUTUBE = "https://www.youtube.com/@FreeTheBoroughGames";
export const DISCORD = "https://discord.gg/8FHgBmaSnT";
export const REDDIT = "https://www.reddit.com/r/FreeTheBoroughGames/";
export const LINKEDIN = "https://www.linkedin.com/in/freebs/";
export const EMAIL = "freetheborough.games@gmail.com";

export const AUTHOR_NAME = "Tom Freeborough";

export const ORG = {
  "@type": "Organization",
  "@id": `${SITE}/#org`,
  name: "Free the Borough",
  url: `${SITE}/`,
  logo: { "@type": "ImageObject", url: `${SITE}/img/bits/icon.png` },
  email: EMAIL,
  founder: { "@id": `${SITE}/about/#tom` },
  sameAs: [YOUTUBE, DISCORD, REDDIT],
};

export const AUTHOR = {
  "@type": "Person",
  "@id": `${SITE}/about/#tom`,
  name: AUTHOR_NAME,
  url: `${SITE}/about/`,
  jobTitle: "Indie game developer",
  worksFor: { "@id": `${SITE}/#org` },
  // Tom's own profiles (X, Bluesky…) belong here as they're added.
  sameAs: [LINKEDIN, YOUTUBE],
};
