import pngToIco from "png-to-ico";
import fs from "fs";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || "build/icon.png";
const dest = process.argv[3] || "build/icon.ico";

const absSrc = path.isAbsolute(src) ? src : path.join(__dirname, src);
const absDest = path.isAbsolute(dest) ? dest : path.join(__dirname, dest);

// Build multi-size PNGs so Windows shortcuts / taskbar use the real logo (needs 256).
const sizes = [16, 24, 32, 48, 64, 128, 256];
const tmpDir = path.join(__dirname, "build", "_ico_sizes");
fs.mkdirSync(tmpDir, { recursive: true });

const py = `
from PIL import Image
import sys
src, outdir = sys.argv[1], sys.argv[2]
sizes = [int(x) for x in sys.argv[3:]]
im = Image.open(src).convert("RGBA")
paths = []
for s in sizes:
    p = f"{outdir}/icon-{s}.png"
    im.resize((s, s), Image.Resampling.LANCZOS).save(p)
    paths.append(p)
print("\\n".join(paths))
`;
const r = spawnSync(
  "python3",
  ["-c", py, absSrc, tmpDir, ...sizes.map(String)],
  { encoding: "utf8" },
);
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(r.status || 1);
}
const files = r.stdout
  .trim()
  .split("\n")
  .filter(Boolean);
const buf = await pngToIco(files);
fs.writeFileSync(absDest, buf);
console.log(`wrote ${absDest} (${buf.length} bytes, sizes ${sizes.join(",")})`);
