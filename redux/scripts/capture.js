/**
 * Renders The Story of Art to video
 *
 * Opens the player in headless Chrome, renders each frame at an exact time
 * with player.renderAt(), and pipes screenshots to ffmpeg. Rendering doesn't
 * need to keep up with real time, and long ranges can be split into chunks
 * and rendered in parallel, then joined with ffmpeg's concat demuxer.
 *
 * Usage:
 *   node scripts/capture.js --from 0 --to 30 --out output/test.mp4
 *   node scripts/capture.js --from 1h --to 2h --fps 50 --width 2048 --out output/part2.mp4
 *   node scripts/capture.js --stills 5,12.5,9h29m --out output/stills
 *   node scripts/capture.js --frames 2700:4500 --fps 30 --out output/frames.mp4
 *
 * Times are seconds, or like 2h15m30s. --frames gives a range of frames
 * (start inclusive, end exclusive) on the piece's frame grid at --fps, which
 * render-sections.js uses so that sections join exactly.
 * --vf applies an ffmpeg filter to the video; --also writes a second video from the same frames,
 * with its own filter (--also-vf). E.g. 4K in both shapes from one render:
 *   --width 4096 --aspect 16:9 --vf scale=3840:2160:flags=lanczos
 *   --also out-dci.mp4 --also-vf crop=4096:2160:0:72
 * --threads limits each x264 encoder's threads, which also limits its memory (at 4K the default can use several GB).
 * --aspect 5:3 crops the top and bottom of the 4:3 composition, as the
 * projection was masked at the Tate (default 4:3).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
/* the site, which holds the player (docs/ at the repository root, published by GitHub Pages) */
const SITE = path.resolve(ROOT, '../docs');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

function parseTime(str) {
    if (/^[\d.]+$/.test(str)) return parseFloat(str) * 1000;
    const part = unit => parseFloat((str.match(new RegExp('([\\d.]+)' + unit)) || [, 0])[1]);
    return (part('h') * 3600 + part('m') * 60 + part('s')) * 1000;
}

function args() {
    const opts = { from: '0', to: '30', fps: '30', width: '1440', out: 'output/test.mp4', crf: '18', aspect: '4:3' };
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i += 2) {
        opts[argv[i].replace(/^--/, '')] = argv[i + 1];
    }
    return opts;
}

/* a minimal static server for the player (fetch() doesn't work from file://) */
function serve() {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
    const server = http.createServer((req, res) => {
        const file = path.join(SITE, decodeURIComponent(new URL(req.url, 'http://x').pathname));
        if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
    const opts = args();
    const width = parseInt(opts.width, 10);
    const [aw, ah] = opts.aspect.split(':').map(Number);
    /* video encoders need even dimensions */
    const height = Math.round(width * ah / aw / 2) * 2;
    const server = await serve();
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.goto(`http://127.0.0.1:${server.address().port}/player.html?capture&aspect=${opts.aspect}`);
    await page.evaluate(() => window.playerReady);
    await page.evaluate(() => document.fonts.ready);
    const render = t => page.evaluate(t => window.player.renderAt(t), t);
    fs.mkdirSync(path.dirname(path.resolve(ROOT, opts.out)), { recursive: true });

    if (opts.stills) {
        const dir = path.resolve(ROOT, opts.out);
        fs.mkdirSync(dir, { recursive: true });
        for (const s of opts.stills.split(',')) {
            await render(parseTime(s));
            await page.screenshot({ path: path.join(dir, `still-${s}.png`) });
        }
        console.log(`stills written to ${dir}`);
    } else {
        const fps = parseFloat(opts.fps);
        let first = Math.round(parseTime(opts.from) / 1000 * fps);
        let last = Math.round(parseTime(opts.to) / 1000 * fps);
        if (opts.frames) {
            [first, last] = opts.frames.split(':').map(Number);
        }
        const frames = last - first;
        /* one output, or two from the same frames (--also), each with an optional filter (--vf, --also-vf) */
        const outputs = [{ file: opts.out, vf: opts.vf }];
        if (opts.also) outputs.push({ file: opts.also, vf: opts['also-vf'] });
        const encode = ['-c:v', 'libx264', '-preset', 'slow', '-crf', opts.crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
            ...(opts.threads ? ['-threads', opts.threads] : [])];
        const filters = outputs.length > 1
            ? ['-filter_complex', `[0]split=${outputs.length}${outputs.map((_, i) => `[s${i}]`).join('')};`
                + outputs.map((o, i) => `[s${i}]${o.vf || 'null'}[o${i}]`).join(';')]
            : (opts.vf ? ['-vf', opts.vf] : []);
        const ffmpeg = spawn('ffmpeg', [
            '-y', '-loglevel', 'error',
            '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
            ...filters,
            ...outputs.flatMap((o, i) => [...(outputs.length > 1 ? ['-map', `[o${i}]`] : []), ...encode, path.resolve(ROOT, o.file)]),
        ], { stdio: ['pipe', 'inherit', 'inherit'] });
        const started = Date.now();
        for (let i = 0; i < frames; i++) {
            await render((first + i) * 1000 / fps);
            const png = await page.screenshot({ type: 'png' });
            if (!ffmpeg.stdin.write(png)) {
                await new Promise(resolve => ffmpeg.stdin.once('drain', resolve));
            }
            if (i % Math.round(fps * 10) === 0) {
                process.stdout.write(`\r${i}/${frames} frames`);
            }
        }
        ffmpeg.stdin.end();
        await new Promise(resolve => ffmpeg.on('close', resolve));
        const secs = (Date.now() - started) / 1000;
        console.log(`\r${frames} frames in ${secs.toFixed(0)}s (${(frames / secs).toFixed(1)} fps) -> ${opts.out}`);
    }
    await browser.close();
    server.close();
})();
