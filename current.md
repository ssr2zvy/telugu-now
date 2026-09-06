Run the font sync once from the repo root:

npm run fonts:sync

That should generate and populate:

frontend/public/fonts/
├── noto-sans-telugu.woff2
├── noto-serif-telugu.woff2
├── mandali.woff2
├── ramabhadra.woff2
├── ntr.woff2
├── peddana.woff2
├── ramaraja.woff2
├── sree-krushnadevaraya.woff2
├── suranna.woff2
├── tenali-ramakrishna.woff2
│
├── font-assets.lock.json
│
└── licenses/
    ├── notosanstelugu-OFL.txt
    ├── notoseriftelugu-OFL.txt
    ├── mandali-OFL.txt
    ├── ramabhadra-OFL.txt
    ├── ntr-OFL.txt
    ├── peddana-OFL.txt
    ├── ramaraja-OFL.txt
    ├── sreekrushnadevaraya-OFL.txt
    ├── suranna-OFL.txt
    └── tenaliramakrishna-OFL.txt

Then commit those generated files to the repo.

The intended flow is:

npm run fonts:sync
git add frontend/public/fonts
git commit -m "add observation font assets"

After that, normal builds should have the exact font binaries and license files locally, and the standalone export can embed those same local font assets into the single HTML file.