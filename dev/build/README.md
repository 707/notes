# Build System

This folder contains the build system for bundling ML libraries.

## Purpose

Chrome extensions cannot use `node_modules` directly. This build system:
1. Bundles `@xenova/transformers` for local ML embeddings
2. Bundles `@orama/orama` for vector search
3. Copies WASM files for ONNX Runtime inference

## Usage

```bash
cd dev/build
npm install
npm run build
```

Output: `chrome-clipper/dist/` folder with bundled libraries.

## When to Rebuild

- After updating transformers or orama versions
- After modifying entry point files
- For debugging bundled code

## Distribution Note

The `dist/` folder is pre-built and committed to git. End users do NOT need to run the build system.
