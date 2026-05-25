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
        const cells = [[r,c]];
        for (let i = 1; i < 4; i++) {
          const nr = r + dr*i, nc = c + dc*i;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) break;
          if (board[nr][nc] !== player) break;
          cells.push([nr, nc]);
        }
        if (cells.length === 4) return cells;
      }
    }
  }
  return null;
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
  room.lastMove = null;
  room.winningCells = null;
  room.moveHistory = [];
  room.undosLeft = [3, 3];
  io.to(roomId).emit('game_state', room);
  io.to(roomId).emit('game_start', {
    players: room.players.map(p => p.name),
    firstTurn: room.firstTurn,
    wins: room.wins
  });
  console.log(`[${roomId}] Game started — firstTurn: ${room.firstTurn}`);
}

io.on('connection', (socket) => {
  console.log(`[CONNECT] socket ${socket.id}`);
  socket.data.playerIndex = -1;
  socket.data.roomId = null;

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
      rematchVotes: [],
      lastMove: null,
      winningCells: null,
      moveHistory: [],
      undosLeft: [3, 3],
      wins: [0, 0]
    };
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerIndex = 0;
    console.log(`[${roomId}] Created by ${name} — socket ${socket.id} = player 0`);
    socket.emit('room_created', { roomId });
  });

  socket.on('join_room', ({ roomId, name, asSpectator }) => {
    const room = rooms[roomId];
    if (!room) {
      console.log(`[JOIN FAIL] socket ${socket.id} tried ${roomId} — not found`);
      return socket.emit('error', 'Room not found');
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    if (!asSpectator && room.players.length < 2) {
      room.players.push({ id: socket.id, name });
      socket.data.playerIndex = 1;
      console.log(`[${roomId}] ${name} joined — socket ${socket.id} = player 1`);
      initRoom(roomId);
    } else {
      socket.data.playerIndex = -1;
      room.spectators.push({ id: socket.id, name });
      console.log(`[${roomId}] ${name} watching — socket ${socket.id}`);
      socket.emit('game_state', room);
      socket.emit('you_are_spectator');
    }
  });

  socket.on('rejoin_room', ({ roomId, playerIndex }) => {
    const room = rooms[roomId];
    if (!room) {
      console.log(`[REJOIN FAIL] socket ${socket.id} room ${roomId} not found`);
      return socket.emit('error', 'Room no longer exists');
    }
    socket.join(roomId);
    socket.data.roomId = roomId;

    // Reclaim player slot if the client says it owned one
    if ((playerIndex === 0 || playerIndex === 1) && room.players[playerIndex]) {
      room.players[playerIndex].id = socket.id;
      socket.data.playerIndex = playerIndex;
      if (room.disconnectTimers && room.disconnectTimers[playerIndex]) {
        clearTimeout(room.disconnectTimers[playerIndex]);
        delete room.disconnectTimers[playerIndex];
      }
      console.log(`[${roomId}] socket ${socket.id} re-attached as player ${playerIndex}`);
      io.to(roomId).emit('player_reconnected', { playerIndex });
    } else {
      socket.data.playerIndex = -1;
      console.log(`[${roomId}] socket ${socket.id} re-attached as spectator`);
    }

    socket.emit('game_state', room);
  });

  socket.on('drop_piece', ({ col }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    const playerIndex = socket.data.playerIndex;

    console.log(`[DROP] socket ${socket.id} room ${roomId} player ${playerIndex} col ${col}`);

    if (!room) { console.log('  → no room'); return; }
    if (room.status !== 'playing') { console.log(`  → status is ${room.status}, ignoring`); return; }
    if (playerIndex !== room.currentTurn) {
      console.log(`  → not your turn (currentTurn=${room.currentTurn})`);
      return;
    }

    const player = playerIndex === 0 ? 'R' : 'Y';
    const row = dropPiece(room.board, col, player);
    if (row === -1) { console.log('  → column full'); return; }

    room.moveHistory.push({ row, col, player, playerIndex });
    room.lastMove = { row, col, player };
    console.log(`  → placed at row ${row} col ${col}`);

    const winningCells = checkWin(room.board, player);
    if (winningCells) {
      room.status = 'finished';
      room.winningCells = winningCells;
      room.wins[playerIndex]++;
      io.to(roomId).emit('game_state', room);
      io.to(roomId).emit('game_over', {
        winner: room.players[playerIndex].name,
        winnerIndex: playerIndex,
        winningCells,
        wins: room.wins
      });
      console.log(`[${roomId}] ${room.players[playerIndex].name} won — score: ${room.wins[0]}-${room.wins[1]}`);
      return;
    }

    if (!room.board.flat().includes(null)) {
      room.status = 'finished';
      io.to(roomId).emit('game_state', room);
      io.to(roomId).emit('game_over', { winner: null, wins: room.wins });
      return;
    }

    room.currentTurn = 1 - room.currentTurn;
    io.to(roomId).emit('game_state', room);
  });

  socket.on('undo', () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.status !== 'playing') return;

    const playerIndex = socket.data.playerIndex;
    if (playerIndex < 0) return;

    if (room.moveHistory.length === 0) {
      console.log(`[${roomId}] Undo failed — no moves`);
      return;
    }

    const lastMove = room.moveHistory[room.moveHistory.length - 1];

    if (lastMove.playerIndex !== playerIndex) {
      console.log(`[${roomId}] Undo denied — player ${playerIndex} tried to undo player ${lastMove.playerIndex}'s move`);
      socket.emit('undo_denied', 'You can only undo your own last move');
      return;
    }

    if (room.undosLeft[playerIndex] <= 0) {
      console.log(`[${roomId}] Undo denied — player ${playerIndex} has no undos left`);
      socket.emit('undo_denied', 'No undos remaining');
      return;
    }

    room.board[lastMove.row][lastMove.col] = null;
    room.moveHistory.pop();
    room.undosLeft[playerIndex]--;
    room.currentTurn = playerIndex;
    room.lastMove = room.moveHistory.length > 0
      ? room.moveHistory[room.moveHistory.length - 1]
      : null;

    console.log(`[${roomId}] Player ${playerIndex} undid move — undos left: ${room.undosLeft[playerIndex]}`);

    io.to(roomId).emit('game_state', room);
    io.to(roomId).emit('undo_performed', {
      byPlayer: playerIndex,
      undosLeft: room.undosLeft
    });
  });

  socket.on('vote_rematch', () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || room.status !== 'finished') return;

    const playerIndex = socket.data.playerIndex;
    if (playerIndex < 0 || room.rematchVotes.includes(playerIndex)) return;

    room.rematchVotes.push(playerIndex);
    console.log(`[${roomId}] Rematch vote from player ${playerIndex} — votes: ${JSON.stringify(room.rematchVotes)}`);

    if (room.rematchVotes.length === 2) {
      room.firstTurn = 1 - room.firstTurn;
      initRoom(roomId);
    } else {
      io.to(roomId).emit('rematch_vote', {
        votes: room.rematchVotes.length,
        voterIndex: playerIndex
      });
    }
  });

  socket.on('disconnect', (reason) => {
    const roomId = socket.data.roomId;
    const playerIndex = socket.data.playerIndex;
    console.log(`[DISCONNECT] socket ${socket.id} reason: ${reason} room: ${roomId} player: ${playerIndex}`);
    if (!roomId || !rooms[roomId]) return;
    if (playerIndex < 0) return;

    const room = rooms[roomId];
    io.to(roomId).emit('player_disconnected', { playerIndex });

    // Grace period so mobile browsers (iOS Safari, Android Chrome) can reconnect
    // after backgrounding without the game being ended.
    room.disconnectTimers = room.disconnectTimers || {};
    if (room.disconnectTimers[playerIndex]) clearTimeout(room.disconnectTimers[playerIndex]);
    const disconnectedSocketId = socket.id;
    room.disconnectTimers[playerIndex] = setTimeout(() => {
      const r = rooms[roomId];
      if (!r) return;
      // Only end the game if the player never reclaimed their slot
      if (r.players[playerIndex] && r.players[playerIndex].id === disconnectedSocketId) {
        r.status = 'finished';
        console.log(`[${roomId}] player ${playerIndex} did not reconnect — ending game`);
        io.to(roomId).emit('player_left');
      }
      delete r.disconnectTimers[playerIndex];
    }, 90000);
  });
});

server.listen(process.env.PORT || 3000, () =>
  console.log('Server running at http://localhost:3000')
);