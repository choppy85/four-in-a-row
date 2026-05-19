const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

function makeBoard() {
  return Array(6).fill(null).map(() => Array(7).fill(null));
}

function checkWin(board, player) {
  const rows = 6, cols = 7;
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] !== player) continue;
      for (const [dr, dc] of dirs) {
        let count = 1;
        for (let i = 1; i < 4; i++) {
          const nr = r + dr*i, nc = c + dc*i;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) break;
          if (board[nr][nc] !== player) break;
          count++;
        }
        if (count === 4) return true;
      }
    }
  }
  return false;
}

function dropPiece(board, col, player) {
  for (let r = 5; r >= 0; r--) {
    if (!board[r][col]) { board[r][col] = player; return r; }
  }
  return -1;
}

function initRoom(roomId) {
  const room = rooms[roomId];
  room.board = makeBoard();
  room.status = 'playing';
  room.currentTurn = room.firstTurn;
  room.rematchVotes = [];
  io.to(roomId).emit('game_state', room);
  io.to(roomId).emit('game_start', {
    players: room.players.map(p => p.name),
    firstTurn: room.firstTurn
  });
}

io.on('connection', (socket) => {
  socket.data.playerIndex = -1;
  socket.data.roomId = null;

  // ── Create room ──────────────────────────────────────────────
  socket.on('create_room', ({ name, firstTurn }) => {
    const roomId = Math.random().toString(36).slice(2, 7).toUpperCase();
    const ft = (firstTurn === 0 || firstTurn === 1) ? firstTurn : 0;
    rooms[roomId] = {
      board: makeBoard(),
      players: [{ id: socket.id, name }],
      currentTurn: ft,
      firstTurn: ft,
      spectators: [],
      status: 'waiting',
      rematchVotes: []
    };
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerIndex = 0;
    console.log(`Room ${roomId} created by ${name} — socket ${socket.id} is player 0`);
    socket.emit('room_created', { roomId });
  });

  // ── Join room ─────────────────────────────────────────────────
  socket.on('join_room', ({ roomId, name, asSpectator }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('error', 'Room not found');

    socket.join(roomId);
    socket.data.roomId = roomId;

    if (!asSpectator && room.players.length < 2) {
      room.players.push({ id: socket.id, name });
      socket.data.playerIndex = 1;
      console.log(`${name} joined room ${roomId} — socket ${socket.id} is player 1`);
      initRoom(roomId);
    } else {
      socket.data.playerIndex = -1;
      room.spectators.push({ id: socket.id, name });
      socket.emit('game_state', room);
      socket.emit('you_are_spectator');
    }
  });

  // ── Drop piece ───────────────────────────────────────────────
  socket.on('drop_piece', ({ col }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;

    const playerIndex = socket.data.playerIndex;
    if (playerIndex !== room.currentTurn) return;

    const player = playerIndex === 0 ? 'R' : 'Y';
    const row = dropPiece(room.board, col, player);
    if (row === -1) return;

    if (checkWin(room.board, player)) {
      room.status = 'finished';
      io.to(roomId).emit('game_state', room);
      io.to(roomId).emit('game_over', {
        winner: room.players[playerIndex].name,
        winnerIndex: playerIndex
      });
      return;
    }

    if (!room.board.flat().includes(null)) {
      room.status = 'finished';
      io.to(roomId).emit('game_state', room);
      io.to(roomId).emit('game_over', { winner: null });
      return;
    }

    room.currentTurn = 1 - room.currentTurn;
    io.to(roomId).emit('game_state', room);
  });

  // ── Rematch vote ─────────────────────────────────────────────
  socket.on('vote_rematch', () => {
  const roomId = socket.data.roomId;
  const room = rooms[roomId];
  if (!room || room.status !== 'finished') return;

  const playerIndex = socket.data.playerIndex;
  console.log(`Rematch vote from socket ${socket.id} — playerIndex: ${playerIndex}`);

  if (playerIndex < 0) return;
  if (room.rematchVotes.includes(playerIndex)) {
    console.log(`Player ${playerIndex} already voted — ignoring`);
    return;
  }

  room.rematchVotes.push(playerIndex);
  console.log(`Votes so far: ${JSON.stringify(room.rematchVotes)}`);

  if (room.rematchVotes.length === 2) {
    console.log('Both voted — starting rematch');
    room.firstTurn = 1 - room.firstTurn;
    // rematchVotes reset happens inside initRoom
    initRoom(roomId);
  } else {
    // Only emit vote count if we still need more votes
    io.to(roomId).emit('rematch_vote', { votes: room.rematchVotes.length, voterIndex: playerIndex });
  }
});

  // ── Disconnect ───────────────────────────────────────────────
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    if (socket.data.playerIndex >= 0) {
      rooms[roomId].status = 'finished';
      io.to(roomId).emit('player_left');
    }
  });

});

server.listen(process.env.PORT || 3000, () =>
  console.log('Server running at http://localhost:3000')
);