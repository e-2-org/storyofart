The Story of Art
================

An animated text-based wall projection by Emma Kay.

Emma Kay's practice involves the reconstruction of epic historical, geographical or fictional stories entirely from memory. This often provides a springboard for the viewer's exploration of their own memory and knowledge.

In a previous commission from the Chisenhale Gallery - _The Future from Memory_ - Emma worked with e-2 to produce a projection of animated text, realised using Macromedia Flash and Swift 3D software. During the course of production, it became obvious that editing the piece would be very difficult, as the addition of a small piece of text would necessitate rendering it to a 3D vector file, importing it into Flash, and its insertion within the desired frames of the sequence. One of the key motivations behind using SVG for _The Story of Art_ was that the editing process could be carried out on text files, and the conversion into the finished animation could be performed in a single step. Another was the quality of the text rendition when projected on a large scale. Video was initially discussed as a possibility, but limited resolution, together with costs of editing and re-editing, encouraged us to use SVG.

_The Story of Art_ consists of a series of sentences, wrapped to form short paragraphs, which appear to travel towards the viewer from a vanishing point just above the centre of the screen. The text rests in the centre of the screen briefly, before accelerating past the viewer either to the top or bottom of the viewport. The animation begins slowly, accelerating imperceptibly over the duration of the piece (9 hours, 45 minutes) to reach speeds where only the occasional word is decipherable towards the end.  While in the Tate, the piece looped continuously for 11 months.

SVG proved to be invaluable during the fine-tuning process of determining the speed, acceleration, path and scaling of the text. The animation was carried out using SMIL animation elements, and formatting carried out using ECMAScript. The spline features of SVG were particularly useful in controlling and synchronising the acceleration along the animation path and scaling of the text.

We experienced initial problems in the processing required to format such a large amount of text (over 120,000 words, 7-8Mb), which took over 3 minutes on the hardware purchased for the project (2.8GHz Xeon processor with 1Gb RAM). Also, once the file had loaded into Adobe's SVG Viewer, the processing power required to keep the document in memory (typically 30-35% of the machine's capacity) detracted from the processing power required to perform the animation sequences (which invariably peaked at 100%), resulting in dropped frames at higher speeds. This was solved by splitting the text at logical points into a series of 101 separate files, and daisy-chaining them together using the `getURL()` function.

From our previous experience of working with the artist, we knew that the development of the text would accelerate closer to the launch date, and that last minute editing of the text would inevitably be needed, so it became crucially important to build a tool which could automate the production. A tool was developed using PHP to import text into a MySQL database, manipulate the text and animation parameters, and finally export the text as a series of SVG files.

In February 2004, Dean Jackson was on his first visit to London. Naturally he took the opportunity to visit one of the most popular and successful modern art galleries in the world, Tate Modern. Strolling through the galleries on the fifth floor, he came across _The Story of Art_ - a 25' x 15' projection of animated text by artist Emma Kay - and thought "Cool! You could do that in SVG!"

As Dean said afterwards, "I was really surprised and impressed to find out later that it *had* been done in SVG". It was a nice welcome to London for Dean and a great compliment for e-2, who made the piece with Emma.

_The Story of Art_ was shown in Tate Gallery, London and then  at the PowerPlant gallery at the Harbourfront Centre in Toronto.

Layout
------

The original files are at the top of this repository, unchanged: the Tate version (`tate version/`), the earlier files, the generator, the text and the Toronto samples. `report/` holds a 2004 report listing the files with their length and running times (`report.doc`) and a page about the project (`TheStoryOfArt.html`). This folder was called `docs/` until 2026.

The redevelopment for modern browsers, from 2026, is in two parts:

* `docs/` is the site, published by GitHub Pages from the `main` branch at [e-2-org.github.io/storyofart](https://e-2-org.github.io/storyofart/): the browser version (`player.html`) and a page introducing the work, with videos of the whole piece and each of its sections;
* `redux/` holds the tools that make it, and render it to video (see `redux/README.md`).

Summaries and transcripts of the Claude Code sessions are in `_sessions/`.
