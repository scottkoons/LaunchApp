import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import {
  APPEARANCES,
  appearanceBootstrap,
  appearanceKey,
  resolveAppearance,
} from '../lib/appearance';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)';
const desktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

function firstPaint(userAgent: string, values: Record<string, string>) {
  const document = { documentElement: { dataset: { theme: 'space' } } };
  runInNewContext(appearanceBootstrap, {
    navigator: { userAgent },
    document,
    localStorage: { getItem: (key: string) => values[key] ?? null },
  });
  return document.documentElement.dataset.theme;
}

void test('existing iPhones adopt Liquid without changing desktop preferences', () => {
  const saved = { 'launch-theme': 'dark' };
  assert.equal(firstPaint(iphone, saved), 'liquid');
  assert.equal(firstPaint(desktop, saved), 'dark');
  assert.equal(firstPaint('Android', {}), 'space');
  assert.equal(firstPaint('iPad', {}), 'space');
});

void test('every explicit phone choice survives startup and agrees with hydration', () => {
  for (const { value } of APPEARANCES) {
    const saved = { 'launch-theme': 'dark', 'launch-iphone-theme': value };
    assert.equal(firstPaint(iphone, saved), value);
    assert.equal(
      resolveAppearance(iphone, saved[appearanceKey(iphone)]),
      value,
    );
    assert.equal(firstPaint(desktop, saved), 'dark');
  }
  for (const ua of [iphone, desktop]) {
    assert.equal(
      firstPaint(ua, { [appearanceKey(ua)]: 'invalid' }),
      resolveAppearance(ua, 'invalid'),
    );
  }
});

void test('unavailable browser storage still paints the iPhone default', () => {
  const document = { documentElement: { dataset: { theme: 'space' } } };
  runInNewContext(appearanceBootstrap, {
    navigator: { userAgent: iphone },
    document,
    get localStorage() {
      throw new Error('Storage disabled');
    },
  });
  assert.equal(document.documentElement.dataset.theme, 'liquid');
});
