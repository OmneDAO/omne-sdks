const typescript = require('rollup-plugin-typescript2');
const resolve = require('rollup-plugin-node-resolve');
const commonjs = require('rollup-plugin-commonjs');
const { terser } = require('rollup-plugin-terser');
const json = require('@rollup/plugin-json');
const pkg = require('./package.json');

module.exports = [
  // CommonJS build
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
    external: ['crypto', 'fs', 'path', 'os']
  },
  // ESM build
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
        preferBuiltins: true
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
    external: ['crypto', 'fs', 'path', 'os']
  }
];
