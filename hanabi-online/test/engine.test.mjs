import test from 'node:test';
import assert from 'node:assert/strict';
import { newDeck, beginGame, act, currentScore, suitsFor, knowledge } from '../engine.mjs';
import { playerView } from '../view.mjs';

function players(n=2) {return Array.from({length:n}, (_,i)=>({id:`id${i}`,name:`Player${i}`,socketId:`s${i}`,hand:[]}));}
function card(suit,rank) {return {id:`${suit}${rank}${Math.random()}`,suit,rank,knowledge:knowledge()};}
function newGame(n=2,mode='classic') {let ps=players(n);let g=beginGame(ps,mode,{turn:0});return {ps,g};}
const C = (g,ps,who,kind,other={}) => act(g,ps,who,{kind,...other});

test('モードごとの山札と色構成は正しい',()=>{
  assert.equal(newDeck('classic').length,50);
  assert.equal(newDeck('rainbow5').length,55);
  assert.equal(newDeck('rainbow10').length,60);
  assert.equal(newDeck('rainbowWild').length,55);
  assert.equal(suitsFor('classic').length,5);
  for(const c of ['red','yellow','green','blue','white']) {
    const cards=newDeck('classic').filter(v=>v.suit===c);
    for(const [r,n] of [[1,3],[2,2],[3,2],[4,2],[5,1]]) assert.equal(cards.filter(v=>v.rank===r).length,n);
  }
});
test('2-3人は5枚 / 4-5人は4枚',()=>{
  for (const n of [2,3,4,5]){
    const {ps,g}=newGame(n);
    assert.equal(ps[0].hand.length,n<=3?5:4);
    assert.equal(g.deck.length,50-n*(n<=3?5:4));
    assert.equal(g.hints,8);assert.equal(g.strikes,0);
  }
});
test('自分の札の数字・色・山札は絶対に通知しない',()=>{
  const {ps,g}=newGame(); const room={code:'ABCDEF',mode:'classic',game:g,players:ps,hostId:'id0',history:[],chat:[]};
  const v=playerView(room,'id0');
  assert(!('deck' in v));
  assert(v.players[0].hand.every(c=>!('rank' in c)&&!('suit' in c)));
  assert(v.players[1].hand.every(c=>'rank' in c&&'suit' in c));
  assert(!('secret' in v.players[0]));
});
test('ヒント：当たり外れ両方を各カードに記録 / 該当なし禁止',()=>{
  const {ps,g}=newGame();
  ps[1].hand=[card('red',1),card('blue',1),card('red',5)];
  const r=C(g,ps,'id0','clue',{targetId:'id1',clueType:'color',value:'red'});
  assert.deepEqual(r.indices,[1,3]);assert.equal(g.hints,7);
  assert.deepEqual(ps[1].hand[0].knowledge.yesColors,['red']);
  assert.deepEqual(ps[1].hand[1].knowledge.noColors,['red']);
  assert.throws(()=>C(g,ps,'id0','clue',{targetId:'id1',clueType:'rank',value:4}),/手番/);
  // Rotate to id0 by taking a normal turn from id1; then reject empty clue.
  C(g,ps,'id1','clue',{targetId:'id0',clueType:'rank',value:ps[0].hand[0].rank});
  assert.throws(()=>C(g,ps,'id0','clue',{targetId:'id1',clueType:'rank',value:4}),/該当カードがない/);
});
test('ヒントが8個なら捨て札不可、捨て札でヒント+1',()=>{
  const {ps,g}=newGame();
  assert.throws(()=>C(g,ps,'id0','discard',{index:0}),/8個/);
  C(g,ps,'id0','clue',{targetId:'id1',clueType:'rank',value:ps[1].hand[0].rank});
  C(g,ps,'id1','discard',{index:0});
  assert.equal(g.hints,8);
});
test('色・数字の一致と虹ワイルドヒント',()=>{
  const {ps,g}=newGame(2,'rainbowWild');
  ps[1].hand=[card('red',3),card('rainbow',2),card('green',1)];
  assert.deepEqual(C(g,ps,'id0','clue',{targetId:'id1',clueType:'color',value:'red'}).indices,[1,2]);
  assert.throws(()=>C(g,ps,'id1','clue',{targetId:'id0',clueType:'color',value:'rainbow'}),/指定した色/);
  assert.equal(g.hints,7);
});
test('正解で花火を積む、5はヒント回復（最大8）',()=>{
  const {ps,g}=newGame();
  ps[0].hand[0]=card('red',1);
  C(g,ps,'id0','clue',{targetId:'id1',clueType:'rank',value:ps[1].hand[0].rank});
  C(g,ps,'id1','clue',{targetId:'id0',clueType:'rank',value:1});
  const action=C(g,ps,'id0','play',{index:0});
  assert(action.success);assert.equal(g.stacks.red,1);assert.equal(currentScore(g),1);
  C(g,ps,'id1','clue',{targetId:'id0',clueType:'rank',value:ps[0].hand[0].rank});
  g.stacks.red=4;ps[0].hand[0]=card('red',5);
  C(g,ps,'id0','play',{index:0});
  assert.equal(g.stacks.red,5);assert.equal(g.hints,6); // 8 - 3 clues + 1 bonus
});
test('3回の失敗でゲーム終了し得点0点',()=>{
  const {ps,g}=newGame();
  g.stacks.red=1;
  for(let i=0;i<3;i++){
    const idx=g.turn;
    ps[idx].hand[0]=card('red',1); // 1 is not the next card
    C(g,ps,ps[idx].id,'play',{index:0});
  }
  assert.equal(g.phase,'finished');assert.equal(g.reason,'strikes');assert.equal(g.finalScore,0);
  assert.equal(g.strikes,3);
});
test('山札最後の1枚が引かれたら、引いた人を含め全員に追加1手番',()=>{
  const {ps,g}=newGame(3);
  g.deck=[card('blue',4)];
  g.hints=3;
  // Draw last card on Player0 turn.
  C(g,ps,'id0','discard',{index:0});
  assert.equal(g.deck.length,0);
  assert.equal(g.remainingFinalTurns,3);
  C(g,ps,'id1','discard',{index:0});assert.equal(g.remainingFinalTurns,2);
  C(g,ps,'id2','discard',{index:0});assert.equal(g.remainingFinalTurns,1);
  C(g,ps,'id0','discard',{index:0});assert.equal(g.phase,'finished');assert.equal(g.reason,'lastRound');
});
test('全花火完成は即時満点で終了する',()=>{
  const {ps,g}=newGame();
  for(const s of Object.keys(g.stacks))g.stacks[s]=5;
  g.stacks.red=4;
  ps[0].hand[0]=card('red',5);
  C(g,ps,'id0','play',{index:0});
  assert.equal(g.phase,'finished');assert.equal(g.reason,'perfect');assert.equal(g.finalScore,25);
});
test('手番以外・自分宛ヒント・不正なカード位置は拒否する',()=>{
  const {ps,g}=newGame();
  assert.throws(()=>C(g,ps,'id1','play',{index:0}),/手番/);
  assert.throws(()=>C(g,ps,'id0','clue',{targetId:'id0',clueType:'rank',value:2}),/自分自身/);
  assert.throws(()=>C(g,ps,'id0','play',{index:999}),/カードを選択/);
});
