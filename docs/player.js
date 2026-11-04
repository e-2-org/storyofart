/**
 * The Story of Art player
 *
 * Renders any moment of the piece from the timeline (timeline.json, made by
 * scripts/extract-timeline.js). Only one text box is ever in the document,
 * so memory use stays flat however long the piece runs.
 *
 * The text layout is a port of TextSpline (soa_multiples.es) and the motion
 * reproduces the SMIL animation from the original files:
 *  - zoom in:  font-size 0em -> 1em, moving from 50px above to the rest position
 *  - zoom out: font-size 1em -> 20em, moving 950px down (headings move up)
 * each eased with the original keySplines.
 *
 * As in the original, the text is drawn with the glyphs of the embedded SVG
 * font ("pm", which is Arial) as paths. Browser text is hinted to whole
 * pixels, so it steps visibly as its size changes; paths scale smoothly.
 * Everything in a text box is measured in ems from one anchor point, so the
 * original font-size animation is the same as scaling the box about that point.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
/* the Adobe SVG Viewer's default font size, which the original layout assumed */
const BASE_FONT_SIZE = 12;
/* TextSpline line width, multiplied by the font size */
const DEFAULT_WIDTH = 420;

class StoryOfArt {
    constructor(svg, timeline) {
        this.timeline = timeline;
        this.boxes = timeline.boxes;
        this.screen = timeline.screen;
        this.font = timeline.font;
        this.easings = timeline.splines.map(set => set.map(s => cubicBezier(...s)));
        this.defineGlyphs(svg);
        this.group = document.createElementNS(SVG_NS, 'g');
        this.box = document.createElementNS(SVG_NS, 'g');
        this.group.appendChild(this.box);
        svg.appendChild(this.group);
        this.current = null;
    }

    get duration() {
        return this.timeline.duration;
    }

    /* each glyph is defined once, and used for every occurrence of its character */
    defineGlyphs(svg) {
        const defs = document.createElementNS(SVG_NS, 'defs');
        this.glyphIds = {};
        Object.entries(this.font.glyphs).forEach(([ch, [, d]], i) => {
            if (!d) return;
            const path = document.createElementNS(SVG_NS, 'path');
            path.id = 'soa-glyph-' + i;
            path.setAttribute('d', d);
            defs.appendChild(path);
            this.glyphIds[ch] = path.id;
        });
        svg.appendChild(defs);
    }

    /* width of a string in font units */
    advance(str) {
        let width = 0;
        for (const ch of str) {
            width += this.font.glyphs[ch] ? this.font.glyphs[ch][0] : this.font.missing;
        }
        return width;
    }

