# Fix for Running lean4game on Windows (Development)

This document describes the one bug that prevents `lean4game` from running locally on
Windows, and the patch required to fix it. The issue does not affect Linux/macOS
deployments (the official hosted version) because it is caused by Windows-specific
behaviour in the browser environment.

Two other changes were investigated and found to be **unnecessary** — they are
documented at the bottom for completeness.

---

## The Fix — Windows `fsPath` / `path-browserify` incompatibility

**File:** `node_modules/vscode/vscode/src/vs/base/common/resources.js`

**Symptom:**

```
Unable to write file '\workspace.code-workspace' (NoPermissions (FileSystemError): Not allowed)
    at writeFile (FileService)
    at doWriteConfiguration (ConfigurationService)
```

This error fires on every editor initialisation and prevents the Monaco editor from
starting. The Lean code editor panel never appears.

**Root cause:**

VS Code detects the OS at runtime via `navigator.userAgent`. On Windows, even inside
a browser, it sets `isWindows = true`. This causes
`Uri.file('/workspace.code-workspace').fsPath` to return `\workspace.code-workspace`
(backslashes).

The in-memory virtual file system then computes the parent directory of this path
using the bundled `path-browserify` module. `path-browserify` only understands POSIX
separators (`/`) and does not recognise `\` as a path separator. Consequently:

```js
path.dirname('\workspace.code-workspace')  // → '.'  (wrong, should be '/')
```

`_lookupParentDirectory` looks for a directory named `'.'` in the in-memory root —
finds nothing — throws `FileNotFound`. `writeToDelegates` catches this, exhausts all
registered delegates, and re-throws as `NoPermissions` ("Not allowed"). The same bug
affects every `file://` URI without a Windows drive letter (e.g. `file:///Tutorial/1.lean`).

**Fix:**

In `ExtUri.dirname`, replace the Windows-`fsPath`-based path computation for
`file://` URIs with a direct POSIX call. The `path` property of a VS Code `URI`
object is **always** stored with forward slashes regardless of platform, so
`posix.dirname` is always correct here.

```diff
 dirname(resource) {
     if (resource.path.length === 0) { return resource; }
     let dirname;
     if (resource.scheme === Schemas.file) {
-        dirname = URI.file(dirname$1(originalFSPath(resource))).path;
+        dirname = posix.dirname(resource.path);
     } else {
         dirname = posix.dirname(resource.path);
         ...
     }
     return resource.with({ path: dirname });
 }
```

**Upstream project:** [@codingame/monaco-vscode-api](https://github.com/CodinGame/monaco-vscode-api)

> **Note:** This patch is applied to a file inside `node_modules` and will be
> overwritten by `npm install`. It should be submitted upstream, or preserved locally
> via a tool such as `patch-package`.

---

---

## Fix 2 — Windows path → `file://` URI in relay server

**File:** `relay/src/serverProcess.ts`

**Symptom:**

```
Error: Cannot process request to closed file 'file://C:\Users\...\NNG4/Game/Metadata.lean'
```

This error appears in the browser console when loading a level. The proof state fails to load for the level (the `Game.getProofState` RPC call is rejected).

**Root cause:**

In `messageTranslation`, the relay server rewrites all LSP message URIs to point to `Game/Metadata.lean` on the real filesystem (so the Lean server can process the virtual level file in the game's context):

```ts
replaceUri(message, `file://${gameDir}/Game/Metadata.lean`)
```

On Linux/macOS, `gameDir` is `/home/.../nng4`, so `file://` + that path gives `file:///home/.../nng4/Game/Metadata.lean` — three slashes, correct. On Windows, `gameDir` is `C:\Users\...\NNG4`, producing `file://C:\...\NNG4/Game/Metadata.lean` — only two slashes, backslashes in the path — an invalid file URI. The Lean server cannot match this malformed URI to any open document.

**Fix:**

Use Node's `pathToFileURL` to convert the filesystem path to a properly encoded `file:///` URI on all platforms:

```diff
+import { pathToFileURL } from 'url';
 ...
-replaceUri(message, `file://${gameDir}/Game/Metadata.lean`)
+replaceUri(message, pathToFileURL(path.join(gameDir, 'Game', 'Metadata.lean')).toString())
```

`pathToFileURL` on Windows converts `C:\Users\...\NNG4\Game\Metadata.lean` to `file:///C:/Users/.../NNG4/Game/Metadata.lean`.

---

## Investigated but not required

### `getFilesServiceOverride()` missing from `lean4monaco`

**File:** `node_modules/lean4monaco/dist/leanmonaco.js`

It was thought that `initialize()` needed `...getFilesServiceOverride()` and a
pre-created workspace file via `initFile`. Testing showed this change alone does
**not** fix the issue on Windows — the root cause is the `dirname` bug above.

### `shallowEqual` in `InventoryPanel`

**File:** `client/src/components/inventory/inventory_panel.tsx`

A "Maximum update depth exceeded" console error was observed, caused by
`selectInventory` returning a new `[]` literal on every call. Adding `shallowEqual`
to `useSelector` suppresses the error but is not required for the editor to function.
