/**
 * Cuts the raw recording to a 2-minute reel.
 *
 * The title and closing cards stay at natural speed because they have to be
 * read; the working middle is compressed to fit. Nothing is reordered or
 * reshot — it is the same take, tightened.
 */
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const ffmpeg = require("ffmpeg-static");

const OUT = __dirname;
const RAW = path.join(OUT, "screenmate-raw.mp4");
const FINAL = path.join(OUT, "screenmate-demo.mp4");

// Submission caps are usually "under 2 minutes", so land clear of the line
// rather than exactly on it. Override with: node demo/cut.js 95
const TARGET = Number(process.argv[2]) || 112;
const HEAD = 6.5; // title card, read at 1x
const TAIL = 7.0; // closing card, read at 1x

function probeDuration(file) {
  let stderr = "";
  try {
    execFileSync(ffmpeg, ["-hide_banner", "-i", file], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (e) {
    stderr = (e.stderr || "").toString();
  }
  const m = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error(`could not read duration of ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

if (!fs.existsSync(RAW)) {
  console.log("No raw recording. Run: node demo/record.js");
  process.exit(1);
}

const raw = probeDuration(RAW);
const middleRaw = raw - HEAD - TAIL;
const middleTarget = TARGET - HEAD - TAIL;
const speed = middleRaw / middleTarget;

console.log(`raw     : ${raw.toFixed(1)}s`);
console.log(`middle  : ${middleRaw.toFixed(1)}s -> ${middleTarget.toFixed(1)}s (${speed.toFixed(2)}x)`);

// setpts scales presentation timestamps: PTS/1 is unchanged, PTS/2 is twice as fast.
const filter = [
  `[0:v]trim=0:${HEAD},setpts=PTS-STARTPTS[a]`,
  `[0:v]trim=${HEAD}:${raw - TAIL},setpts=(PTS-STARTPTS)/${speed.toFixed(4)}[b]`,
  `[0:v]trim=${raw - TAIL}:${raw},setpts=PTS-STARTPTS[c]`,
  `[a][b][c]concat=n=3:v=1:a=0[v]`,
].join(";");

execFileSync(
  ffmpeg,
  [
    "-y",
    "-i", RAW,
    "-filter_complex", filter,
    "-map", "[v]",
    "-r", "24",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "21",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    FINAL,
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

const finalDur = probeDuration(FINAL);
const mb = (fs.statSync(FINAL).size / 1024 / 1024).toFixed(1);
console.log(`final   : ${finalDur.toFixed(1)}s, ${mb} MB`);
console.log(`wrote   : demo/${path.basename(FINAL)}`);