    /* the box on screen at time t (ms), or null between boxes */
    boxAt(t) {
        let lo = 0;
        let hi = this.boxes.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const box = this.boxes[mid];
            if (t < box.start) {
                hi = mid - 1;
            } else if (t >= box.start + box.in + (box.pause || 0) + box.out) {
                lo = mid + 1;
            } else {
                return box;
            }
        }
        return null;
    }

    /* render the piece at time t (ms) - the piece loops */
    renderAt(t) {
        t = ((t % this.duration) + this.duration) % this.duration;
        const box = this.boxAt(t);
        if (!box) {
            this.group.setAttribute('visibility', 'hidden');
            return;
        }
        if (box !== this.current) {
            this.layout(box);
            this.current = box;
        }
        const [scaleIn, moveIn, scaleOut, moveOut] = this.easings[box.splines];
        const local = t - box.start;
        const pause = box.pause || 0;
        let em;
        let y;
        if (local < box.in) {
            const p = local / box.in;
            em = scaleIn(p);
            y = -50 + 50 * moveIn(p);
        } else if (local < box.in + pause) {
            em = 1;
            y = 0;
        } else {
            const p = (local - box.in - pause) / box.out;
            em = 1 + 19 * scaleOut(p);
            y = box.exit * moveOut(p);
        }
        this.group.setAttribute('visibility', 'visible');
        /* the motion path, then the font-size animation as a scale about the box's anchor */
        this.group.setAttribute('transform', 'translate(' + this.origin.x + ' ' + (this.origin.y + y) + ') scale(' + em + ')');
    }

    /**
     * Port of TextSpline._splitString and TextSpline._layout: words are
     * wrapped by measuring the text, then each line is justified by widening
     * the spaces, and the last line is aligned left. Measurements use the
     * font's advance widths, as the Adobe viewer did with the SVG font
     */
    layout(box) {
        const size = box.size;
        const width = size * DEFAULT_WIDTH;
        /* font size in user units at 1em, and font units to user units */
        const em = size * BASE_FONT_SIZE;
        const scale = em / this.font.unitsPerEm;
        const measure = words => this.advance(words.join(' ')) * scale;

        const words = box.text.split(' ');
        const lines = [];
        let line = [];
        let length = 0;
        let prevLength = 0;
        while (words.length) {
            const word = words[0];
            length = measure(line.concat(word));
            if ((length > width && line.length) || word === '_br_') {
                lines.push({ width: prevLength, words: line });
                line = [];
                if (word === '_br_') {
                    words.shift();
                }
            } else {
                line.push(words.shift());
            }
            prevLength = length;
            if (!words.length) {
                lines.push({ width: length, words: line });
            }
        }

        /* the anchor: lines are centred on x, and the first baseline is one line below y */
        let y = (this.screen.height / 2) - (lines.length * em);
        if (lines.length === 1) {
            y -= size * box.interval * BASE_FONT_SIZE;
        }
        this.origin = { x: this.screen.width / 2, y };

        const fragment = document.createDocumentFragment();
        lines.forEach((ln, i) => {
            const last = i + 1 === lines.length;
            /* extra width for each space, in font units: justified lines fill the width */
            const extra = !last && ln.words.length > 1 ? (width - ln.width) / (ln.words.length - 1) / scale : 0;
            /* justified lines span the width; the last line starts at the same place (less 1, as
               in the original); a single line is centred */
            let left = -width / 2;
            if (last) {
                left = i === 0 ? -ln.width / 2 : -width / 2 - 1;
            }
            const g = document.createElementNS(SVG_NS, 'g');
            g.setAttribute('transform', 'translate(' + left + ' ' + ((i + 1) * box.interval * em) + ') scale(' + scale + ' ' + -scale + ')');
            let x = 0;
            for (const ch of ln.words.join(' ')) {
                if (this.glyphIds[ch]) {
                    const use = document.createElementNS(SVG_NS, 'use');
                    use.setAttribute('href', '#' + this.glyphIds[ch]);
                    use.setAttribute('x', x);
                    g.appendChild(use);
                }
                x += this.font.glyphs[ch] ? this.font.glyphs[ch][0] : this.font.missing;
                if (ch === ' ') {
                    x += extra;
                }
            }
            fragment.appendChild(g);
        });
        this.box.replaceChildren(fragment);
        this.box.setAttribute('aria-label', box.text);
    }
}

/**
 * Cubic bezier easing, as used by SMIL keySplines (and CSS cubic-bezier)
 */
function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sampleX = s => ((ax * s + bx) * s + cx) * s;
    const sampleY = s => ((ay * s + by) * s + cy) * s;
    const slopeX = s => (3 * ax * s + 2 * bx) * s + cx;
    return function (x) {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        /* Newton's method, falling back to bisection */
        let s = x;
        for (let i = 0; i < 8; i++) {
            const err = sampleX(s) - x;
            if (Math.abs(err) < 1e-6) return sampleY(s);
            const d = slopeX(s);
            if (Math.abs(d) < 1e-6) break;
            s -= err / d;
        }
        let lo = 0, hi = 1;
        s = x;
        while (hi - lo > 1e-7) {
            if (sampleX(s) < x) lo = s; else hi = s;
            s = (lo + hi) / 2;
        }
        return sampleY(s);
    };
}
