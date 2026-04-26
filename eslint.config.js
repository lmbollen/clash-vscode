const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/naming-convention': ['warn',
        // Baseline: identifiers are camelCase.
        { selector: 'default', format: ['camelCase'] },
        // Variables may also be UPPER_CASE (module-level constants)
        // or PascalCase (re-exported classes/types).
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        // Class members — private backing fields conventionally carry a
        // leading underscore.
        { selector: 'memberLike', format: ['camelCase'], leadingUnderscore: 'allow' },
        // readonly class members and enum members can be UPPER_CASE constants.
        { selector: 'memberLike', modifiers: ['readonly'], format: ['camelCase', 'UPPER_CASE'], leadingUnderscore: 'allow' },
        { selector: 'enumMember', format: ['UPPER_CASE', 'PascalCase'] },
        // Imports may be PascalCase (classes, types) or camelCase (functions).
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
        // Types (classes, interfaces, type aliases) are PascalCase.
        { selector: 'typeLike', format: ['PascalCase'] },
        // Property names that require quotes (kebab-case binary names like
        // "nextpnr-ecp5", string keys with special characters) are exempt.
        {
          selector: ['objectLiteralProperty', 'typeProperty'],
          modifiers: ['requiresQuotes'],
          format: null,
        },
        // Yosys internal cell types (e.g. "$_AND_", "$_MUX_", "$add") appear
        // as keys in netlist/stat JSON blobs we round-trip through.  They
        // pass as valid JS identifiers so `requiresQuotes` doesn't match
        // them — exempt the "$-prefixed" namespace explicitly.
        {
          selector: ['objectLiteralProperty', 'typeProperty'],
          filter: { regex: '^\\$', match: true },
          format: null,
        },
        // External schemas we mirror:
        //   - snake_case: Clash manifest JSON fields, Yosys stat-json keys
        //   - UPPER_CASE: FPGA primitive cell-type names (TRELLIS_FF,
        //     SB_LUT4, DP16KD, ...)
        //   - PascalCase: DigitalJS/nextpnr keys like `DP16KD` fall under
        //     UPPER_CASE; nothing extra needed here.
        {
          selector: ['objectLiteralProperty', 'typeProperty'],
          format: ['camelCase', 'snake_case', 'UPPER_CASE'],
        },
      ],
      'curly': 'warn',
      'eqeqeq': 'warn',
      'no-throw-literal': 'warn',
      'semi': ['warn', 'always'],
    },
  },
  {
    ignores: ['out/**', 'dist/**', '**/*.d.ts', 'node_modules/**'],
  },
];
