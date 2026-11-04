// Erzeugt die PNG-Icons der PWA aus public/icon.svg (sharp kommt aus dem Server-Paket).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hier = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(hier, "../../server/package.json"));
const sharp = require("sharp");
const oeffentlich = path.join(hier, "../public");
const svg = path.join(oeffentlich, "icon.svg");

await sharp(svg).resize(192, 192).png().toFile(path.join(oeffentlich, "icon-192.png"));
await sharp(svg).resize(512, 512).png().toFile(path.join(oeffentlich, "icon-512.png"));
// maskable: mit Rand, damit runde Masken nichts abschneiden
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#0f766e" } })
  .composite([{ input: await sharp(svg).resize(400, 400).png().toBuffer(), top: 56, left: 56 }])
  .png()
  .toFile(path.join(oeffentlich, "icon-maskable-512.png"));
console.log("Icons erzeugt");
