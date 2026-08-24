import fs from 'fs';
import path from 'path';
import assert from 'assert';
import test from 'node:test';

test('MiraiLens Production Release Hardening Tests', async (suite) => {

  await suite.test('1. Version Consistency validation', async () => {
    // Read package.json
    const packageJSON = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    const canonicalVersion = packageJSON.version;
    assert.ok(canonicalVersion, 'package.json version must exist');

    // Verify manifest.json
    const manifestJSON = JSON.parse(fs.readFileSync(path.resolve('extension/manifest.json'), 'utf8'));
    assert.strictEqual(manifestJSON.version, canonicalVersion, 'Extension manifest version must match package.json');

    // Verify background.js version string
    const bgContent = fs.readFileSync(path.resolve('extension/background.js'), 'utf8');
    assert.ok(bgContent.includes(`version: '${canonicalVersion}'`) || bgContent.includes(`version: "${canonicalVersion}"`), 'background.js handshake must declare canonical version');

    // Verify popup.html version display
    const popupHtml = fs.readFileSync(path.resolve('extension/popup.html'), 'utf8');
    assert.ok(popupHtml.includes(`v${canonicalVersion}`), 'popup.html must display canonical version');

    // Verify options.html version display
    const optionsHtml = fs.readFileSync(path.resolve('extension/options.html'), 'utf8');
    assert.ok(optionsHtml.includes(`v${canonicalVersion}`), 'options.html must display canonical version');

    // Verify history.html version display
    const historyHtml = fs.readFileSync(path.resolve('extension/history.html'), 'utf8');
    assert.ok(historyHtml.includes(`v${canonicalVersion}`), 'history.html must display canonical version');
  });

  await suite.test('2. Package configuration and CLI binaries', async () => {
    const packageJSON = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));

    // Check executable mappings in bin
    assert.ok(packageJSON.bin, 'package.json bin field must exist');
    assert.strictEqual(packageJSON.bin['mirailens'], 'dist/index.js', 'mirailens mapping must point to dist/index.js');
    assert.strictEqual(packageJSON.bin['mcp-server-mirailens'], 'dist/index.js', 'mcp-server-mirailens mapping must point to dist/index.js');

    // Check custom license matches
    assert.strictEqual(packageJSON.license, 'SEE LICENSE IN LICENSE', 'License field must point to LICENSE file');
  });

  await suite.test('3. CLI entry shebang check', async () => {
    const srcIndex = fs.readFileSync(path.resolve('src/index.ts'), 'utf8');
    assert.ok(srcIndex.startsWith('#!/usr/bin/env node'), 'src/index.ts must start with node shebang');
  });

  await suite.test('4. Required extension structure check', async () => {
    const files = fs.readdirSync(path.resolve('extension'));
    assert.ok(files.includes('manifest.json'), 'extension must contain manifest.json');
    assert.ok(files.includes('background.js'), 'extension must contain background.js');
    assert.ok(files.includes('popup.html'), 'extension must contain popup.html');
    assert.ok(files.includes('options.html'), 'extension must contain options.html');
    assert.ok(files.includes('history.html'), 'extension must contain history.html');
  });

});
