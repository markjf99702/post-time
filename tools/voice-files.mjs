// Makes voice/, the files of the caller's downloaded voice, from the published packages they come from:
//   node tools/voice-files.mjs <folder holding the originals>
// It has been run once and what it made is committed. The big files never change after that (every change
// to one adds its whole size to the repo for good), so run it again only for a new voice or a new version
// of one of the packages, into a cache with a new name (see `cache` below, and JOE in js/joe.js).
//
// The originals, each checked against the SHA-256 written here before anything is made from it:
//   en_US-joe-medium.onnx, en_US-joe-medium.onnx.json, MODEL_CARD
//       https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/joe/medium (at commit cf910fb5)
//   onnxruntime-web-1.22.0.tgz    https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.22.0.tgz
//   piper-wasm-1.0.0.tgz          https://registry.npmjs.org/@diffusionstudio/piper-wasm/-/piper-wasm-1.0.0.tgz
//   piper_tts-1.8.0-cp39-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.manylinux_2_28_x86_64.whl
//       https://pypi.org/project/piper-tts/1.8.0/ (pip download piper-tts==1.8.0 --no-deps)
// voice/NOTICE says what each of them is and what its licence asks. The licence texts beside the files
// are kept by hand.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const from = process.argv[2];
if (!from) { console.error('usage: node tools/voice-files.mjs <folder holding the originals>'); process.exit(1); }
const out = fileURLToPath(new URL('../voice/', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const original = (name, sum) => {
  const bytes = readFileSync(join(from, name));
  if (sha256(bytes) !== sum) throw new Error(`${name} is not the file this was written for (its SHA-256 is ${sha256(bytes)})`);
  return bytes;
};

const model = original('en_US-joe-medium.onnx', 'abf4b998e34045cbd00eaf050de2de620f81ded6eb8b85a24b022a1c2b3f08d2');
const config = original('en_US-joe-medium.onnx.json', '7b5f0293c0bf5bda8e377be1696da84af798befeef31038e43beefc01fe858da');
const card = original('MODEL_CARD', '4b319248135916e8f5433ce7a9fe5271026b05cb598bab05807b22cb17fd129b');
original('onnxruntime-web-1.22.0.tgz', 'e293551f9d36d003e293d0f2937fee7b3dfdcef76d71d1449b55e2d4157c7aea');
original('piper-wasm-1.0.0.tgz', 'e5be7f15b3ec42b09fca3616db2ce3e2cf83faacc9c291c400ccf48a9d85c803');
const WHEEL = 'piper_tts-1.8.0-cp39-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.manylinux_2_28_x86_64.whl';
original(WHEEL, '25b4d3f31ff70c8fa7151908e00aaa5650cbdf16bca8fcf21299f3941b89a7d3');
const work = mkdtempSync(join(tmpdir(), 'voice-files-'));
const unpack = (archive, ...args) => execFileSync(archive.endsWith('.whl') ? 'unzip' : 'tar', archive.endsWith('.whl') ? ['-q', join(from, archive), ...args, '-d', work] : ['xzf', join(from, archive), '-C', work, ...args]);
unpack('onnxruntime-web-1.22.0.tgz', 'package/dist/ort.wasm.min.mjs', 'package/dist/ort-wasm-simd-threaded.mjs', 'package/dist/ort-wasm-simd-threaded.wasm');
const ort = name => readFileSync(join(work, 'package/dist', name));
const ortFiles = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].map(n => [n, ort(n)]);
unpack('piper-wasm-1.0.0.tgz', 'package/build/piper_phonemize.js', 'package/build/piper_phonemize.wasm');
const phonemize = ['piper_phonemize.js', 'piper_phonemize.wasm'].map(n => [n, readFileSync(join(work, 'package/build', n))]);
unpack(WHEEL, 'piper/espeak-ng-data/*');

// espeak-ng's data, for English: every file Python Piper 1.8.0 has but the other languages' dictionaries
// (18 MB of them, against 1 MB for the rest). The phonemizer the browser runs is an older espeak-ng than
// Python Piper's, and with its own data it gives this voice different sounds for about a line in four of a
// race call. With this data it gives the same, but for one thing: where a word ends in an "ee" sound and
// the next begins with a vowel ("the early lead"), espeak-ng puts in a linking sound, and the data says
// not to write it in the phonemes. The newer espeak-ng writes it all the same (when it writes a phoneme's
// name it no longer looks back at the sound before: WritePhMnemonic in dictionary.c), so Python Piper
// gives it to the voice, and the clips the voice was chosen from have it. So the rule is changed here to
// name the sound: in phsource/phonemes, `ipa NULL` under `phoneme ;` becomes `ipa ʲ`, which is these three
// bytes of the compiled phonindex. test/joe.test.mjs fails without them.
const dataDir = join(work, 'piper/espeak-ng-data');
const files = [];
(function walk(dir, rel) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, `${rel}${name}/`);
    else if (!name.endsWith('_dict') || name === 'en_dict') files.push([rel + name, readFileSync(path)]);
  }
})(dataDir, '');
const phonindex = files.find(f => f[0] === 'phonindex')[1];
const LINK = 830; // where `ipa NULL` of the linking sound is: the instruction 0x0d01 and its one character, a space
if (phonindex.readUInt16LE(LINK) !== 0x0d01 || phonindex.readUInt16LE(LINK + 2) !== 0x2000) throw new Error('phonindex is not the file the change was written for');
phonindex.writeUInt16LE(0x0d02, LINK);     // an ipa name of two bytes
phonindex.writeUInt16LE(0xcab2, LINK + 2); // ʲ (U+02B2) in UTF-8

