/**
 * The video sitemap: every dev log post with a video, so Search Console's
 * "discovered videos" counts them without waiting for a crawl. Generated at
 * build from the posts; the sitemap index lists it (astro.config.mjs).
 * Google wants the page, a thumbnail, a title, a description and the player.
 */
import type { APIRoute } from "astro";
import { logPosts } from "../lib/log";

const SITE = "https://free-the-borough.com";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const GET: APIRoute = async () => {
  const posts = (await logPosts()).filter((p) => p.data.youtube);
  const urls = posts.map((p) => {
    const { title, description, date, youtube, cover } = p.data;
    const thumb = cover ? `${SITE}${cover.src}` : `https://i.ytimg.com/vi/${youtube}/hqdefault.jpg`;
    return [
      "  <url>",
      `    <loc>${SITE}/log/${p.id}/</loc>`,
      "    <video:video>",
      `      <video:thumbnail_loc>${esc(thumb)}</video:thumbnail_loc>`,
      `      <video:title>${esc(title)}</video:title>`,
      `      <video:description>${esc(description)}</video:description>`,
      `      <video:player_loc>https://www.youtube.com/embed/${youtube}</video:player_loc>`,
      `      <video:publication_date>${date.toISOString()}</video:publication_date>`,
      "    </video:video>",
      "  </url>",
    ].join("\n");
  });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
};
