# Intelligent Video Renamer

Smart CLI tool to clean messy movie and TV filenames.

## Install

npm install -g rename-videos

## Usage

rename-videos --path ./videos

rename-videos --force

rename-videos --undo

## Features

• Smart title detection — S01E05, 1x05, S01E01-E03, daily shows (2024-01-15), fansub "Show - 24", anime specials  
• Season folders and packs — "S03", "Season 1-5" → "S01-S05"  
• Multi-disc movies kept apart — CD1 / CD2 / Disc 1  
• Subtitle pairing (.en, .pt-BR, .English, .forced)  
• Conflict handling — clashing names get a resolution tag ("[720p]") before "(2)"  
• Safe to re-run — already-clean names are left alone  
• Undo support  
• Camera file protection  
• Deep folder scanning
