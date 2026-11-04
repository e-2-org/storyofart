The Story of Art - redux
========================

A redevelopment of _The Story of Art_ (Emma Kay, with e-2) for modern browsers, and for rendering to video.

This folder holds the tools: the scripts, and the videos they render (`output/`, not in the repository). The site they make is in `../docs/`: the browser version (`player.html`, `player.js` and `timeline.json`) and the page that introduces the work and lists the videos (`index.html`, written by `scripts/build-site.js`).

The original ran in the Adobe SVG Viewer 3. It no longer runs in modern browsers: the files use an undeclared `xlink` namespace (so they don't parse), the layout script reads invalid CSS from `style` attributes (which browsers now discard), and the text was set in an embedded SVG font (only Safari supports these).

How it works
------------

`scripts/extract-timeline.js` reads the Tate version (`../tate version/soa1.svg` to `soa8.svg`, in the order they were played at the Tate) and writes `../docs/timeline.json`: the text, font size and line spacing of each of the 5,812 text boxes, and the durations and easing of its animation. The piece runs for 9h 30m.

`player.js` renders any moment of the piece from the timeline. Only one text box is in the document at a time, so it can run indefinitely without using more memory. The text layout is a port of `TextSpline` from `soa_multiples.es`, and the motion reproduces the SMIL animation:

* zoom in: font size 0em to 1em, moving down 50px to the rest position
* zoom out: font size 1em to 20em, moving 950px down (section headings move up by font size x 1000px)

each eased with the original `keySplines`.

```
npm install
npm run timeline      # regenerate ../docs/timeline.json
```

### Playing in a browser

The player is in `../docs/`, the site GitHub Pages publishes. Serve that folder (e.g. `npx http-server ../docs`) and open `player.html`.

* `?t=2h15m` starts at that point (or plain seconds)
* `?debug` shows the time
* space pauses, left and right arrows skip 10 seconds (60 with shift)
* f, or the button at the top right, toggles fullscreen
* the camera button under it saves a screenshot, with a shutter sound and a flash: a PNG at twice the composition's resolution (2048x1536, or the shape set by `?aspect`), named after the moment in the piece, e.g. `story-of-art-02h46m35s.png`
* the buttons and the mouse pointer appear when the mouse moves, and hide again after 3 seconds

The piece loops, as it did at the Tate.

### Rendering video

`scripts/capture.js` opens the player in headless Chrome, renders each frame at an exact time and pipes it to ffmpeg, so rendering doesn't need to keep up with real time.

```
node scripts/capture.js --from 0 --to 30 --out output/test.mp4
node scripts/capture.js --from 1h --to 2h --fps 50 --width 2048 --out output/part2.mp4
node scripts/capture.js --stills 5,9258.05 --out output/stills
```

Defaults are 30fps at 1440x1080 (4:3, the composition's own shape). `--aspect` crops the top and bottom of the composition to another shape: the projection was masked at the Tate, so `--aspect 5:3` matches its 25' x 15' screen, and `--aspect 16:9` (with `--width 1920`) gives HD video. Even the tallest paragraph fits well inside a 16:9 crop.

### Rendering the whole piece in sections

`scripts/render-sections.js` renders the piece as one file per section, split at the section headings (72 sections, including the introduction before the first heading), in parallel:

```
node scripts/render-sections.js --list
node scripts/render-sections.js --width 1920 --aspect 16:9 --jobs 5
node scripts/render-sections.js --only 23,71        # just these sections
```

Files go to `output/sections/`, e.g. `23-perspective.mp4`. Each section is rendered to a `.partial.mp4` file and renamed when it's finished, so the render can be stopped and restarted without losing finished sections. Sections share one frame grid, so they join exactly; once all are done, `output/sections/concat.txt` joins them without re-encoding:

```
ffmpeg -f concat -safe 0 -i output/sections/concat.txt -c copy output/story-of-art.mp4
```

`--posters` renders a still for each section instead (e.g. `23-perspective.png`, to use as the video's poster image). It's taken as the heading leaves the screen, at the moment it has grown to three times its resting size, which reads better as a thumbnail than the heading at rest. `--poster-scale` changes this (`--poster-scale 1` is the heading at rest in the centre). The introduction uses its first sentence, at no more than twice its resting size so that it fits. Use the same `--width` and `--aspect` as the videos.

```
node scripts/render-sections.js --posters --width 1920 --aspect 16:9
```

At 1920x1080 each job renders about 16 frames per second, so the piece (about 1 million frames at 30fps) takes about 17.5 job-hours. The longest section, PAINTING (1h35m), takes about 3 hours on its own, so more than 5 or 6 jobs won't make the render much quicker.

Notes on fidelity
-----------------

* **Font**: the embedded "pm" font has Arial's PANOSE number, metrics and glyph widths: it's Arial converted to an SVG font. The extractor copies its glyphs into `timeline.json`, and the player draws each letter as a path, laying the text out with the font's advance widths, as the Adobe viewer did. This is what made the original scale smoothly: browser text is hinted to whole pixels, so as its size changes, letters and spaces jump a pixel at a time. (In a test of the zoom in, browser text stayed frozen for 8 of 39 frame steps and then jumped; the paths changed in every frame.) The font-size animation becomes a scale transform about each box's anchor point, which is equivalent because everything in a box is measured in ems.
* **Colour**: the original set no colours, so it was black text on the viewer's default white background.
* **Font size**: the layout assumed 1em = 12px (the Adobe viewer's default), so the player sets that explicitly.
* **Last line of a paragraph**: `TextSpline` doubled the offset used to left-align the last line, which must have been halved by the Adobe viewer. The player places the last line where it was intended to go, aligned with the left edge of the justified lines (less 1px, as in the original).
* **Joins between files**: the original loaded the next file when a file's last box finished. The player treats the eight files as one continuous sequence, so there are no gaps for loading.
