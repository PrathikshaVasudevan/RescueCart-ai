/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'rescuecart-tests-'));
const files = [
  'lib/paypal.ts',
  'lib/checkout-lifecycle.ts',
  'lib/dashboard-data.ts',
  'lib/payment-analysis.ts',
  'lib/recovery-auth.ts',
  'tests/checkout-lifecycle.test.ts',
  'tests/dashboard-data.test.ts',
  'tests/payment-analysis.test.ts',
  'tests/paypal-diagnostics.test.ts',
  'tests/public-access.test.ts',
  'proxy.ts',
];

try {
  for (const relative of files) {
    const sourcePath = path.join(root, relative);
    const source = fs.readFileSync(sourcePath, 'utf8');
    const result = ts.transpileModule(source, {
      fileName: sourcePath,
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        strict: true,
      },
    });
    const errors = (result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
    if (errors.length) {
      for (const item of errors) console.error(ts.flattenDiagnosticMessageText(item.messageText, '\n'));
      process.exitCode = 1;
      break;
    }
    const destination = path.join(output, relative.replace(/\.ts$/, '.js'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, result.outputText, 'utf8');
  }

  if (process.exitCode !== 1) {
    const testPaths = ['checkout-lifecycle.test.js', 'dashboard-data.test.js', 'payment-analysis.test.js', 'paypal-diagnostics.test.js', 'public-access.test.js']
      .map((name) => path.join(output, 'tests', name));
    const nodePath = [path.join(root, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
    const result = spawnSync(process.execPath, ['--test', ...testPaths], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, NODE_PATH: nodePath },
    });
    process.exitCode = result.status ?? 1;
  }
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
