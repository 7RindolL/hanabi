import { randomInt, randomUUID } from 'node:crypto';

export const COLORS = ['red', 'yellow', 'green', 'blue', 'white'];
export const MODES = ['classic', 'rainbow5', 'rainbow10', 'rainbowWild'];
export const COLOR_NAMES = { red: '赤', yellow: '黄', green: '緑', blue: '青', white: '白', rainbow: '虹' };
const COUNTS = { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1 };

export function suitsFor(mode) {
  if (!MODES.includes(mode)) throw new Error('不明なゲームモードです');
  return mode === 'classic' ? [...COLORS] : [...COLORS, 'rainbow'];
}
export function newDeck(mode = 'classic', random = randomInt) {
  const deck = [];
  for (const suit of suitsFor(mode)) {
    for (let rank = 1; rank <= 5; rank++) {
      const count = suit === 'rainbow' && (mode === 'rainbow5' || mode === 'rainbowWild') ? 1 : COUNTS[rank];
      for (let i = 0; i < count; i++) deck.push({ id: randomUUID(), suit, rank, knowledge: knowledge() });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
export function knowledge() {
  return { yesColors: [], noColors: [], yesRanks: [], noRanks: [] };
}
export function beginGame(players, mode = 'classic', options = {}) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 5) throw new Error('2〜5人で開始してください');
  const deck = options.deck ? structuredClone(options.deck) : newDeck(mode);
  const handSize = players.length <= 3 ? 5 : 4;
  for (const player of players) {
    player.hand = [];
    for (let i = 0; i < handSize; i++) player.hand.push(deck.pop());
  }
  const stacks = Object.fromEntries(suitsFor(mode).map(s => [s, 0]));
  return {
    mode, deck, playerCount: players.length, stacks, discards: [], hints: 8, strikes: 0,
    turn: options.turn ?? randomInt(players.length), remainingFinalTurns: null,
    phase: 'playing', reason: null, turnNumber: 1, finalScore: null
  };
}
function deny(message) { throw new Error(message); }
function matched(card, type, value, mode) {
  if (type === 'rank') return card.rank === value;
  if (mode === 'rainbowWild' && card.suit === 'rainbow' && COLORS.includes(value)) return true;
  return card.suit === value;
}
function noteClue(hand, type, value, mode) {
  const positions = [];
  hand.forEach((card, index) => {
    const hit = matched(card, type, value, mode);
    if (hit) positions.push(index + 1);
    const key = type === 'rank' ? (hit ? 'yesRanks' : 'noRanks') : (hit ? 'yesColors' : 'noColors');
    if (!card.knowledge) card.knowledge = knowledge();
    if (!card.knowledge[key].includes(value)) card.knowledge[key].push(value);
  });
  return positions;
}
export function currentScore(game) { return Object.values(game.stacks).reduce((a, b) => a + b, 0); }
export function gameResult(game) {
  return { finalScore: game.strikes >= 3 ? 0 : currentScore(game), reason: game.reason };
}
function finalize(game, reason) {
  game.phase = 'finished';
  game.reason = reason;
  game.finalScore = game.strikes >= 3 ? 0 : currentScore(game);
}
function replenish(game, actor) {
  if (game.deck.length === 0) return null;
  const card = game.deck.pop();
  actor.hand.push(card);
  if (game.deck.length === 0 && game.remainingFinalTurns === null) game.remainingFinalTurns = game.playerCount;
  return card;
}
/** Actions mutate the server-owned state; client inputs never contain real card data. */
export function act(game, players, playerId, action) {
  if (!game || game.phase !== 'playing') deny('ゲームは進行中ではありません');
  const actorIndex = players.findIndex(p => p.id === playerId);
  if (actorIndex !== game.turn) deny('あなたの手番ではありません');
  const actor = players[actorIndex];
  if (!action || !['play', 'discard', 'clue'].includes(action.kind)) deny('無効な行動です');
  const alreadyFinal = game.remainingFinalTurns !== null;
  let result;
  if (action.kind === 'clue') {
    if (game.hints < 1) deny('ヒントが残っていません');
    const target = players.find(p => p.id === action.targetId);
    if (!target || target.id === actor.id) deny('自分自身にはヒントを出せません');
    if (action.clueType !== 'color' && action.clueType !== 'rank') deny('ヒントの種類が不正です');
    const value = action.clueType === 'rank' ? Number(action.value) : action.value;
    if (action.clueType === 'rank' && (!Number.isInteger(value) || value < 1 || value > 5)) deny('数字は1〜5です');
    const validColors = game.mode === 'rainbow10' || game.mode === 'rainbow5' ? suitsFor(game.mode) : COLORS;
    if (action.clueType === 'color' && !validColors.includes(value)) deny('指定した色は使えません');
    // Empty clues are prohibited: calculate before updating all clue notes.
    if (!target.hand.some(card => matched(card, action.clueType, value, game.mode))) deny('該当カードがないヒントは出せません');
    const indices = noteClue(target.hand, action.clueType, value, game.mode);
    game.hints--;
    result = { kind: 'clue', actor: actor.name, actorId: actor.id, target: target.name, targetId: target.id, clueType: action.clueType, value, indices, cardIds: indices.map(i => target.hand[i - 1].id) };
  } else {
    const index = action.index;
    if (!Number.isInteger(index) || index < 0 || index >= actor.hand.length) deny('カードを選択してください');
    if (action.kind === 'discard' && game.hints === 8) deny('ヒントが8個あるときは捨て札にできません');
    const [card] = actor.hand.splice(index, 1);
    if (action.kind === 'discard') {
      game.discards.push({ suit: card.suit, rank: card.rank });
      game.hints = Math.min(8, game.hints + 1);
      result = { kind: 'discard', actor: actor.name, index: index + 1, suit: card.suit, rank: card.rank };
    } else {
      const success = game.stacks[card.suit] + 1 === card.rank;
      if (success) {
        game.stacks[card.suit] = card.rank;
        if (card.rank === 5) game.hints = Math.min(8, game.hints + 1);
      } else {
        game.strikes++;
        game.discards.push({ suit: card.suit, rank: card.rank });
      }
      result = { kind: 'play', actor: actor.name, index: index + 1, suit: card.suit, rank: card.rank, success };
    }
    if (game.strikes < 3 && currentScore(game) < suitsFor(game.mode).length * 5) replenish(game, actor);
  }
  game.turnNumber++;
  if (game.strikes >= 3) finalize(game, 'strikes');
  else if (currentScore(game) === suitsFor(game.mode).length * 5) finalize(game, 'perfect');
  else if (alreadyFinal && --game.remainingFinalTurns <= 0) finalize(game, 'lastRound');
  if (game.phase === 'playing') game.turn = (game.turn + 1) % players.length;
  return result;
}
