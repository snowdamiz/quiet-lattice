import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.claude/**',
      '**/dist/**',
      '**/node_modules/**',
      'packages/client/public/**',
      'blender/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['packages/client/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['packages/client/src/terrain/chunkWorker.js'],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    files: ['*.js', 'packages/client/vite.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['**/*.ts'] })),
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
  },
  {
    files: ['packages/{server,tools}/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] },
  },
  {
    files: ['**/*.ts'],
    rules: { '@typescript-eslint/no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] },
  },
  {
    // World generation gives the same bits on every engine (DESIGN 17): its transcendental functions come from
    // packages/shared/src/math/det.ts, never from Math (whose last bits differ between engines), nor from three.js
    // methods and classes that call Math for them. (Math.sqrt, abs, floor, round, min, max, imul and fround are exact.)
    // The meters (heat and Charge) too: the client predicts them with what the server decides them by.
    files: ['packages/shared/src/{world,math,meters}/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh']
          .concat(['exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'pow', 'cbrt', 'hypot'])
          .map((property) => ({
            object: 'Math',
            property,
            message: `Math.${property} differs between engines: use ${property === 'hypot' ? 'hypot2 or hypot3' : property} from math/det.ts.`,
          })),
        { object: 'Math', property: 'random', message: 'World generation draws from its seeds (rng.ts), never Math.random.' },
        ...['setFromAxisAngle', 'angleTo']
          .map((property) => ({ property, message: `three's ${property} calls Math's trigonometry: use ${property} from math/det.ts.` }))
          .concat(
            ['applyAxisAngle', 'setFromEuler', 'applyEuler', 'setFromQuaternion', 'slerp', 'slerpQuaternions', 'rotateTowards', 'random', 'randomDirection']
              .concat([
                'makeRotationX',
                'makeRotationY',
                'makeRotationZ',
                'makeRotationAxis',
                'makeRotationFromEuler',
                'setFromSphericalCoords',
                'setFromCylindricalCoords',
              ])
              .map((property) => ({ property, message: `three's ${property} calls Math's trigonometry (or Math.random): write it with math/det.ts.` })),
          ),
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "BinaryExpression[operator='**']", message: '** differs between engines: use pow from math/det.ts.' },
        { selector: "AssignmentExpression[operator='**=']", message: '**= differs between engines: use pow from math/det.ts.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'three',
              importNames: ['Color', 'Spherical', 'Cylindrical', 'MathUtils'],
              message: "three's colour management and angle helpers call Math.pow and the trigonometry: write them with math/det.ts.",
            },
          ],
        },
      ],
    },
  },
);
