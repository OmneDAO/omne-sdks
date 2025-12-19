const typescript = require('rollup-plugin-typescript2');
const resolve = require('rollup-plugin-node-resolve');
const commonjs = require('rollup-plugin-commonjs');
const json = require('@rollup/plugin-json');
const inject = require('@rollup/plugin-inject');
const nodePolyfills = require('rollup-plugin-node-polyfills');

const createTsPlugin = (options = {}) =>
  typescript({
    tsconfig: './tsconfig.json',
    sourceMap: true,
    declaration: options.declaration ?? false,
    declarationDir: './dist',
    useTsconfigDeclarationDir: true,
    clean: options.clean ?? false
  });

module.exports = [
  // CommonJS build for Node.js consumers
  {
    input: 'src/index.node.ts',
    output: {
      file: 'dist/index.cjs.js',
      format: 'cjs',
      sourcemap: true
    },
    plugins: [
      json(),
      createTsPlugin({ declaration: true, clean: true }),
      resolve({
        preferBuiltins: true
      }),
      commonjs()
    ],
    external: ['crypto', 'fs', 'path', 'os', 'ws', 'node-fetch']
  },
  // Native ESM build for Node.js (tree-shake friendly)
  {
    input: 'src/index.node.ts',
    output: {
      file: 'dist/index.esm.js',
      format: 'esm',
      sourcemap: true
    },
    plugins: [
      json(),
      createTsPlugin(),
      resolve({
        preferBuiltins: true
      }),
      commonjs()
    ],
    external: ['crypto', 'fs', 'path', 'os', 'ws', 'node-fetch']
  },
  // Browser-focused ESM build with polyfills
  {
    input: 'src/index.browser.ts',
    output: {
      file: 'dist/index.browser.js',
      format: 'esm',
      sourcemap: true
    },
    plugins: [
      json(),
      createTsPlugin(),
      nodePolyfills(),
      inject({
        Buffer: ['buffer', 'Buffer'],
        process: 'process'
      }),
      resolve({
        browser: true,
        preferBuiltins: false
      }),
      commonjs()
    ],
    external: ['ws', 'node-fetch']
  },
  // CLI build for runtime verification tooling
  {
    input: 'src/cli/verify-runtime.ts',
    output: {
      file: 'dist/cli/verify-runtime.cjs',
      format: 'cjs',
      sourcemap: true,
      banner: '#!/usr/bin/env node'
    },
    plugins: [
      json(),
      createTsPlugin(),
      resolve({
        preferBuiltins: true
      }),
      commonjs()
    ],
    external: ['crypto', 'fs', 'path']
  }
];
