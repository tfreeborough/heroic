/**
 * The canvas can only draw a face once it's loaded. Caveat and Inter come
 * from the Google stylesheet in index.html; the game's title face is served
 * by the server as "SandTitle" (the FontFace API, so the bundler never sees
 * a url() it would try to resolve).
 */
export const loadFonts = async (game: string): Promise<void> => {
  try {
    const title = new FontFace("SandTitle", `url(/fonts/${game}/title.ttf)`, { weight: "700" });
    document.fonts.add(await title.load());
  } catch (e) {
    console.warn("title font didn't load", e);
  }
  await Promise.all(['500 28px Caveat', '700 28px Caveat', '600 16px Inter', '700 16px Inter'].map((f) => document.fonts.load(f).catch(() => [])));
  await document.fonts.ready;
};
