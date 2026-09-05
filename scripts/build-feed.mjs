import fs from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
}

const OUT = path.resolve("public");
const SHARD_SIZE = 1000;
const PAGE_SIZE = 1000;

const allowedAnims = new Set([
  "kinetic_slam","stagger_pop","neon_surge","cyber_scramble",
  "isometric_3d","glitch_rgb","minimal_drift"
]);
const allowedThemes = new Set([
  "cyber","gold","matrix","acid","crimson","minimal"
]);
const allowedBgs = new Set([
  "warp","grid","clouds","aurora","pulse","orbit"
]);

async function fetchRows() {
  const rows = [];
  let offset = 0;

  while (true) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/kinetic_wall`);
    url.searchParams.set(
      "select",
      "id,serial_no,headline,accent_word,tagline,subtitle,anim,theme,bg,outbound_url,audio_url,is_pinned,created_at"
    );
    url.searchParams.set("order", "created_at.desc,id.desc");
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (!res.ok) {
      throw new Error(`Supabase read failed: ${res.status} ${await res.text()}`);
    }

    const batch = await res.json();
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

function normalize(row) {
  if (!row.id || !row.headline) throw new Error("Invalid card: missing id/headline");
  if (!allowedAnims.has(row.anim)) throw new Error(`Invalid animation on ${row.id}`);
  if (!allowedThemes.has(row.theme)) throw new Error(`Invalid theme on ${row.id}`);
  if (!allowedBgs.has(row.bg)) throw new Error(`Invalid background on ${row.id}`);

  return {
    id: row.id,
    serial_no: row.serial_no,
    headline: row.headline,
    accent_word: row.accent_word ?? "",
    tagline: row.tagline ?? "",
    subtitle: row.subtitle ?? "",
    anim: row.anim,
    theme: row.theme,
    bg: row.bg,
    outbound_url: row.outbound_url ?? null,
    audio_url: row.audio_url ?? null,
    is_pinned: Boolean(row.is_pinned),
    created_at: row.created_at
  };
}

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

const rows = (await fetchRows()).map(normalize);

const shards = [];
const cardIndex = {};

for (let i = 0; i < rows.length; i += SHARD_SIZE) {
  const cards = rows.slice(i, i + SHARD_SIZE);
  const number = Math.floor(i / SHARD_SIZE) + 1;
  const file = `feed-${String(number).padStart(4, "0")}.json`;

  await fs.writeFile(
    path.join(OUT, file),
    JSON.stringify(cards),
    "utf8"
  );

  shards.push({
    file,
    start: i + 1,
    end: i + cards.length,
    count: cards.length
  });

  for (let j = 0; j < cards.length; j++) {
    cardIndex[cards[j].id] = {
      file,
      position: j
    };
  }
}

await fs.writeFile(
  path.join(OUT, "manifest.json"),
  JSON.stringify({
    version: 3,
    shard_size: SHARD_SIZE,
    total_cards: rows.length,
    generated_at: new Date().toISOString(),
    shards
  }, null, 2),
  "utf8"
);

await fs.writeFile(
  path.join(OUT, "card-index.json"),
  JSON.stringify(cardIndex),
  "utf8"
);

console.log(`Published ${rows.length} cards across ${shards.length} shard(s).`);
