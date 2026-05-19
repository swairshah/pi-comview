# pi-comview

Pi package that adds a `/review` command for a [comview](https://github.com/rockorager/comview)-driven review loop:

![pi-comview demo](assets/demo-4x.gif)

1. Open diff in `comview`
2. Add comments (`i`), save (`:w`), quit (`:q`)
3. Pi automatically reads `.comview/comments.json`
4. Pi addresses comments by default

## Attribution

This package bundles the [`comview`](https://github.com/rockorager/comview) binary, originally created by [rockorager](https://github.com/rockorager). See the upstream repository for the comview source code and license.

## Install

### From GitHub

```bash
pi install git:github.com/swairshah/pi-comview
# or
pi install https://github.com/swairshah/pi-comview
```

### From npm

```bash
pi install npm:pi-comview
```

After install, run `/reload` (or restart Pi).

## Use

- `/review` → review `git diff`
- `/review --staged` → review `git diff --staged`
- `/review --all` → resend all comments (ignores seen-state)
- `/review --reset` → reset seen-state only

State files are per-repo:

- `.comview/comments.json`
- `.comview/pi-review-state.json`

## Bundled comview binaries

This package ships prebuilt `comview` binaries in `bin/` for:

- macOS arm64
- macOS amd64
- Linux arm64
- Linux amd64

The extension resolves binaries in this order:

1. `PI_COMVIEW_BIN` env var
2. bundled `bin/comview-<platform>-<arch>`
3. `comview` from `PATH`

## Updating bundled comview from upstream release

When a new upstream comview release is available, run:

```bash
make update
# or pin explicit tag
make update TAG=v0.2.0
```

This will:

- clone upstream `rockorager/comview`
- build all target binaries
- update:
  - `COMVIEW_VERSION`
  - `bin/comview-*`
  - `bin/checksums.txt`
  - `bin/metadata.json`

Then commit and publish this package.

## Publish

```bash
npm publish
```

After publishing, users can install with:

```bash
pi install npm:pi-comview
```
