# PokeDexPorter MVP

Mobile-friendly web MVP to:

1. Upload Pokédex screenshots.
2. Extract likely Pokédex number, Pokémon name, and captured/missing status.
3. Review and correct extracted entries.
4. Save a local snapshot.
5. Share snapshot using a URL.
6. Compare snapshots to find trade opportunities.

## Run locally

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

## Notes

- Screenshot parsing uses browser OCR via `tesseract.js` (CDN).
- Captured detection uses a color-saturation heuristic:
  - Higher saturation => likely captured (colored artwork).
  - Lower saturation => likely missing (greyed out).
- This MVP stores snapshots in browser `localStorage` and share links contain encoded snapshot payloads.
