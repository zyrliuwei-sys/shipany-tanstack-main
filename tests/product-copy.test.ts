import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SiteFooter } from '../src/components/site-footer';

test('published interface copy and downloadable admin instructions contain no upstream promotion', async () => {
  const messages = JSON.parse(
    await readFile(new URL('../messages/en.json', import.meta.url), 'utf8')
  );
  for (const [key, value] of Object.entries(messages)) {
    assert.doesNotMatch(String(value), /ship\s?any/i, key);
  }
  const skill = await readFile(
    new URL('../.claude/skills/shipany-admin/SKILL.md', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(skill, /ship\s?any/i);
  assert.match(skill, /name: site-admin/);
  const posts = await readdir(
    new URL('../src/content/posts/', import.meta.url)
  );
  assert.equal(
    posts.includes('what-is-shipany.en.mdx'),
    false,
    'the upstream introduction is removed'
  );
  for (const folder of ['posts', 'pages']) {
    const path = new URL(`../src/content/${folder}/`, import.meta.url);
    for (const file of await readdir(path)) {
      if (file.endsWith('.mdx'))
        assert.doesNotMatch(
          await readFile(new URL(file, path), 'utf8'),
          /ship\s?any/i,
          file
        );
    }
  }
});

test('the footer renders the configured product copy without vendor badges or links', () => {
  const html = renderToStaticMarkup(
    createElement(SiteFooter, {
      tagline: 'Your workspace, in one place.',
      copyright: '© 2026 Example App. All rights reserved.',
    })
  );
  assert.match(html, /Example App/);
  assert.doesNotMatch(html, /ship\s?any|Built with/i);
});
