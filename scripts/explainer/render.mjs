// Render the explainer frame by frame and pipe the frames into ffmpeg, with the original soundtrack.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
const require = createRequire('/home/user/wine-or-whine/scripts/')
const { chromium } = require('playwright')
const [,, html, audioSrc, out, secs = '174', fps = '30'] = process.argv
const N = Math.round(Number(secs) * Number(fps))
const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', fps, '-c:v', 'mjpeg', '-i', '-',
  '-i', audioSrc, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-t', secs, '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] })
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto('file://' + html)
await p.evaluate(() => window.ready)
const t0 = Date.now()
for (let i = 0; i < N; i++) {
  await p.evaluate((ms) => window.setTime(ms), (i * 1000) / Number(fps))
  const buf = await p.screenshot({ type: 'jpeg', quality: 92 })
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r))
  if (i % 600 === 0) console.log(`frame ${i}/${N} ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}
ff.stdin.end()
await new Promise((r) => ff.on('close', r))
await b.close()
console.log('done', out)
