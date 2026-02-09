// Build script for bundling ML libraries with esbuild
// Bundles @xenova/transformers and @orama/orama for Chrome extension use

import * as esbuild from 'esbuild';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, '..', '..', 'dist');
const wasmDir = path.join(distDir, 'wasm');

async function build() {
  console.log('🔨 Building ML library bundles...');

  // Clean and create dist directories
  await fs.remove(distDir);
  await fs.ensureDir(distDir);
  await fs.ensureDir(wasmDir);

  // Bundle Transformers.js
  console.log('📦 Bundling @xenova/transformers...');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'transformers-entry.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    outfile: path.join(distDir, 'transformers.bundle.js'),
    minify: false, // Keep readable for debugging
    sourcemap: false,
    external: [], // Bundle everything
  });
  console.log('✅ Transformers.js bundled');

  // Bundle Orama
  console.log('📦 Bundling @orama/orama...');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'orama-entry.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    outfile: path.join(distDir, 'orama.bundle.js'),
    minify: false,
    sourcemap: false,
    external: [],
  });
  console.log('✅ Orama bundled');

  // Note: Dexie is not bundled - we use the UMD bundle directly
  // It's already browser-compatible and works in both DOM and Service Worker contexts

  // Copy WASM files from onnxruntime-web
  console.log('📦 Copying WASM files...');
  const onnxWasmSource = path.join(
    __dirname,
    'node_modules',
    'onnxruntime-web',
    'dist'
  );

  // Copy all WASM and related files
  const wasmFiles = await fs.readdir(onnxWasmSource);
  for (const file of wasmFiles) {
    if (file.endsWith('.wasm') || file.endsWith('.mjs') || file.endsWith('.jsep.js')) {
      await fs.copy(
        path.join(onnxWasmSource, file),
        path.join(wasmDir, file)
      );
      console.log(`  ✓ Copied ${file}`);
    }
  }

  console.log('✅ WASM files copied');
  console.log('🎉 Build complete!');
  console.log(`📁 Output directory: ${distDir}`);
}

build().catch((error) => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});
