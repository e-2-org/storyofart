/**
 * Builds the GitHub Pages index page (docs/index.html at the repository root)
 *
 * The page introduces the work, links to the browser version (player.html), and
 * lists the videos - the full piece, then each section - which are served
 * from MEDIA. The figures in the information box and under each video are
 * worked out here from timeline.json and the render outputs (output/), so
 * run this again after re-rendering.
 *
 * Usage: node scripts/build-site.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..');
const SITE = path.join(REPO, 'docs');
const OUT = path.join(SITE, 'index.html');
const OUTPUT = path.join(ROOT, 'output');
const SECTIONS = path.join(OUTPUT, 'sections');
/* where the videos and posters are served from (MEDIA=../redux/output/sections/ previews with local posters) */
const MEDIA = process.env.MEDIA || 'https://media.bjorsq.net/soa/';
const FULL = 'story-of-art.mp4';
/* the settings the videos were rendered with (see README) */
const VIDEO = { width: 1920, height: 1080, fps: 30, aspect: '16:9', codec: 'H.264 (x264, preset slow, CRF 18)' };

const timeline = require(path.join(SITE, 'timeline.json'));
const boxes = timeline.boxes;

/* ---------- formatting ---------- */
const num = n => Math.round(n).toLocaleString('en-GB');
const hms = ms => {
    const s = Math.round(ms / 1000);
    return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};
const duration = ms => {
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
};
const seconds = ms => (ms / 1000).toFixed(ms < 1000 ? 2 : 1).replace(/\.0+$/, '') + 's';
const bytes = b => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(0) + ' MB';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const title = s => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()).replace(/\b(Of|And|The|In)\b/g, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase());
const words = text => text.split(' ').filter(w => w && w !== '_br_').length;
const boxTime = b => b.in + (b.pause || 0) + b.out;

/* ---------- the layout, as player.js does it, to count lines and glyphs ---------- */
const font = timeline.font;
const advance = str => [...str].reduce((w, ch) => w + (font.glyphs[ch] ? font.glyphs[ch][0] : font.missing), 0);
function lineCount(box) {
    const scale = box.size * 12 / font.unitsPerEm;
    const width = box.size * 420;
    const list = box.text.split(' ');
    let lines = 0, line = [];
    while (list.length) {
        const word = list[0];
        if ((advance(line.concat(word).join(' ')) * scale > width && line.length) || word === '_br_') {
            lines++;
            line = [];
            if (word === '_br_') list.shift();
        } else {
            line.push(list.shift());
        }
    }
    return lines + (line.length ? 1 : 0);
}

/* ---------- sections, as render-sections.js splits them ---------- */
const slug = str => str.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const starts = [{ name: 'Introduction', index: 0 }];
boxes.forEach((b, i) => { if (b.exit < 0) starts.push({ name: b.text, index: i }); });
const sections = starts.map((s, n) => {
    const end = n + 1 < starts.length ? starts[n + 1].index : boxes.length;
    const list = boxes.slice(s.index, end);
    const start = list[0].start;
    const finish = n + 1 < starts.length ? boxes[end].start : timeline.duration;
    const file = `${String(n).padStart(2, '0')}-${slug(s.name)}`;
    const frames = Math.round(finish / 1000 * VIDEO.fps) - Math.round(start / 1000 * VIDEO.fps);
    const mp4 = path.join(SECTIONS, file + '.mp4');
    return {
        n, name: s.name, file, start, length: finish - start, frames,
        boxes: list.length, words: list.reduce((w, b) => w + words(b.text), 0),
        first: boxTime(list[0]), last: boxTime(list[list.length - 1]),
        size: fs.existsSync(mp4) ? fs.statSync(mp4).size : null,
    };
});

/* render times per section, from the render log ("done 23-perspective.mp4 (0:41:23 in 1:52:10)") */
const log = path.join(OUTPUT, 'render-new.log');
const renderTimes = {};
let renderStarted = null, renderFinished = null;
if (fs.existsSync(log)) {
    for (const m of fs.readFileSync(log, 'utf8').matchAll(/^done (\S+)\.mp4 \(\S+ in (\d+):(\d+):(\d+)\)/gm)) {
        renderTimes[m[1]] = ((+m[2] * 60 + +m[3]) * 60 + +m[4]) * 1000;
    }
    const st = fs.statSync(log);
    renderStarted = st.birthtimeMs || null;
    renderFinished = st.mtimeMs;
}
sections.forEach(s => s.renderTime = renderTimes[s.file] || null);

