import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Markdown image snippets use original filename as alt text', async () => {
		const { ResourceFileLoader } = await import('../loader.mjs');
		const loader = new ResourceFileLoader('markdown');
		const file = {
			mime: 'image/png',
			name: 'generated-name',
			extension: 'png',
			originalName: 'Screen Shot ]',
			originalExtension: 'heic',
			data: Buffer.from([])
		};

		assert.strictEqual(
			loader.generateSnippet(file, 'https://example.com/generated-name.png'),
			'![Screen Shot \\].heic](https://example.com/generated-name.png)'
		);
	});

	test('Non-Markdown image snippets keep configured snippet behavior', async () => {
		const { ResourceFileLoader } = await import('../loader.mjs');
		const loader = new ResourceFileLoader('plaintext');
		const file = {
			mime: 'image/png',
			name: 'generated-name',
			extension: 'png',
			originalName: 'photo',
			originalExtension: 'jpg',
			data: Buffer.from([])
		};

		assert.strictEqual(
			loader.generateSnippet(file, 'https://example.com/generated-name.png'),
			'https://example.com/generated-name.png'
		);
	});
});
