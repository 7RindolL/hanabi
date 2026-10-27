import { currentScore, suitsFor } from './engine.mjs';

const visible = card => ({ id: card.id, suit: card.suit, rank: card.rank, knowledge: card.knowledge });
const hidden = card => ({ id: card.id, knowledge: card.knowledge });
/** Never send the viewer's card ranks, suits, deck order, or other players' private credentials. */
export function playerView(room, viewerId) {
  const game = room.game;
  return {
    roomCode: room.code, mode: room.mode, phase: game?.phase ?? 'lobby',
    you: viewerId, hostId: room.hostId,
    players: room.players.map(p => ({
      id: p.id, name: p.name, online: Boolean(p.socketId),
      hand: p.hand.map(card => game?.phase === 'finished' || p.id !== viewerId ? visible(card) : hidden(card))
    })),
    ...(game ? {
      hints: game.hints, strikes: game.strikes, deckCount: game.deck.length,
      stacks: game.stacks, suits: suitsFor(room.mode), turn: game.turn,
      turnNumber: game.turnNumber, remainingFinalTurns: game.remainingFinalTurns,
      discards: game.discards, score: game.phase === 'finished' ? game.finalScore : currentScore(game),
      reason: game.reason, maxScore: suitsFor(room.mode).length * 5
    } : {}),
    history: room.history.slice(-150), chat: room.chat.slice(-100)
  };
}