/* ---------- overall figures ---------- */
const totalWords = boxes.reduce((w, b) => w + words(b.text), 0);
const totalChars = boxes.reduce((c, b) => c + [...b.text].length, 0);
const glyphs = boxes.reduce((c, b) => c + [...b.text].filter(ch => ch !== ' ').length, 0);
const lines = boxes.reduce((c, b) => c + lineCount(b), 0);
const slowest = boxes.reduce((a, b) => boxTime(b) > boxTime(a) ? b : a);
const longest = boxes.reduce((a, b) => words(b.text) > words(a.text) ? b : a);
/* when half of the words have been shown */
let seen = 0, halfway = 0;
for (const b of boxes) {
    seen += words(b.text);
    if (seen >= totalWords / 2) { halfway = b.start; break; }
}
const firstBox = boxes[0], lastBox = boxes[boxes.length - 1];
const perMinute = ms => (60000 / ms).toFixed(ms > 6000 ? 1 : 0).replace(/\.0$/, '');
const tate = path.join(REPO, 'tate version');
const originalBytes = fs.readdirSync(tate).filter(f => /\.(svg|es)$/.test(f)).reduce((n, f) => n + fs.statSync(path.join(tate, f)).size, 0);
const fullPath = path.join(OUTPUT, FULL);
const fullSize = fs.existsSync(fullPath) ? fs.statSync(fullPath).size : null;
const totalFrames = Math.round(timeline.duration / 1000 * VIDEO.fps);
const jobTime = Object.values(renderTimes).reduce((a, b) => a + b, 0);
const wallTime = renderStarted ? renderFinished - renderStarted : null;
const renderDate = renderFinished ? new Date(renderFinished).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
const version = cmd => { try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch (e) { return ''; } };
const chrome = (version('google-chrome --version').match(/[\d.]+/) || [''])[0].split('.')[0];
const ffmpeg = (version('ffmpeg -version').match(/ffmpeg version ([\d.]+)/) || [, ''])[1];
const cpu = os.cpus()[0] ? os.cpus()[0].model.trim() : '';

/* ---------- the page ---------- */
const row = (label, value) => value === null || value === '' ? '' : `<div><dt>${label}</dt><dd>${value}</dd></div>`;
const info = `
<section aria-labelledby="info-piece">
<h2 id="info-piece">The piece</h2>
<dl>
${row('Running time', `${duration(timeline.duration)} (${hms(timeline.duration)}), looped`)}
${row('Text boxes', num(boxes.length))}
${row('Sections', `${num(sections.length - 1)}, plus an introduction`)}
${row('Words', num(totalWords))}
${row('Characters', num(totalChars))}
${row('Lines of text', num(lines))}
${row('Letters drawn', num(glyphs))}
${row('Longest box', `${num(words(longest.text))} words, ${lineCount(longest)} lines`)}
${row('Halfway through the text', `at ${hms(halfway)}: half the words come in the last ${Math.round((1 - halfway / timeline.duration) * 100)}% of the running time`)}
</dl>
</section>
<section aria-labelledby="info-speed">
<h2 id="info-speed">Speed</h2>
<dl>
${row('First box', `${seconds(firstBox.in)} in, ${seconds(firstBox.out)} out (${perMinute(boxTime(firstBox))} a minute)`)}
${row('Slowest box', `${seconds(slowest.in)} in, ${seconds(slowest.out)} out (&ldquo;${esc(title(slowest.text))}&rdquo;)`)}
${row('Last box', `${seconds(lastBox.in)} in, ${seconds(lastBox.out)} out (${perMinute(boxTime(lastBox))} a minute)`)}
${row('Zoom in', 'font size 0 to 1em, moving 50px down to rest')}
${row('Zoom out', 'font size 1em to 20em, moving 950px down; section headings move 1300px up')}
${row('Easing', 'SMIL <code>keySplines</code>, two presets: one for text, one for headings')}
${row('Font', `"pm", Arial converted to an SVG font; ${font.glyphs ? Object.keys(font.glyphs).length : ''} of its 237 glyphs are used`)}
${row('Text sizes', '1.1, 1.2 and 1.3em (13.2 to 15.6px at rest), justified to 420px &times; size')}
</dl>
</section>
<section aria-labelledby="info-original">
<h2 id="info-original">The original</h2>
<dl>
${row('Shown at', 'Tate Modern, London, where it looped for 11 months, then the Power Plant, Toronto')}
${row('Projection', '25&prime; &times; 15&prime;, from a 1024 &times; 768 composition')}
${row('Format', 'SVG with SMIL animation and ECMAScript, in Adobe SVG Viewer 3')}
${row('Files', `8 SVG files and a script, ${(originalBytes / 1e6).toFixed(1)} MB; each file loaded the next`)}
${row('Made with', 'a PHP and MySQL tool which turned the artist&rsquo;s text into SVG')}
${row('Computer', '2.8GHz Xeon, 1GB RAM')}
</dl>
</section>
<section aria-labelledby="info-video">
<h2 id="info-video">The videos</h2>
<dl>
${row('Resolution', `${VIDEO.width} &times; ${VIDEO.height} (${VIDEO.aspect}, cropped from the 4:3 composition)`)}
${row('Frame rate', `${VIDEO.fps} frames a second`)}
${row('Frames', num(totalFrames))}
${row('Video', VIDEO.codec)}
${row('Full version', fullSize ? `${bytes(fullSize)}, ${Math.round(fullSize * 8 / (timeline.duration / 1000) / 1000)} kbit/s on average` : null)}
${row('Rendered', renderDate ? `${renderDate}, in ${duration(wallTime)} with 5 parallel jobs (${duration(jobTime)} of rendering in all)` : null)}
${row('Render speed', wallTime ? `${Math.round(totalFrames / (wallTime / 1000))} frames a second overall` : null)}
${row('Rendered with', `headless Chrome ${chrome}, ffmpeg ${ffmpeg}, Node.js ${process.versions.node.split('.')[0]}${cpu ? ', on an ' + cpu : ''}`)}
</dl>
</section>`;

