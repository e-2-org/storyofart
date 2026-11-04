/**
 * Renders The Story of Art to video in sections, split at the section
 * headings (plus the introduction before the first heading)
 *
 * Sections are rendered in parallel by scripts/capture.js, on one frame grid
 * so they join exactly. Each section is written to a .partial file and renamed
 * when it's finished, so the render can be stopped and restarted: finished
 * sections are skipped. When all sections are done, a concat list is written
 * which ffmpeg can use to join them without re-encoding:
 *
 *   ffmpeg -f concat -safe 0 -i output/sections/concat.txt -c copy output/story-of-art.mp4
 *
 * Usage:
 *   node scripts/render-sections.js --list
 *   node scripts/render-sections.js [--jobs 4] [--fps 30] [--width 1440] [--aspect 5:3] [--only 1,5-8]
 *   node scripts/render-sections.js --posters [--width 1440] [--aspect 5:3] [--only 1,5-8]
 *
 * --posters renders a still for each section (e.g. 23-perspective.png, to use
 * as the video's poster image) as its heading leaves the screen, at the moment
 * it has grown to --poster-scale times its resting size (default 3; 1 is the
 * heading at rest in the centre of the screen). The introduction uses its
 * first sentence, at no more than twice its resting size so that it fits.
 *
 * Other options (e.g. --crf) are passed to capture.js.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const timeline = require(path.join(ROOT, 'timeline.json'));

const opts = { jobs: String(Math.max(1, Math.floor(os.cpus().length / 3))), fps: '30', width: '1440', aspect: '4:3', out: 'output/sections' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'list' || key === 'posters') {
        opts[key] = true;
    } else {
        opts[key] = argv[++i];
    }
}
const fps = parseFloat(opts.fps);
const outDir = path.resolve(ROOT, opts.out);

/* sections start at each heading - section headings are the boxes which exit upwards */
const slug = str => str.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/* poster: the moment the heading (or the first sentence) has grown to --poster-scale times its resting size */
const posterScale = parseFloat(opts['poster-scale'] || 3);
const posterTime = (box, scale) => box.start + box.in + (box.pause || 0) + zoomOutAt(box, scale) * box.out;
const first = timeline.boxes[0];
/* the introduction's first sentence is much wider than a heading, so it's kept small enough to fit the screen */
const starts = [{ title: 'Introduction', start: 0, poster: posterTime(first, Math.min(posterScale, 2)) }];
timeline.boxes.forEach(box => {
    if (box.exit < 0) {
        starts.push({ title: box.text, start: box.start, poster: posterTime(box, posterScale) });
    }
});
const sections = starts.map((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].start : timeline.duration;
    const n = String(i).padStart(2, '0');
    return {
        n: i,
        title: s.title,
        start: s.start,
        end,
        poster: s.poster,
        /* frame range on the piece's frame grid: [first, last) */
        frames: [Math.round(s.start / 1000 * fps), Math.round(end / 1000 * fps)],
        file: `${n}-${slug(s.title)}.mp4`,
    };
});

/**
 * How far through a box's zoom out (0-1) it reaches a given scale - the zoom
 * out goes from 1em to 20em, eased by the original keySplines
 */
function zoomOutAt(box, scale) {
    if (scale <= 1) return 0;
    const [x1, y1, x2, y2] = timeline.splines[box.splines][2];
    const bezier = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
    const target = (Math.min(scale, 20) - 1) / 19;
    /* find the bezier parameter for the target value, then the time fraction (x) at that parameter */
    let lo = 0, hi = 1;
    for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (bezier(y1, y2, mid) < target) lo = mid; else hi = mid;
    }
    return bezier(x1, x2, (lo + hi) / 2);
}

