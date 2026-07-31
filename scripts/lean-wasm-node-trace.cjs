#!/usr/bin/env node
// Run the pinned Lean WebAssembly CLI while recording every file it reads from
// /lib/lean. This is intentionally a CI/packaging tool: the resulting list is
// validated by rerunning the same proof against a library containing only the
// traced files before it may be shipped to browsers.

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const [artifactDir, workDir, traceFile, ...leanArgs] = process.argv.slice(2);
if (!artifactDir || !workDir || !traceFile) {
  console.error('usage: lean-wasm-node-trace.cjs <artifact-dir> <workdir> <trace-file> [lean args...]');
  process.exit(2);
}

const leanJs = path.resolve(artifactDir, 'bin/lean.js');
const libLean = path.resolve(artifactDir, 'lib/lean');
const realWork = path.resolve(workDir);
const realTrace = path.resolve(traceFile);
const openedLibraryFiles = new Set();

function recordLibraryPath(value) {
  const virtualPath = typeof value === 'string'
    ? value
    : value && typeof value.path === 'string' ? value.path : '';
  const normalized = virtualPath.replace(/\\/g, '/');
  if (!normalized.startsWith('/lib/lean/')) return;
  const relative = normalized.slice('/lib/lean/'.length);
  if (relative && !relative.includes('/../') && !relative.startsWith('../')) {
    openedLibraryFiles.add(relative);
  }
}

function flushTrace() {
  fs.mkdirSync(path.dirname(realTrace), { recursive: true });
  fs.writeFileSync(realTrace, [...openedLibraryFiles].sort().join('\n') + '\n');
}

process.on('exit', flushTrace);
process.chdir('/');

globalThis.Module = {
  arguments: leanArgs,
  preRun: [function () {
    const FS = Module.FS;
    const NODEFS = FS.filesystems.NODEFS;
    const mkdirTree = (p) => {
      let current = '';
      for (const part of p.split('/').filter(Boolean)) {
        current += '/' + part;
        try { FS.mkdir(current); } catch (error) { /* exists */ }
      }
    };
    for (const directory of ['/lib/lean', '/work', '/bin', '/workspace']) mkdirTree(directory);
    mkdirTree(path.dirname(leanJs));
    FS.mount(NODEFS, { root: libLean }, '/lib/lean');
    FS.mount(NODEFS, { root: realWork }, '/work');
    Module.ENV.LEAN_PATH = '/lib/lean';
    FS.chdir('/work');

    // Record successful opens, not metadata probes. The module loader checks
    // for optional `.olean.private`/`.olean.server` companions with stat;
    // treating those lookups as reads inflated the first closure by hundreds
    // of megabytes even though exported-level browser imports never opened
    // them.
    const originalOpen = FS.open;
    FS.open = function (...args) {
      const stream = originalOpen.apply(this, args);
      recordLibraryPath(args[0]);
      return stream;
    };
  }],
  onExit: (code) => { process.exitCode = code; },
  onAbort: (what) => { console.error('ABORT:', what); process.exit(3); },
};

globalThis.require = require;
globalThis.__filename = leanJs;
globalThis.__dirname = path.dirname(leanJs);

vm.runInThisContext(fs.readFileSync(leanJs, 'utf8'), { filename: leanJs });
