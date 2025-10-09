const typescript = require('rollup-plugin-typescript2');
const resolve = require('rollup-plugin-node-resolve');
const commonjs = require('rollup-plugin-commonjs');
const { terser } = require('rollup-plugin-terser');
const json = require('@rollup/plugin-json');
const pkg = require('./package.json');

module.exports = [
  // CommonJS build (Node.js)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.cjs.js',
      format: 'cjs',
      sourcemap: true,
    },
    plugins: [
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        sourceMap: true,
        declaration: true,
        declarationDir: './dist',
      }),
      resolve({
        preferBuiltins: true,
      }),
      commonjs(),
    ],
    external: ['crypto', 'fs', 'path', 'os', 'ws']
  },
  // ESM build (Browser-compatible)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.esm.js',
      format: 'esm',
      sourcemap: true
    },
    plugins: [
      json(),
      resolve({
        preferBuiltins: false, // Don't prefer Node.js built-ins for browser
        browser: true, // Use browser versions of packages
      }),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        sourceMap: true,
        declaration: true,
        declarationDir: './dist',
        rollupCommonJSResolveHack: true,
        clean: true,
        useTsconfigDeclarationDir: true
      })
    ],
    // External more Node.js specific modules for browser build
    external: [
      'crypto', 'fs', 'path', 'os', 'ws', 
      'assert', 'stream', 'http', 'https', 'url', 'zlib', 'buffer', 'util', 'punycode', 'events'
    ]
  }
];
