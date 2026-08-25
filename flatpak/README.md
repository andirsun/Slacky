# Flatpak / Flathub packaging

Files here build Slacky as a flatpak and prepare the Flathub submission for
[#10](https://github.com/andirsun/Slacky/issues/10).

| File | Purpose |
| --- | --- |
| `com.andersonlaverde.slacky.yml` | flatpak-builder manifest |
| `com.andersonlaverde.slacky.metainfo.xml` | AppStream metadata (mandatory on Flathub) |
| `com.andersonlaverde.slacky.desktop` | Desktop entry |
| `slacky.sh` | Launcher, wraps the app in zypak |

## Why this does not use electron-builder's flatpak target

electron-builder's `flatpak` target shells out to `flatpak-builder` itself. The
first attempt at this manifest called `npm run pack -- --linux flatpak` from
inside `build-commands`, which runs flatpak-builder inside a flatpak build — that
is what wedged it. The manifest now runs `electron-builder --linux dir`, which
only produces an unpacked tree, and the flatpak is assembled around that tree.

## Prerequisites

flatpak-builder does not run on macOS. Build on Linux; to produce the arm64
package you need arm64 hardware or `qemu-user-static` binfmt emulation.

```sh
flatpak install -y flathub org.freedesktop.Platform//24.08 org.freedesktop.Sdk//24.08 \
    org.electronjs.Electron2.BaseApp//24.08
```

## Node comes from nodejs.org, temporarily

This manifest would normally build against
`org.freedesktop.Sdk.Extension.node24`. dl.flathub.org is currently serving
that extension's `aarch64/24.08` objects broken — HTTP 503, or a 22,509,726
byte object truncated at exactly 3 MiB — so the manifest vendors Node from
nodejs.org as a build-only module instead, and drops it from the finished
flatpak with `cleanup`. Switch back to the SDK extension once upstream is
fixed; that is what Flathub reviewers expect to see.

## Generating `generated-sources.json`

The build sandbox has no network, so every npm tarball and the Electron binary
have to be declared as sources up front. That file is generated, not written by
hand, and is not committed — regenerate it whenever `package-lock.json` changes:

```sh
# Needs network. Run from the repo root.
pipx install 'git+https://github.com/flatpak/flatpak-builder-tools.git#subdirectory=node'
flatpak-node-generator npm package-lock.json -o flatpak/generated-sources.json
```

The generator also emits `flatpak-node/electron-builder-arch-args.sh`, which the
manifest sources so electron-builder targets the architecture being built.

## CI

`.github/workflows/flatpak.yml` builds this manifest on `ubuntu-24.04-arm` for
every pull request that touches the app or the packaging, and uploads the
resulting `slacky.flatpak` as a run artifact you can install with
`flatpak install --user slacky.flatpak`. A separate job validates the AppStream
and desktop metadata.

CI generates `generated-sources.json` itself, and rewrites the manifest's `git`
source to a `dir` source so it builds the commit under test rather than the last
published tag. The committed manifest keeps the `git` source, which is what
Flathub requires.

## Building and running locally

```sh
flatpak-builder --user --install --force-clean build-dir \
    flatpak/com.andersonlaverde.slacky.yml
flatpak run com.andersonlaverde.slacky
```

## Before submitting to Flathub

- [ ] **Add a real screenshot.** `com.andersonlaverde.slacky.metainfo.xml` points
      at `build/screenshots/main-window.png`, which does not exist yet. Flathub
      rejects submissions whose screenshot URLs do not resolve.
- [ ] Validate the metadata:
      ```sh
      appstreamcli validate flatpak/com.andersonlaverde.slacky.metainfo.xml
      desktop-file-validate flatpak/com.andersonlaverde.slacky.desktop
      flatpak run --command=flatpak-builder-lint org.flatpak.Builder \
          manifest flatpak/com.andersonlaverde.slacky.yml
      ```
- [ ] Confirm huddles work — mic, camera and screen share — since `--device=all`
      is the permission most likely to be questioned in review.
- [ ] Bump `tag:` and `commit:` in the manifest to the release being published,
      and add a matching `<release>` entry to the metainfo.
- [ ] Submit: open a pull request against
      [flathub/flathub](https://github.com/flathub/flathub) on the `new-pr`
      branch adding this manifest. Flathub then creates
      `flathub/com.andersonlaverde.slacky`, and future releases are published by
      updating the manifest in *that* repo, not this one.
- [ ] Slacky bundles no Slack trademark assets beyond the app icon; double-check
      the icon before submission, since Flathub review looks at third-party
      branding.