// A plain tar of them (ustar, names in order, no dates or owners, so it comes out the same every time).
function tar(list) {
  const blocks = [];
  for (const [name, bytes] of list) {
    const head = Buffer.alloc(512);
    if (Buffer.byteLength(name) > 100) throw new Error(`too long a name for a tar: ${name}`);
    head.write(name, 0);
    head.write('0000644\0', 100); head.write('0000000\0', 108); head.write('0000000\0', 116);
    head.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    head.write('00000000000\0', 136);
    head.write('        ', 148); head.write('0', 156); head.write('ustar\0' + '00', 257);
    head.write(head.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(head, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
const data = tar(files);

// The model, in parts small enough to push and to fetch again one at a time.
const PART = 16 * 1024 * 1024;
const parts = [];
for (let at = 0; at < model.length; at += PART) parts.push(model.subarray(at, Math.min(model.length, at + PART)));

const listed = [];
const put = (path, bytes, more = {}) => {
  mkdirSync(join(out, path, '..'), { recursive: true });
  writeFileSync(join(out, path), bytes);
  listed.push({ path, bytes: bytes.length, sha256: sha256(bytes), ...more });
};
put('joe/en_US-joe-medium.onnx.json', config);
put('joe/MODEL_CARD', card);
parts.forEach((p, i) => put(`joe/en_US-joe-medium.onnx.part${i}`, p, { of: 'joe/en_US-joe-medium.onnx' }));
for (const [name, bytes] of ortFiles) put(`ort/${name}`, bytes);
for (const [name, bytes] of phonemize) put(`phonemize/${name}`, bytes);
put('espeak-ng-data/en.tar', data);
const manifest = {
  voice: 'en_US-joe-medium',
  // The cache the browser keeps them in. A different set of files goes in a cache with a different name.
  cache: 'post-time-voice-joe-1',
  bytes: listed.reduce((n, f) => n + f.bytes, 0),
  whole: { 'joe/en_US-joe-medium.onnx': { bytes: model.length, sha256: sha256(model), parts: listed.filter(f => f.of).map(f => f.path) } },
  files: listed,
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
rmSync(work, { recursive: true, force: true });
console.log(`${listed.length} files, ${manifest.bytes} bytes (${(manifest.bytes / 1e6).toFixed(1)} MB); espeak-ng's data: ${files.length} files, ${data.length} bytes as a tar`);
for (const f of listed) console.log(`  ${f.path}  ${f.bytes}  ${f.sha256.slice(0, 16)}`);
