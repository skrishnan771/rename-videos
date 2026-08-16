'use strict';

const { c } = require('./colors');

// ─────────────────────────────────────────────────────────────────────────────
//  HELP TEXT
// ─────────────────────────────────────────────────────────────────────────────

function printHelp() {
  const B = (s) => c.bold(s);
  const G = (s) => c.cyan(s);
  const D = (s) => c.gray(s);

  console.log(`
${c.bold(c.cyan('Intelligent Video File & Folder Renamer'))}  ${c.gray('v7')}

${B('USAGE')}
  rename-videos [options]

${B('OPTIONS')}
  ${G('--path="<dir>"')}    Directory to scan. Defaults to current working directory.
                   Accepts:  --path="./movies"  |  --path ./movies  |  ./movies

  ${G('--force')}           Skip the Y/N confirmation prompt and rename immediately.
                   ${D('Useful for scripting or automated pipelines.')}

  ${G('--undo')}            Reverse the most recent rename run.
                   Reads the rename-log.json from the scanned directory.
                   Combines with --path to undo a run in a specific folder.
                   ${D('The log is deleted after a successful undo.')}

  ${G('--help')}, ${G('-h')}        Show this help text and exit.

  ${D('Any unrecognised option is rejected rather than ignored, so a typo')}
  ${D('can never fall through into an unintended rename run.')}

${B('WHAT GETS RENAMED')}
  ${c.green('✔')} Video files       .mkv .mp4 .avi .mov .wmv .flv .webm .m4v .ts .mpg …
  ${c.green('✔')} Subtitle files    .srt .ass .ssa .sub .vtt .idx  (paired to their video)
  ${c.green('✔')} Folders           Only those containing at least one video file

  ${c.yellow('⚠')} Camera files are ${B('never')} renamed:
      VID_20190624_191055.mp4   IMG_20210101.jpg   20190624_191055.mp4

${B('SKIPPED DIRECTORIES')}
  The scanner automatically prunes subtrees that are clearly not media:

  By exact name:  node_modules  .git  .venv  venv  __pycache__  target
                  .gradle  dist  coverage  .cache  .next  .bundle  vendor …

  By marker file: if a directory contains package.json, Cargo.toml, go.mod,
                  requirements.txt, pyproject.toml, Gemfile, pom.xml, etc.
                  the entire subtree is skipped (catches project roots with
                  non-standard names like "media-server" or "my-project").

  Skipped directories are reported after the scan summary.
  ${D('The root --path directory itself is never auto-skipped.')}

${B('NAME CLEANING')}
  Scene filenames:   Breaking.Bad.S05E14.Ozymandias.1080p.BluRay.x265-PSA.mkv
                  →  Breaking Bad S05 E14 - Ozymandias.mkv

  Movies with year:  The.Dark.Knight.2008.1080p.BluRay.x264-SPARKS.mkv
                  →  The Dark Knight (2008).mkv

  Bracket prefixes:  [Squid Game 2 - 640Kbps) - 15GB - ESub] Squid Game S02E05 Friend or Foe.mkv
                  →  Squid Game S02 E05 - Friend or Foe.mkv

  Anime episodes:    Demon.Slayer.EP26.1080p.CR.WEB-DL.mkv
                  →  Demon Slayer E26.mkv

  Anime specials:    Attack.on.Titan.SP02.1080p.mkv       → Attack on Titan SP02.mkv
                     Fullmetal.Alchemist.OVA.1080p.mkv    → Fullmetal Alchemist OVA.mkv
                     Sword.Art.Online.Special.1080p.mkv   → Sword Art Online Special.mkv
                     My.Anime.ONA.1080p.mkv               → My Anime ONA.mkv

  Season packs:      Chernobyl Season 1 Complete 720p WEB-DL x264 [i_c]
                  →  Chernobyl S01

  Site-prefixed:     www.TamilRockers.ws - Pushpa The Rise (2021) 720p WEB-DL HIN-TAM x264.mkv
                  →  Pushpa the Rise (2021).mkv

  Numbered episodes: CID (1998) (1500).mkv                → CID (1998) E1500.mkv
                  ${D('(daily-soap releases with no season, just a running count)')}

${B('SUBTITLE PAIRING')}
  Subtitles in the same directory as their video are renamed to match:
    Breaking.Bad.S05E14.en.srt  →  Breaking Bad S05 E14 - Ozymandias.en.srt
    Breaking.Bad.S05E14.srt     →  Breaking Bad S05 E14 - Ozymandias.srt
  Language codes (.en, .fr, .en.forced, .en.sdh) are preserved.

${B('DUPLICATE HANDLING')}
  When two files would rename to the same destination, the resolution tag
  is extracted from the original filename and appended instead of "(2)":
    Movie.1080p.mkv  +  Movie.720p.mkv  →  both become "Movie (2010).mkv"
    Resolved as:  Movie (2010) [1080p].mkv  +  Movie (2010) [720p].mkv

${B('UNDO')}
  After every run, a ${G('rename-log.json')} is saved inside the scanned directory.
  Run with ${G('--undo')} (and optionally ${G('--path')}) to reverse every rename.
  The log is automatically deleted after a successful undo.

${B('EXAMPLES')}
  rename-videos
  rename-videos --path="/mnt/media/movies"
  rename-videos --path="./shows" --force
  rename-videos --path="./shows" --undo
`);
}

module.exports = { printHelp };
