import babel from 'rollup-plugin-babel';
import {builtinModules} from 'node:module';
import commonjs from 'rollup-plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import pkg from './package.json';
import replace from '@rollup/plugin-replace';

const external = [
  ...Object.keys(pkg.dependencies),
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`)
];

export default [
  {
    input: './lib/index.js',
    output: [
      {
        dir: 'dist',
        exports: 'named',
        format: 'cjs',
        globals: {
          'node:util': 'util',
        },
        preserveModules: true
      }
    ],
    external,
    plugins: [
      babel({
        babelrc: false,
        runtimeHelpers: true,
        plugins: [
          '@babel/plugin-transform-async-to-generator',
          '@babel/plugin-transform-regenerator',
          ['@babel/plugin-transform-runtime', {
            helpers: true,
            regenerator: true
          }]
        ],
        presets: [
          '@babel/preset-env'
        ],
        exclude: 'node_modules/**'
      }),
      commonjs({
        // polyfill async/await
        'node_modules/babel-runtime/helpers/asyncToGenerator.js': ['default']
      }),
      nodeResolve({
        preferBuiltins: false
      }),
      replace({
        values: {
          'require(\'node:': 'require(\'',
        }
      })
    ]
  }
];
