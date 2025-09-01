const typescript = require('rollup-plugin-typescript2');
const resolve = require('rollup-plugin-node-resolve');
const commonjs = require('rollup-plugin-commonjs');
const { terser } = require('rollup-plugin-terser');
const pkg = require('./package.json');

const external = Object.keys(pkg.dependencies || {});

module.exports = [
  // CommonJS build
  {
    input: 'src/index.ts',
    external,
    output: {
      file: pkg.main,
      format: 'cjs',
      sourcemap: true,
      exports: 'named'
    },
    plugins: [
      resolve({
        preferBuiltins: true
      }),
      commonjs(),
      typescript({
        rollupCommonJSResolveHack: true,
        clean: true,
        useTsconfigDeclarationDir: true
      })
    ]
  },
  // ESM build
  {
    input: 'src/index.ts',
    external,
    output: {
      file: pkg.module,
      format: 'esm',
      sourcemap: true
    },
    plugins: [
      resolve({
        preferBuiltins: true
      }),
      commonjs(),
      typescript({
        rollupCommonJSResolveHack: true,
        clean: true,
        useTsconfigDeclarationDir: true
      })
    ]
  }
];
