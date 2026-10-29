import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {beginGame, act, knowledge} from '../engine.mjs';
import {playerView} from '../view.mjs';

const client = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const card = (suit, rank, id) => ({ suit, rank, id, knowledge: knowledge() });
function render(room, viewerId) {
  const app = { innerHTML: '' };
  const toast = { textContent: '', classList: {add() {}, remove() {}} };
  const handlers = {};
  const env = {
    document: {querySelector: s => s === '#app' ? app : s === '#toast' ? toast : null, addEventListener() {}},
    io: () => ({on: (event, callback) => { handlers[event] = callback; }, emit() {}}),
    URLSearchParams,
    location: {search: '', pathname: '/', origin: 'http://localhost:3000'},
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: () => 0, clearTimeout() {}
  };
  vm.runInNewContext(client, env);
  handlers.roomState(playerView(room, viewerId));
  return app.innerHTML;
}
test('第三者にも最新ヒントと対象カードが強調され、古いヒントが確定バッジとして残る', () => {
  const players = ['太郎', '花子', '健'].map((name, i) => ({ id: `p${i}`, name, hand: [], socketId: `s${i}` }));
  const game = beginGame(players, 'classic', { turn: 0 });
  players[0].hand = [card('blue', 1, 'b1'), card('white', 2, 'w2'), card('green', 3, 'g3')];
  players[1].hand = [card('red', 1, 'r1'), card('blue', 3, 'b3'), card('red', 4, 'r4'), card('yellow', 2, 'y2')];
  players[2].hand = [card('green', 2, 'g2'), card('yellow', 1, 'y1'), card('white', 2, 'w22')];
  const first = act(game, players, 'p0', { kind: 'clue', targetId: 'p1', clueType: 'color', value: 'red' });
  const second = act(game, players, 'p1', { kind: 'clue', targetId: 'p2', clueType: 'rank', value: 2 });
  const room = {
    code:'ABC123',mode:'classic',hostId:'p0',players,game,chat:[],
    history:[first,second].map((log, i) => ({...log,id:`h${i}`,at:Date.now()}))
  };
  const html = render(room,'p0');
  assert.match(html,/みんなに共有された最新のヒント/);
  assert.match(html,/太郎.*?花子.*?赤色/);
  assert.match(html,/花子.*?健.*?数字2/);
  assert.equal((html.match(/recent-clue-hit/g) || []).length,4); // 2 red + 2 rank2
  assert.equal((html.match(/clue-summary compact/g) || []).length,2);
  assert.equal((html.match(/knowledge-chip/g) || []).length,4);
  const fromTarget = render(room,'p1');
  assert.match(fromTarget,/あなたの手札/);
  assert.match(fromTarget,/💡赤色/);
  const hiddenMatch = fromTarget.match(/class="card back[^>]*>[\s\S]*?<\/button>/);
  assert(hiddenMatch);
  assert(!hiddenMatch[0].includes('class="digit">1'));
});

test('カードが抜かれて詰まっても、強調する対象はカードIDで追跡する', () => {
  const ps = ['A','B'].map((name,i)=>({name,id:`p${i}`,hand:[],socketId:`s${i}`}));
  const game = beginGame(ps,'classic',{turn:0});
  ps[1].hand = [card('red',1,'r1'),card('blue',2,'b2'),card('red',3,'r3')];
  const clue = act(game,ps,'p0',{kind:'clue',targetId:'p1',clueType:'color',value:'red'});
  game.hints = 7;
  act(game,ps,'p1',{kind:'discard',index:1});
  const room = {code:'ABC123',mode:'classic',hostId:'p0',players:ps,game,history:[{...clue,id:'h0',at:Date.now()}],chat:[]};
  const html = render(room,'p0');
  assert.match(html,/現在の対象：1枚目・2枚目/);
  assert.equal((html.match(/recent-clue-hit/g) || []).length,2);
});
