# E-VIS: P01-06 strict screenshot contract

## Contract

- Evidence level: `local-fixture-verified`; P01-01 light screenshots are the visual reference, not a claim that P01-06 contacted a live application.
- Viewports are fixed at desktop 1440 x 900 and mobile 390 x 844. Each viewport has separate light and dark screenshots.
- Animations are disabled and the caret is hidden. Dynamic account, stats and login-wallet regions use explicit Playwright masks.
- P01-06 comparisons use the fixed `maxDiffPixels: 60` threshold. Platform-specific Darwin and Linux baselines are committed; Linux baselines were generated and then re-run without update in `mcr.microsoft.com/playwright:v1.62.1-noble`.
- CI pins that rendering environment to digest `sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e`. A clean local container rerun passed desktop/mobile 2/2, and CI run 31816356438 passed the complete Browser suite without changing the threshold or masks.
- The P01-05 shell contract remains independent at `maxDiffPixelRatio: 0.001`; its test no longer rewrites historical acceptance actuals.

## P01-06 pixel results

| View | Darwin actual/baseline SHA-256 | Linux baseline SHA-256 | Result |
|---|---|---|---|
| Light desktop | `6455314ccb3a1b7c9b2435afe8a9116248c563b79148d40a5d392b29c5ab059f` | `1e23f5023eb2ef4290c5b0f786dc2c2903ae4ed7d58869ed0b14b21447dc04eb` | passed; Darwin byte-identical |
| Dark desktop | `71a9391cb7375da8ae5c5658c61c1a0ed735384482436acb2a53190474fef4c2` | `748901a36582843bfdbdc86c56b3d4ecd622d3e098da82e648a85495c7a54fd0` | passed; Darwin byte-identical |
| Light mobile | `ff3024baececd47ae4555a49eeb14c24bbeea8eac33840e6b8504822cc0d336c` | `bf28b5648e170d2c9fab3129d09d10a55ecea5c27572d9d46a791180276bfeb0` | passed; Darwin byte-identical |
| Dark mobile | `e1b423d9102dc01d49080ebd28ea9cca0c5919493ce6d116f4fe28b62d24cd1d` | `b3a144be56c2cc707fd1662cb2ce49025e7beee069a48b77e78c58c7d33bbccc` | passed; Darwin byte-identical |

Saved actual files are under `artifacts/acceptance/P01-06/visual/`. The desktop zero-diff images have SHA-256 `59a804d390137ac87e768ded1707d42ea2a483b3ce6a94f1f261462aacb1b868`; mobile zero-diff images have `527cc7abd48fcccf8176d360c802d90b87f431c9b151db911e1ab04117eca9b1`.

## Manual review

- Light desktop follows the observed settings density and grouping. Dark desktop applies semantic surfaces, borders, text and focus colors rather than a filter or one-color inversion.
- Desktop navigation, settings controls and fixed status bar remain in their stable tracks. Dynamic magenta masks are confined to the declared account/stats/wallet regions.
- Mobile controls wrap intentionally, the color swatches remain inspectable, and the fixed six-track navigation does not overlap or resize labels.
- No visible text is clipped, no control overlaps another control and no horizontal overflow is present in the four actuals.
- Custom dark input, theme segments, switches, move buttons and restore command fit their containers at their captured widths.

## Historical evidence integrity

- P01-05 actuals were restored to their accepted hashes after a successful test run exposed that the old test wrote into its evidence directory: desktop `9c5363b1707d43f888beebc8e5c6d61f5b5994f58e79a04a942879ec81d9a34e`, mobile `48abeb2896afef6a67c1be7c82a5fe6a63ae62d662dab76445b927a3cd2f3d03`.
- A strict P01-05 desktop/mobile rerun passed 2/2 after removing that write side effect, and the P01-01..05 acceptance directories again match their pre-P01-06 tree objects.

Bright magenta pixels are Playwright masks, not rendered application decoration.
