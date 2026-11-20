import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeTitle } from '../src/normalize.mjs';

test('normalizeTitle makes spacing and punctuation differences comparable', () => {
  assert.equal(normalizeTitle('  AI 产品经理：快速入门！ '), 'ai产品经理快速入门');
  assert.equal(normalizeTitle('ＡＩ产品经理 快速入门'), 'ai产品经理快速入门');
});

test('normalizeTitle keeps Chinese letters and numbers', () => {
  assert.equal(normalizeTitle('25K 产品经理（第 4 期）'), '25k产品经理第4期');
});
