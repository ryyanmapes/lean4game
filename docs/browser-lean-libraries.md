# Browser Lean library artifacts

The browser runtime in `cauli/lean4-wasm-in-browser` can only read libraries
compiled by the exact same Lean fork commit and pointer width. The ordinary
Lean 4.28 toolchain used by lean4game embeds a different githash, so its
`.olean` files cannot be reused in the browser.

The **Build browser Lean libraries** workflow downloads Cauli's matching native
32-bit compiler, builds GameServer and VisualTest, and uploads their `.olean`,
`.ir`, `.ir.sig`, and game-data files as one Actions artifact. NNG4 is available
as an optional workflow input while the smaller VisualTest path is stabilized.

## Repository setup

Create a fine-grained GitHub personal access token that can read Actions
artifacts from `cauli/lean4`, then add it to this repository at:

`Settings -> Secrets and variables -> Actions -> New repository secret`

Name the secret `CAULI_ARTIFACT_TOKEN`. It only needs read access. GitHub
requires authentication to download Actions artifacts even when the source
repository is public.

## Run it

1. Open the repository's **Actions** tab.
2. Choose **Build browser Lean libraries**.
3. Select **Run workflow**.
4. Leave `include_nng4` off for the first run.
5. Download `visual-lean-libs-62b6a2291302d4bbeace37642a066b7510d0145c`
   from the completed run.

The extracted artifact contains:

```text
build-info.json
lean-lib-files.txt
lean-lib/**/*.olean
lean-lib/**/*.ir
lean-lib/**/*.ir.sig
gamedata/VisualTest/**
gamedata/NNG4/**          # only when requested
```

`build-info.json` records all source revisions and the required Lean githash so
the browser application can reject incompatible assets instead of failing with
an opaque Lean IO error.

