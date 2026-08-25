# free-the-borough-site

The studio's brochure site + legal pages for **free-the-borough.com** — one static
site shared by every Free the Borough game.

- `/` — landing page (the games)
- `/privacy/` — privacy policy (App Store + Play Store privacy-policy URL)
- `/terms/` — terms of service
- `/delete-account/` — how to request account/data deletion (Play Console data-deletion URL)

Plain HTML + one stylesheet in `public/`. No build step, no JS, no cookies.

## Deploying (Render Static Site)

1. Render dashboard → **New → Static Site** → pick the `heroic` repo.
2. Settings:
   - **Root Directory**: `apps/free-the-borough-site`
   - **Build Command**: *(leave empty)*
   - **Publish Directory**: `public`
3. After the first deploy, add custom domains **free-the-borough.com** and
   **www.free-the-borough.com**; Render shows the DNS records to add
   (an A/ALIAS for the apex, CNAME for www).

**DNS caution:** `clerk.free-the-borough.com` is CNAMEd to Clerk for production
auth — leave that record untouched; the site only claims the apex + www.

## Store forms

- **App Store Connect** → App Privacy → privacy policy URL:
  `https://free-the-borough.com/privacy/`
- **Play Console** → Store listing → privacy policy:
  `https://free-the-borough.com/privacy/`
- **Play Console** → App content → Data safety → account deletion URL:
  `https://free-the-borough.com/delete-account/`
- Terms URL (optional fields / support pages): `https://free-the-borough.com/terms/`

## Editing

Legal pages carry an effective date under the title — bump it on any material
change. The privacy policy's **per-game appendix** is where a new game's specifics
get added; keep the body generic to all games.
