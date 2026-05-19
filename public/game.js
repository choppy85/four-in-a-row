const socket = io();
let myIndex = -1;
let isSpectator = false;
let firstChoice = 'me';

function showPage(id) {
  document.getElementById('page-lobby').classList.remove('active');
  document.getElementById('page-waiting').classList.remove('active');
  document.getElementById('page-game').classList.remove('active');
  document.getElementById(id).classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
  showPage('page-lobby');
});

// ── Who goes first ────────────────────────────────────────────

function selectFirst(choice) {
  firstChoice = choice;
  document.getElementById('first-me').classList.toggle('active', choice === 'me');
  document.getElementById('first-them').classList.toggle('active', choice === 'them');
}

// ── Lobby ─────────────────────────────────────────────────────

function createRoom() {
  const name = document.getElementById('name-input').value.trim();
  if (!name) return alert('Enter your name');
  const firstTurn = firstChoice === 'me' ? 0 : 1;
  socket.emit('create_room', { name, firstTurn });
}

function joinRoom(asSpectator) {
  const name = document.getElementById('name-input').value.trim();
  const roomId = document.getElementById('room-code').value.trim().toUpperCase();
  if (!name) return alert('Enter your name first');
  if (!roomId) return alert('Enter a room code');
  document.getElementById('join-btn').disabled = true;
  document.getElementById('watch-btn').disabled = true;
  socket.emit('join_room', { roomId, name, asSpectator });
}

// ── Socket events ─────────────────────────────────────────────

socket.on('room_created', ({ roomId }) => {
  myIndex = 0;
  console.log('I am player 0 (creator)');
  document.getElementById('room-code-display').textContent = roomId;
  showPage('page-waiting');
});

socket.on('you_are_spectator', () => {
  isSpectator = true;
  showPage('page-game');
  setStatus('Watching...');
});

socket.on('game_start', ({ players, firstTurn }) => {
  if (myIndex === -1) {
    myIndex = 1;
    console.log('I am player 1 (joiner)');
  }
  console.log('game_start — myIndex:', myIndex, 'firstTurn:', firstTurn);

  document.getElementById('label-p0').textContent = '🔴 ' + players[0];
  document.getElementById('label-p1').textContent = '🟡 ' + players[1];

  // Hide rematch — new game starting
  document.getElementById('rematch-area').classList.remove('visible');
  document.getElementById('rematch-status').textContent = '';
  document.getElementById('rematch-btn').disabled = false;

  showPage('page-game');
  const isMyTurn = firstTurn === myIndex;
  setStatus(isMyTurn ? '🎯 Your turn first!' : `${players[firstTurn]} goes first!`);
});


socket.on('game_state', (room) => {
  if (room.board) renderBoard(room.board);
  if (room.status === 'playing' && room.players.length === 2) {
    const whose = room.players[room.currentTurn]?.name;
    const isMyTurn = room.currentTurn === myIndex;
    if (whose) setStatus(isMyTurn ? '🎯 Your turn' : `${whose}'s turn`);
  }
});

socket.on('game_over', ({ winner, winnerIndex }) => {
  console.log('game_over — winner:', winner, 'winnerIndex:', winnerIndex, 'myIndex:', myIndex);

  if (winner) {
    const isMe = winnerIndex === myIndex;
    setStatus(isMe ? '🏆 You win!' : `🏆 ${winner} wins!`);
  } else {
    setStatus("🤝 It's a draw!");
  }

  if (!isSpectator) {
    document.getElementById('rematch-area').classList.add('visible');
    document.getElementById('rematch-btn').disabled = false;
    document.getElementById('rematch-status').textContent = '';
    console.log('Rematch button shown for player', myIndex);
  }
});

socket.on('rematch_vote', ({ votes, voterIndex }) => {
  console.log('rematch_vote received — votes so far:', votes, 'voterIndex:', voterIndex, 'myIndex:', myIndex);
  if (voterIndex === myIndex) {
    // I was the one who voted — disable my button
    document.getElementById('rematch-btn').disabled = true;
    document.getElementById('rematch-status').textContent = 'Waiting for opponent...';
  } else {
    // Opponent voted — keep my button enabled, show message
    document.getElementById('rematch-status').textContent = 'Opponent wants a rematch!';
  }
});

socket.on('player_left', () => {
  setStatus('The other player left.');
  document.getElementById('rematch-area').classList.remove('visible');
});

socket.on('error', (msg) => {
  alert(msg);
  document.getElementById('join-btn').disabled = false;
  document.getElementById('watch-btn').disabled = false;
});

// ── Rematch ───────────────────────────────────────────────────

function voteRematch() {
  console.log('Voting rematch as player', myIndex);
  socket.emit('vote_rematch');
  document.getElementById('rematch-btn').disabled = true;
  document.getElementById('rematch-status').textContent = 'Waiting for opponent...';
}

// ── Board ─────────────────────────────────────────────────────

function renderBoard(board) {
  const el = document.getElementById('board');
  el.innerHTML = '';
  board.forEach((row, r) => {
    row.forEach((cell, c) => {
      const slot = document.createElement('div');
      slot.className = 'cell';
      if (cell === 'R') slot.classList.add('red');
      if (cell === 'Y') slot.classList.add('yellow');
      if (!isSpectator) slot.addEventListener('click', () => drop(c));
      el.appendChild(slot);
    });
  });
}

function drop(col) {
  socket.emit('drop_piece', { col });
}

function setStatus(msg) {
  document.getElementById('status-bar').textContent = msg;
}