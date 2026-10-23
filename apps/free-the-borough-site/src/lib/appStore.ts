/**
 * The game's App Store rating, looked up at build time so the homepage's
 * software-app structured data can carry a real aggregateRating (Google
 * shows the app rich result only with one, and only ever a true one). Each
 * storefront rates separately, so the busiest of a few is used. No ratings
 * yet, or no network at build: nothing, and the rest of the data still goes out.
 */
export type AppRating = { value: number; count: number };

export async function appStoreRating(appId: string, storefronts = ["gb", "us"]): Promise<AppRating | undefined> {
  let best: AppRating | undefined;
  for (const country of storefronts) {
    try {
      const res = await fetch(`https://itunes.apple.com/lookup?id=${appId}&country=${country}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: { averageUserRating?: number; userRatingCount?: number }[] };
      const r = data.results?.[0];
      const count = r?.userRatingCount ?? 0;
      if (count > 0 && (!best || count > best.count)) best = { value: Math.round((r?.averageUserRating ?? 0) * 10) / 10, count };
    } catch {
      // offline or slow: build without it
    }
  }
  return best;
}
