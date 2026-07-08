// Dev spectator: connect, never hello, print a few snapshots, exit.
const ws = new WebSocket("ws://localhost:7777");
let n = 0;
ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data));
  if (msg.t !== "snapshot") return;
  n += 1;
  if (n % 30 !== 1) return; // one per second
  const players = msg.players
    .map((p: any) => `p${p.id}[${p.name}] (${p.x.toFixed(0)},${p.y.toFixed(0)}) hp=${p.hp} seq=${p.lastSeq} ${p.alive ? "" : "DEAD"}`)
    .join(" | ");
  console.log(`tick=${msg.tick} phase=${msg.round.phase} wins=${msg.round.wins} ${players}`);
  if (n > 150) process.exit(0);
};
setTimeout(() => process.exit(1), 10_000);