const video = (file, name, poster, caption, big) => `
<figure class="video${big ? ' video-full' : ''}">
<video controls preload="none" poster="${MEDIA}${poster}" width="${VIDEO.width}" height="${VIDEO.height}" aria-label="${esc(name)}">
<source src="${MEDIA}${file}" type="video/mp4">
</video>
<figcaption>${caption}</figcaption>
</figure>`;

const sectionVideos = sections.map(s => video(`${s.file}.mp4`, `The Story of Art: ${title(s.name)}`, `${s.file}.png`, `
<h3><span class="n">${s.n || ''}</span> ${esc(s.n ? title(s.name) : 'Introduction')}</h3>
<p>From ${hms(s.start)} &middot; ${duration(s.length)} &middot; ${num(s.boxes)} boxes &middot; ${num(s.words)} words</p>
<p>${s.first === s.last ? seconds(s.first) : seconds(s.first) + ' to ' + seconds(s.last)} a box &middot; ${num(s.frames)} frames${s.size ? ' &middot; ' + bytes(s.size) : ''}${s.renderTime ? ' &middot; rendered in ' + duration(s.renderTime) : ''}</p>`)).join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Story of Art &ndash; Emma Kay</title>
<meta name="description" content="The Story of Art, an animated text projection by Emma Kay, made with e-2 and shown at Tate Modern. ${num(totalWords)} words written from memory, over ${duration(timeline.duration)}.">
<style>
:root {
    --text: #000;
    --muted: #555;
    --line: #ddd;
    --panel: #f4f4f4;
    --link: #000;
    color-scheme: light;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
    margin: 0;
    background: #fff;
    color: var(--text);
    font: 16px/1.5 Arial, "Liberation Sans", Arimo, Helvetica, sans-serif;
}
a { color: var(--link); }
a:focus-visible, button:focus-visible, video:focus-visible { outline: 2px solid #000; outline-offset: 3px; }
.page { max-width: 1280px; margin: 0 auto; padding: 0 16px; }
header { padding: 64px 0 32px; }
h1 { font-size: clamp(2rem, 6vw, 3.5rem); line-height: 1.1; margin: 0 0 8px; font-weight: normal; letter-spacing: -0.01em; }
.byline { margin: 0; color: var(--muted); font-size: 1.125rem; }
.intro { max-width: 46em; }
.intro p { margin: 0 0 1em; }
@media (min-width: 600px) {
    .intro p { text-align: justify; hyphens: auto; }
}
.play {
    display: inline-block;
    margin: 8px 0 0;
    padding: 12px 20px;
    border: 1px solid #000;
    color: #000;
    text-decoration: none;
    font-size: 1.125rem;
}
.play:hover { background: #000; color: #fff; }
.play-note { color: var(--muted); font-size: 0.875rem; margin: 8px 0 0; }
main {
    padding: 48px 0 16px;
    border-top: 1px solid var(--line);
    margin-top: 48px;
}
/* the information, below the videos: its groups side by side, stacking on narrow screens */
aside {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: 24px 32px;
    background: var(--panel);
    padding: 20px;
    margin: 0 0 48px;
    font-size: 0.875rem;
}
aside h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 8px; color: var(--muted); font-weight: bold; }
aside dl { margin: 0; }
aside dl div { display: grid; grid-template-columns: 9em 1fr; gap: 8px; padding: 4px 0; border-top: 1px solid var(--line); }
aside dt { color: var(--muted); }
aside dd { margin: 0; font-variant-numeric: tabular-nums; }
main h2 { font-size: 1.5rem; font-weight: normal; margin: 0 0 16px; }
.video { margin: 0 0 32px; }
.video video { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; background: #fff; border: 1px solid var(--line); }
.video figcaption { padding-top: 8px; font-size: 0.875rem; color: var(--muted); }
.video figcaption p { margin: 0; font-variant-numeric: tabular-nums; }
.video h3 { font-size: 1rem; color: var(--text); margin: 0 0 2px; font-weight: bold; }
.video h3 .n { display: inline-block; min-width: 1.75em; color: var(--muted); font-weight: normal; }
.video-full { margin-bottom: 48px; }
.video-full figcaption { font-size: 1rem; }
.sections { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr)); gap: 0 24px; }
footer { border-top: 1px solid var(--line); padding: 24px 0 48px; color: var(--muted); font-size: 0.875rem; }
@media (max-width: 480px) {
    header { padding-top: 40px; }
    aside dl div { grid-template-columns: 1fr; gap: 0; }
}
</style>
</head>
<body>
<div class="page">
<header>
<h1>The Story of Art</h1>
<p class="byline">Emma Kay, made with e-2</p>
</header>
<div class="intro">
<p>Emma Kay&rsquo;s work reconstructs epic histories, geographies and fictions entirely from memory. <em>The Story of Art</em> is her history of art, from the first marks made by humans to the end of the twentieth century, written from memory in ${num(totalWords)} words.</p>
<p>It is an animated wall projection. Sentences, wrapped into short justified paragraphs, travel towards the viewer from a point just above the centre of the screen, rest there briefly, then accelerate past, off the bottom of the screen; each section heading leaves by the top. The piece speeds up imperceptibly over ${Math.floor(timeline.duration / 3600000)} and a half hours, from a new paragraph every ${seconds(boxTime(firstBox))} to one every ${seconds(boxTime(lastBox))}, until only the occasional word can be read.</p>
<p>It was projected 25 feet wide at Tate Modern, London, where it looped continuously for 11 months, and then shown at the Power Plant, Toronto. e-2 made it in SVG, so that the artist&rsquo;s text could be edited up to the last minute and the whole piece regenerated in a single step, and so that the text stayed sharp at that scale.</p>
<p>The original ran in Adobe&rsquo;s SVG Viewer, a browser plugin which no longer exists. In 2026 it was redeveloped from the original files to run in a modern browser, drawing the letters with the same embedded font, and rendered to video.</p>
<a class="play" href="player.html">Watch it in your browser</a>
<p class="play-note">The browser version plays the whole piece in real time and loops. Space pauses, the arrow keys skip, F goes fullscreen, and the camera button saves a screenshot.</p>
</div>
<main>
<h2>The full piece</h2>
${video(FULL, 'The Story of Art, full version', `${sections[1].file}.png`, `<p>${duration(timeline.duration)} &middot; ${num(totalFrames)} frames${fullSize ? ' &middot; ' + bytes(fullSize) : ''}</p>`, true)}
<h2>Sections</h2>
<p class="play-note" style="margin:-8px 0 24px">The piece in ${sections.length} parts, split at its section headings.</p>
<div class="sections">
${sectionVideos}
</div>
</main>
<aside aria-label="About the piece and the videos">
${info}
</aside>
<footer>
<p><em>The Story of Art</em> by Emma Kay. Made with e-2. Browser version and videos made from the files shown at Tate Modern.</p>
</footer>
</div>
</body>
</html>
`;
fs.writeFileSync(OUT, html.replace(/\n{3,}/g, '\n\n'));
console.log(`wrote ${path.relative(REPO, OUT)}: ${sections.length} section videos, ${num(totalWords)} words, ${num(lines)} lines`);
