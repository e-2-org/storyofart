/**
 * Extracts The Story of Art timeline from the Tate version SVG files
 *
 * Each text box in the original files is a <g> containing the text (in a
 * <text:soa> element, laid out by soa_multiples.es) and six SMIL elements:
 *
 *  - showIt:  visible when the previous box is hidden
 *  - scale1 / path1: zoom in, font-size 0em -> 1em while moving 50px down
 *  - scale2 / path2: zoom out, font-size 1em -> 20em while moving 950px
 *    down (section headings move up, by font-size * 1000px)
 *  - hideIt:  hidden at the end of scale2
 *
 * The durations of the zoom in and out are the only things which change
 * from box to box (they were set per section in the PHP generator), so the
 * timeline records those along with the text and its formatting.
 *
 * Output: docs/timeline.json
 *
 * Usage: node scripts/extract-timeline.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../tate version');
const OUT = path.resolve(__dirname, '../../docs/timeline.json');
/* soa7 originally looped back to soa1 - it was corrected to soa8 at the Tate */
const FILES = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `soa${n}.svg`);

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(str) {
    return str
        .replace(/&#x([0-9a-f]+);/gi, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&(\w+);/g, (m, name) => entities[name] ?? m);
}

function attr(str, name) {
    const m = str.match(new RegExp('\\b' + name + '="([^"]*)"'));
    return m ? m[1] : null;
}

/* the original style attribute used invalid CSS (unitless font-size, line-interval) so parse it by hand */
function styleValue(style, name) {
    const m = style.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'));
    return m ? m[1].trim() : null;
}

const warnings = [];
const boxes = [];
let time = 0;

FILES.forEach(file => {
    const svg = fs.readFileSync(path.join(SRC, file), 'latin1');
    for (const m of svg.matchAll(/<g id="textBox_(\d+)"[^>]*>([\s\S]*?)<\/g>/g)) {
        const g = m[2];
        const soa = g.match(/<text:soa([^>]*)>([\s\S]*?)<\/text:soa>/);
        const style = attr(soa[1], 'style');
        const anim = id => {
            const el = g.match(new RegExp('<(?:animate|animateMotion|set)\\b[^>]*id="' + id + '_\\d+"[^>]*>'));
            return el ? el[0] : '';
        };
        const scale1 = anim('scale1');
        const scale2 = anim('scale2');
        const path1 = anim('path1');
        const path2 = anim('path2');
        const showIt = anim('showIt');
        const dur = el => parseFloat(attr(el, 'dur'));
        /* pauses were added to begin times as "+Ns" */
        const offset = el => {
            const b = attr(el, 'begin') || '';
            const p = b.match(/\+([\d.]+)s$/);
            return p ? parseFloat(p[1]) : 0;
        };
        const exit = attr(path2, 'path').match(/L\s*0\s+(-?[\d.]+)/);
        const box = {
            text: decode(soa[2].trim().replace(/\s+/g, ' ')),
            size: parseFloat(styleValue(style, 'font-size')),
            interval: parseFloat(styleValue(style, 'line-interval')),
            heading: parseFloat(exit[1]) < 0,
            exit: parseFloat(exit[1]),
            startPause: offset(showIt),
            zoomIn: dur(scale1),
            readPause: offset(scale2),
            zoomOut: dur(scale2),
            /* keySplines for [scale1, path1, scale2, path2] */
            splines: [scale1, path1, scale2, path2].map(el => attr(el, 'keySplines').split(/[ ,]+/).map(Number)),
        };
        if (dur(path1) !== box.zoomIn || dur(path2) !== box.zoomOut) {
            warnings.push(`${file} box ${m[1]}: motion and scale durations differ`);
        }
        box.start = Math.round((time + box.startPause) * 1000);
        time += box.startPause + box.zoomIn + box.readPause + box.zoomOut;
        box.end = Math.round(time * 1000);
        box.file = file;
        boxes.push(box);
    }
});

/**
 * The font: every file embeds the same SVG font, "pm" (Arial converted to an
 * SVG font). The player draws its glyphs as paths, as the Adobe viewer did -
 * paths scale smoothly, where browser text is hinted to whole pixels and
 * steps as its size changes
 */
function extractFont(svg) {
    const block = svg.match(/<font\b[\s\S]*?<\/font>/)[0];
    const face = block.match(/<font-face([^>]*)>/)[1];
    const glyphs = {};
    for (const g of block.matchAll(/<glyph\b([^>]*?)(?:\/>|>([\s\S]*?)<\/glyph>)/g)) {
        const attrs = g[1];
        const unicode = attr(attrs, 'unicode');
        if (unicode === null) continue;
        const d = attr(attrs, 'd') || ((g[2] || '').match(/\bd="([^"]*)"/) || [])[1] || '';
        glyphs[decode(unicode)] = [parseFloat(attr(attrs, 'horiz-adv-x') || attr(block, 'horiz-adv-x')), d.replace(/\s+/g, ' ').trim()];
    }
    const missing = block.match(/<missing-glyph([^>]*)>/)[1];
    return {
        unitsPerEm: parseFloat(attr(face, 'units-per-em')),
        missing: parseFloat(attr(missing, 'horiz-adv-x')),
        glyphs,
    };
}
const font = extractFont(fs.readFileSync(path.join(SRC, FILES[0]), 'latin1'));
/* only the glyphs the text uses */
const used = new Set(boxes.map(b => b.text).join(''));
font.glyphs = Object.fromEntries(Object.entries(font.glyphs).filter(([ch]) => used.has(ch)));
const unknown = [...used].filter(ch => !font.glyphs[ch]);
if (unknown.length) warnings.push('characters with no glyph: ' + unknown.join(''));

/* the splines and font settings come from a handful of presets, so store them once */
const splineSets = [...new Set(boxes.map(b => JSON.stringify(b.splines)))];
const out = {
    screen: { width: 1024, height: 768 },
    duration: boxes[boxes.length - 1].end,
    splines: splineSets.map(s => JSON.parse(s)),
    font,
    boxes: boxes.map(b => {
        const box = {
            start: b.start,
            in: Math.round(b.zoomIn * 1000),
            out: Math.round(b.zoomOut * 1000),
            text: b.text,
            size: b.size,
            interval: b.interval,
            exit: b.exit,
            splines: splineSets.indexOf(JSON.stringify(b.splines)),
        };
        if (b.readPause) box.pause = Math.round(b.readPause * 1000);
        return box;
    }),
};
fs.writeFileSync(OUT, JSON.stringify(out));

const h = Math.floor(out.duration / 3600000);
const min = Math.round((out.duration % 3600000) / 60000);
console.log(`${boxes.length} boxes, ${h}h ${min}m, ${splineSets.length} spline sets, ${Math.round(fs.statSync(OUT).size / 1024)}KB`);
const pauses = boxes.filter(b => b.startPause || b.readPause).length;
if (pauses) console.log(`${pauses} boxes have pauses`);
[...new Set(warnings)].slice(0, 10).forEach(w => console.warn('  ' + w));
