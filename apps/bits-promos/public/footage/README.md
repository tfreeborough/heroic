# Phone footage

Mirrored from the Google Drive footage folder by the Desk's **Sync from
Drive** button (`bun run desk` at the repo root) or `bun run footage:sync`.
Each recording has a same-named `.json` sidecar with its facts and your
notes; clips the Desk cleaned up land here too, with `source` naming the
original. Media is gitignored; sidecars are committed. `.trash/` is where
binned clips go, and `.binned.json` (committed) lists them so a sync never
brings a binned recording back from Drive.
