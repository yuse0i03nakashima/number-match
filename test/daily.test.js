// デイリーボーナス: 1 日 1 回、連続で Day が進む、途切れると Day 1 に戻る、朝 4 時で日が変わる
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { CONFIG } from '../js/config.js';

const stages = [{ stage: 1, cellsCount: 2, adds: 1, boards: [{ cells: [1, 9] }] }];
const at = (y, m, d, h) => new Date(y, m - 1, d, h, 0, 0).getTime();
const mk = () => new Game(stages, CONFIG, null);

test('その日の最初は受け取れて、同じ日にもう一度は受け取れない', () => {
  const g = mk();
  const s = g.dailyStatus(at(2026, 11, 12, 20));
  assert.equal(s.available, true);
  assert.equal(s.day, 1);
  assert.equal(s.reward, CONFIG.daily.rewards[0]);
  const ev = g.claimDaily(at(2026, 11, 12, 20));
  assert.equal(ev.coins, CONFIG.daily.rewards[0]);
  assert.equal(g.claimDaily(at(2026, 11, 12, 23)), null);
  assert.equal(g.dailyStatus(at(2026, 11, 12, 23)).available, false);
});

test('連続した日は Day が進み、1 日あけると Day 1 に戻る。7 日で一巡する', () => {
  const g = mk();
  for (let k = 0; k < 9; k++) {
    const ev = g.claimDaily(at(2026, 11, 1 + k, 12));
    assert.equal(ev.streak, k + 1);
    assert.equal(ev.day, (k % CONFIG.daily.rewards.length) + 1);
    assert.equal(ev.reward, CONFIG.daily.rewards[k % CONFIG.daily.rewards.length]);
  }
  const ev = g.claimDaily(at(2026, 11, 12, 12));   // 11 日を飛ばした
  assert.equal(ev.streak, 1);
  assert.equal(ev.day, 1);
});

test('日付の区切りは朝 4 時: 夜中の 1 時は前日の続き、朝 5 時から新しい日', () => {
  const g = mk();
  assert.ok(g.claimDaily(at(2026, 11, 12, 22)));
  assert.equal(g.claimDaily(at(2026, 11, 13, 1)), null);
  const ev = g.claimDaily(at(2026, 11, 13, 5));
  assert.equal(ev.day, 2);
  assert.equal(ev.streak, 2);
});
