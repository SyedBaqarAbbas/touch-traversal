# Third-party and asset notices

Touch Traversal source code, its fictional `sample-notes/` corpus, generated architecture diagrams,
and screenshots of the project UI are distributed under the repository's
[Apache License 2.0](./LICENSE). The checked-in release contains no personal note data or camera
frames.

## Hosted web application

The packages below were found in the locked production module closure emitted by the static export
or in the MediaPipe hand-input worker. This list includes bundled transitive packages and excludes
direct dependencies that are not emitted into the hosted artifact.

| Package                       | Version | License    |
| ----------------------------- | ------: | ---------- |
| `@babel/runtime`              |  7.29.7 | MIT        |
| `@mediapipe/tasks-vision`     | 0.10.35 | Apache-2.0 |
| `@react-three/drei`           |  10.7.7 | MIT        |
| `@react-three/fiber`          |   9.6.1 | MIT        |
| `@react-three/postprocessing` |   3.0.4 | MIT        |
| `@swc/helpers`                |  0.5.15 | Apache-2.0 |
| `graphology`                  |  0.26.0 | MIT        |
| `its-fine`                    |   2.0.0 | MIT        |
| `maath`                       |   0.6.0 | MIT        |
| `n8ao`                        |  1.10.3 | CC0-1.0    |
| `next`                        | 16.2.10 | MIT        |
| `postprocessing`              |  6.39.2 | Zlib       |
| `react`                       |  19.2.7 | MIT        |
| `react-dom`                   |  19.2.7 | MIT        |
| `react-use-measure`           |   2.1.7 | MIT        |
| `scheduler`                   |  0.27.0 | MIT        |
| `suspend-react`               |   0.1.3 | MIT        |
| `three`                       | 0.185.1 | MIT        |
| `use-sync-external-store`     |   1.6.0 | MIT        |
| `zod`                         |   4.4.3 | MIT        |
| `zustand`                     |  5.0.14 | MIT        |

The release includes the [complete hosted-runtime license bundle](./THIRD_PARTY_LICENSES/web-runtime-LICENSES.txt)
with available copyright notices. It also keeps the exact
[MediaPipe v0.10.35 license text](./THIRD_PARTY_LICENSES/mediapipe-v0.10.35-LICENSE.txt) as a
standalone file, including MediaPipe's bundled Lucent Technologies UTF notice.

`n8ao@1.10.3` is listed as CC0-1.0 because its bundled `LICENSE` and `README` specify CC0; its
`package.json` metadata incorrectly says ISC. `maath@0.6.0` declares MIT in `package.json`, but its
published package and upstream repository provide no copyright/license file; the bundle records
that omission and includes the complete MIT terms without inventing a copyright holder.

## MediaPipe model and WASM assets

- The six runtime JS and WASM files in `apps/web/public/vendor/mediapipe/tasks-vision/wasm/` are
  byte-for-byte copies of the runtime shipped by `@mediapipe/tasks-vision@0.10.35`, licensed
  Apache-2.0.
- `apps/web/public/models/hand_landmarker/hand_landmarker.task` matches Google's published
  [`float16/1` Hand Landmarker bundle](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task)
  with SHA-256 `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`.
  Google's [Hand Tracking model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf)
  identifies the detector and tracker models as Apache-2.0.

## Offline pipeline

The Python pipeline is not part of the hosted Pages artifact. Its direct runtime dependencies are
`markdown-it-py` (MIT), `networkx` (BSD-3-Clause), `pydantic` (MIT), `python-frontmatter` (MIT), and
`PyYAML` (MIT). Optional local graph builds use `sentence-transformers` (Apache-2.0) and
`umap-learn` (BSD-3-Clause); their installed distributions retain the corresponding license files.

The configured `all-MiniLM-L6-v2` embedding model is fetched on first use and is not redistributed
by this repository. Its upstream model revision is not currently pinned, so its license and
content must be re-audited before publishing a cache or embedding model snapshot.

## Fonts and media

The web application bundles no font files. Its CSS uses system font stacks, so no font license is
redistributed. Tracked PNG, WebP, GIF, and WebM files are captures of this project made with the
fictional sample and no camera background; the SVGs are generated from project-authored Mermaid
sources, and the sample Markdown is fictional project content. No third-party stock imagery,
audio, or camera capture is included in the release.