function formatTime(ms) {
    const s = Math.round(ms / 1000);
    return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/* --only 1,5-8 */
function selected(n) {
    if (!opts.only) return true;
    return opts.only.split(',').some(part => {
        const [a, b] = part.split('-').map(Number);
        return b === undefined ? n === a : n >= a && n <= b;
    });
}

if (opts.list) {
    sections.forEach(s => console.log(`${String(s.n).padStart(2)}  ${formatTime(s.start)}  ${formatTime(s.end - s.start).padStart(8)}  ${s.title}`));
    process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
const alsoDir = opts.also && path.resolve(ROOT, opts.also);
if (alsoDir) fs.mkdirSync(alsoDir, { recursive: true });

if (opts.posters) {
    /* one capture process renders all the stills, which are then renamed to match the videos */
    const wanted = sections.filter(s => selected(s.n));
    const tmp = path.join(outDir, '.posters');
    const child = spawn(process.execPath, [
        path.join(__dirname, 'capture.js'),
        '--stills', wanted.map(s => String(s.poster / 1000)).join(','),
        '--width', opts.width,
        '--aspect', opts.aspect,
        '--out', path.relative(ROOT, tmp),
    ], { cwd: ROOT, stdio: 'inherit' });
    child.on('close', code => {
        if (code !== 0) process.exit(code);
        wanted.forEach(s => {
            fs.renameSync(path.join(tmp, `still-${s.poster / 1000}.png`), path.join(outDir, s.file.replace(/\.mp4$/, '.png')));
        });
        fs.rmSync(tmp, { recursive: true, force: true });
        console.log(`${wanted.length} posters written to ${path.relative(ROOT, outDir)}`);
    });
    return;
}

const passthrough = Object.entries(opts)
    .filter(([key]) => !['jobs', 'fps', 'width', 'aspect', 'out', 'only', 'posters', 'poster-scale', 'also'].includes(key))
    .flatMap(([key, value]) => ['--' + key, value]);
const todo = sections.filter(s => selected(s.n) && !fs.existsSync(path.join(outDir, s.file)));
const totalFrames = todo.reduce((n, s) => n + s.frames[1] - s.frames[0], 0);
console.log(`${todo.length} sections to render (${totalFrames} frames) with ${opts.jobs} jobs`);

function render(section) {
    return new Promise((resolve, reject) => {
        const partial = path.join(outDir, section.file.replace(/\.mp4$/, '.partial.mp4'));
        /* --also DIR: a second video of each section from the same frames (see capture.js) */
        const alsoPartial = alsoDir && path.join(alsoDir, section.file.replace(/\.mp4$/, '.partial.mp4'));
        const child = spawn(process.execPath, [
            path.join(__dirname, 'capture.js'),
            '--frames', section.frames.join(':'),
            '--fps', opts.fps,
            '--width', opts.width,
            '--aspect', opts.aspect,
            '--out', path.relative(ROOT, partial),
            ...(alsoPartial ? ['--also', path.relative(ROOT, alsoPartial)] : []),
            ...passthrough,
        ], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
        let errors = '';
        child.stderr.on('data', d => errors += d);
        const started = Date.now();
        child.on('close', code => {
            if (code !== 0) {
                reject(new Error(`section ${section.n} (${section.title}) failed: ${errors.trim()}`));
                return;
            }
            fs.renameSync(partial, path.join(outDir, section.file));
            if (alsoPartial) fs.renameSync(alsoPartial, path.join(alsoDir, section.file));
            console.log(`done ${section.file} (${formatTime(section.end - section.start)} in ${formatTime(Date.now() - started)})`);
            resolve();
        });
    });
}

(async () => {
    /* longest first, so a long section doesn't start last and hold everything up */
    const queue = todo.slice().sort((a, b) => (b.frames[1] - b.frames[0]) - (a.frames[1] - a.frames[0]));
    const failures = [];
    const worker = async () => {
        while (queue.length) {
            const section = queue.shift();
            try {
                await render(section);
            } catch (e) {
                failures.push(e.message);
                console.error(e.message);
            }
        }
    };
    await Promise.all(Array.from({ length: parseInt(opts.jobs, 10) }, worker));

    /* section index, and a concat list once every section exists */
    fs.writeFileSync(path.join(outDir, 'sections.json'), JSON.stringify(sections.map(s => ({
        n: s.n, title: s.title, start: formatTime(s.start), duration: formatTime(s.end - s.start), file: s.file,
        poster: s.file.replace(/\.mp4$/, '.png'), posterTime: formatTime(s.poster),
    })), null, 1));
    const missing = sections.filter(s => !fs.existsSync(path.join(outDir, s.file)));
    if (!missing.length) {
        fs.writeFileSync(path.join(outDir, 'concat.txt'), sections.map(s => `file '${s.file}'`).join('\n') + '\n');
        console.log(`all sections rendered - join them with:\n  ffmpeg -f concat -safe 0 -i ${path.relative(ROOT, path.join(outDir, 'concat.txt'))} -c copy output/story-of-art.mp4`);
    } else {
        console.log(`${missing.length} sections still to render`);
    }
    process.exit(failures.length ? 1 : 0);
})();
