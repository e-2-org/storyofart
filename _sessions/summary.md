# The Story of Art redevelopment: session summary

2 to 4 October 2026, working with Claude Code on the `develop` branch, with 4K versions rendered on 3 and 4 November 2026 (see [4K versions](#4k-versions-november-2026)). The full conversation is in [transcript.md](transcript.md).

## Why the original no longer runs

The piece was built for the Adobe SVG Viewer 3. In a modern browser it fails in three ways:

1. **Parsing.** The files use `xlink:href` without declaring the namespace, so browsers reject them.
2. **Layout.** The `TextSpline` script reads invalid CSS from `style` attributes (a unitless `font-size` and the made-up `line-interval`), which browsers now discard, so every position comes out as `NaN`.
3. **Font.** The text was set in an embedded SVG font, which only Safari still supports.

## Findings about the archive

**The Tate version is the final text.** `tate version/` (8 files) matches `text/final_exported.txt` and the Toronto samples exactly. `files/` (102 files) is a different edit, probably earlier.

| Set | Text boxes | Running time |
|---|---|---|
| `tate version/` soa1 to soa8 | 5,812 | 9h 30m |
| `files/` | 6,355 | 9h 49m (the README's "9 hours 45 minutes") |

As archived, `soa7.svg` loops back to `soa1` and never reaches `soa8`. This was corrected in place at the Tate.

**How the texts differ.** Up to about 1980 both versions follow the same 69 sections, but the Tate text often combines sentences into longer paragraphs. After 1980:

- **Tate:** one 2,847-box alphabetical run of artists under a single PAINTING heading. This matches the artist's source files (`6_SOFA.1980+ chron 90s a-l` / `m-z`) and ends with "The kitchen is fully functional if minimal."
- **`files/`:** about 20 thematic sections instead (WAR ARTISTS, NEO GEO and so on), with about 530 sentences not in the Tate text.

**Why the timing differs.** In the PHP generator (`generator/controls.php`), each section had a start and finish speed in sentences per minute, and box durations were interpolated linearly between them. So the timing depends on how many boxes each section has. Both versions start slowly (the exit phase of the first heading takes 55 seconds) and accelerate; the Tate version has fewer boxes and ends at 0.3s per phase, against 0.25s in `files/`.

**The "pm" font is Arial.** It has Arial's PANOSE number (`2 11 6 4 2 2 2 2 2 4`), metrics (2048 units per em, ascent 1854, descent -434) and glyph widths. It was probably converted with Batik, which is in `generator/includes`. The same font is embedded in all eight files, with no kerning, and covers every character the text uses.

**Colour.** The original set no colours, so it showed black text on the viewer's default white background.

## What was built (`redux/`)

**Timeline extractor** (`scripts/extract-timeline.js`). Reads the Tate files in Tate order and writes `timeline.json`: each box's text, size, line spacing, the durations of its two phases and their easing, plus the 83 glyphs of the "pm" font that the text uses. There are only two easing presets, one for body text and one for headings, and no pauses or fades.

**Player** (`player.js`, `index.html`). A port of `TextSpline` plus the SMIL motion:

- zoom in: font size 0em to 1em, moving 50px down to rest;
- zoom out: font size 1em to 20em, moving 950px down (headings move up 1300px);
- each eased with the original `keySplines`.

Only one text box exists in the page at a time, so memory stays flat over 9.5 hours. Options and controls:

- `?t=2h15m` jumps to a point, and `?debug` shows the time.
- `?aspect=5:3` or `?aspect=16:9` masks the top and bottom of the composition.
- Space pauses; the arrow keys skip 10 seconds, or 60 with shift.
- F, or a button at the top right, toggles fullscreen.
- A camera button under it saves a screenshot, with a shutter sound and a flash: a PNG at twice the composition's resolution (2048x1536, or the `?aspect` shape), named after the moment in the piece. Because the projection is a single SVG drawn with paths, the browser draws it onto a canvas itself; no library is needed.
- The buttons and the mouse pointer hide after 3 seconds without mouse movement.
- The piece loops.

### Smooth scaling: the letters drawn as paths

The first version of the player used browser text, and its animation was not as smooth as the original: browser text is hinted to whole pixels, so as the font size changes, letters and spaces jump a pixel at a time. This is the problem the original solved by using an SVG font. The player now does the same: it draws each letter with the original font's glyph outlines, as paths (`<use>` of glyphs defined once), and lays the text out with the font's advance widths, as Adobe's viewer did. The font-size animation became a scale transform about each box's anchor point, which is equivalent because everything in a box is measured in ems.

Measured on the first sentence zooming in, at 40 moments 10ms apart: browser text stayed frozen for 8 of 39 frame steps and then jumped; the paths changed in every frame. The layout (line breaks, justification) is unchanged, and the player no longer depends on any font being installed.

### Fidelity decisions

- 1em is 12px, the Adobe viewer's default, which the layout code assumed throughout.
- `TextSpline` doubled the offset used to left-align a paragraph's last line. The Adobe viewer must have halved it; Chrome applies it in full, which pushed the last line about 180px too far left. The player puts the last line where it was intended: aligned with the justified lines (less 1px, as in the original).
- The eight files play as one continuous sequence, without the original's gaps for loading.

### Video

**Capture** (`scripts/capture.js`). Renders exact frames in headless Chrome via `player.renderAt()` and pipes them to ffmpeg. It has `--fps`, `--width`, `--aspect`, `--frames` and `--stills` options.

**Section rendering** (`scripts/render-sections.js`). Renders one video per section, split at the 71 headings plus a 90-second introduction (72 sections).

- Sections render in parallel, longest first.
- All sections use one frame grid, so they join exactly.
- Each section is written to a `.partial` file and renamed when finished, so a stopped render can be restarted.
- `--posters` renders a still per section, taken as the heading grows to three times its resting size on its way out (`--poster-scale` changes this). The introduction's first sentence is capped at twice its size so that it fits.

## Output

The projection was masked at the Tate. The video is rendered at 16:9 (1920x1080, 30fps, H.264 CRF 18), which crops 96 units from the top and bottom of the 1024x768 composition; even the tallest paragraph fits.

The videos were re-rendered on 3 October with the letters drawn as paths:

- The full piece, `redux/output/story-of-art.mp4`: 9h 30m 14s, 1,026,433 frames, 3.89GB.
- 72 section videos and 72 poster images, in `redux/output/sections/`, indexed in `sections.json`.
- The render took 3h 58m with 5 jobs on an AMD Ryzen 5 5500 (19h 51m of job time, 72 frames a second overall).
- The earlier renders, made with browser text, are kept in `redux/output/old-text-rendering/` (6.2GB) for comparison, and can be deleted.

`redux/output/` is gitignored, so the videos aren't in the repository.

## GitHub Pages site

`index.html` at the repository root (with `.nojekyll`) introduces the work, links to the browser version in `redux/`, and lists the videos, served from `https://media.bjorsq.net/soa/`: the full piece, then the 72 sections, each with a caption giving its start time, length, boxes, words, speed per box, frames, file size and render time. An information box at the bottom of the page gives the figures for the piece, its speed, the original, and the videos.

The page is generated by `redux/scripts/build-site.js` from `timeline.json` and the render outputs, so it should be rebuilt after a re-render. `MEDIA=redux/output/sections/ node redux/scripts/build-site.js` builds a local preview using the local posters.

Some figures from the page: 108,812 words in 5,812 boxes and 11,326 lines; the first box takes 10s, the last 0.6s (6 a minute, rising to 100 a minute); half the words come in the last 17% of the running time.

## 4K versions (November 2026)

4K versions of the full piece were made for Emma Kay, in case she wants them for a large-scale projection. Only the full piece was needed, not the sections. This was done in a Claude Code session that also worked on other e-2 projects, including The Future from Memory, which was rendered at 4K alongside it.

**Files**, outside the repository in `/mnt/scratch/4k/`:

| File | Picture | Size |
|---|---|---|
| `story-of-art_3840x2160_uhd.mp4` | 3840×2160 (UHD) | 7.9 GB |
| `story-of-art_4096x2160_dci.mp4` | 4096×2160 (DCI 4K) | 7.6 GB |

Both are H.264 (CRF 18), 30 frames a second, 1,026,433 frames, 9h 30m 14s, the same frames as the HD version.

**How they were made**

- The composition was rendered once at 4096×2304 (16:9) and encoded twice from the same frames:
  - UHD scales it down (`scale=3840:2160:flags=lanczos`);
  - DCI crops 72 pixels from the top and bottom (`crop=4096:2160:0:72`). Every box was measured at its resting position in the player first, to check that the text stays inside the cropped band.
- The 72 sections were rendered with `render-sections.js`, then joined without re-encoding.
- The render was driven by a script, `/mnt/scratch/4k/run-4k.sh`, run as a systemd user service with a memory cap:
  `systemd-run --user --unit=render-4k -p MemoryMax=20G -p MemorySwapMax=0 /mnt/scratch/4k/run-4k.sh`
- It took 21h 33m with 3 jobs on the AMD Ryzen 5 5500 (18:12 on 3 November to 15:45 on 4 November).

**Changes to the scripts**

- `capture.js`:
  - `--vf` applies an ffmpeg filter to the video.
  - `--also FILE` writes a second video from the same frames, with its own filter (`--also-vf`).
  - `--threads` limits each x264 encoder's threads, which also limits its memory.
  - It now loads `player.html`, not `index.html`: the capture had been broken since the player was moved to `player.html`.
- `render-sections.js` passes these through. `--also DIR` writes the second version of each section to its own folder, and renames it from `.partial` with the first.

**Problems along the way**

- The first attempt ran 5 jobs with no memory limit. At 4K each x264 encoder used several GB, and the machine ran out of memory and crashed. With `--threads 3` each job uses about 6 GB, and 3 jobs fit inside the 20 GB cap. The service's memory peak was 20 GB, so 2 jobs would leave more headroom next time.
- The first run under systemd failed at once, because `node` comes from nvm and wasn't on the service's `PATH`. The script now adds it.

## Commits on `develop`

- `5c35fc2` Added redux: timeline extractor, browser player and video capture for the Tate version
- `7046b94` Added section rendering and aspect ratio options to redux
- `5aaafaa` Added poster images for each section to render-sections
- `84e380b` Posters taken as section headings grow on their way out
- `700e302` Draw text with the original font's glyphs as paths so it scales smoothly; added fullscreen control
- `ce20d52` Added GitHub Pages index page with videos and figures, and a screenshot button in the browser version
- (November 2026) Added `--vf`, `--also` and `--threads` to the capture scripts for the 4K versions, and pointed the capture at `player.html`

## Still to do

- ~~Upload the videos and posters to `media.bjorsq.net/soa/`~~ and ~~publish the site with GitHub Pages~~: both done by November 2026. The site is at `e-2-org.github.io/storyofart/`, and the repository has moved to the `e-2-org` organisation.
- The 4K files in `/mnt/scratch/4k/` aren't uploaded anywhere yet.
- The browser player hasn't been checked in Firefox or Safari.
- Decompiling SWF files was discussed and left for another day. The likely tools are JPEXS Free Flash Decompiler (to extract ActionScript and export shapes and frames) and Ruffle (to play SWFs in a modern browser).
