const socket = io();
let myIndex = -1;
let isSpectator = false;
let firstChoice = 'me';
let currentRoomId = null;
let undosLeft = [3, 3];
let wins = [0, 0];
let prevBoardState = null;

// ── Sounds ────────────────────────────────────────────────────

let audioCtx = null;
function getAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { console.warn('Audio not available'); }
  }
  return audioCtx;
}

function playDropSound() {
  const ctx = getAudio();
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(220, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.15);
  g.gain.setValueAtTime(0.3, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.2);
}

function playWinSound() {
  const ctx = getAudio();
  if (!ctx) return;
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((freq, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    const start = ctx.currentTime + i * 0.12;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start(start);
    o.stop(start + 0.5);
  });
}

// ── Pages ─────────────────────────────────────────────────────

function showPage(id) {
  document.getElementById('page-lobby').classList.remove('active');
  document.getElementById('page-waiting').classList.remove('active');
  document.getElementById('page-game').classList.remove('active');
  document.getElementById(id).classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
  showPage('page-lobby');
  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get('room');
  if (roomFromUrl) {
    document.getElementById('room-code').value = roomFromUrl.toUpperCase();
    document.getElementById('lobby-status').textContent =
      `Joining room ${roomFromUrl.toUpperCase()} — enter your name and click Join`;
  }
});

// ── Connection status ─────────────────────────────────────────

socket.on('connect', () => {
  console.log('[SOCKET] connected', socket.id);
  document.getElementById('conn-status').className = 'conn-good';
  document.getElementById('conn-status').title = 'Connected';
});
socket.on('disconnect', (reason) => {
  console.warn('[SOCKET] disconnected:', reason);
  document.getElementById('conn-status').className = 'conn-bad';
  document.getElementById('conn-status').title = 'Disconnected: ' + reason;
});
socket.on('connect_error', (err) => {
  console.error('[SOCKET] connect error:', err.message);
  document.getElementById('conn-status').className = 'conn-bad';
});

// ── Lobby ─────────────────────────────────────────────────────

function selectFirst(choice) {
  firstChoice = choice;
  document.getElementById('first-me').classList.toggle('active', choice === 'me');
  document.getElementById('first-them').classList.toggle('active', choice === 'them');
}

function createRoom() {
  const name = document.getElementById('name-input').value.trim();
  if (!name) return alert('Enter your name');
  getAudio();
  const firstTurn = firstChoice === 'me' ? 0 : 1;
  socket.emit('create_room', { name, firstTurn });
}

function joinRoom(asSpectator) {
  const name = document.getElementById('name-input').value.trim();
  const roomId = document.getElementById('room-code').value.trim().toUpperCase();
  if (!name) return alert('Enter your name first');
  if (!roomId) return alert('Enter a room code');
  getAudio();
  document.getElementById('join-btn').disabled = true;
  document.getElementById('watch-btn').disabled = true;
  socket.emit('join_room', { roomId, name, asSpectator });
}

function copyInviteLink() {
  const url = `${window.location.origin}?room=${currentRoomId}`;
  navigator.clipboard.writeText(url).then(() => {
    document.getElementById('copy-status').textContent = '✓ Link copied!';
    setTimeout(() => {
      document.getElementById('copy-status').textContent = '';
    }, 2000);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    document.getElementById('copy-status').textContent = '✓ Link copied!';
    setTimeout(() => {
      document.getElementById('copy-status').textContent = '';
    }, 2000);
  });
}

// ── Game events ───────────────────────────────────────────────

socket.on('room_created', ({ roomId }) => {
  myIndex = 0;
  currentRoomId = roomId;
  console.log('I am player 0 (creator), room', roomId);
  document.getElementById('room-code-display').textContent = roomId;
  showPage('page-waiting');
});

socket.on('you_are_spectator', () => {
  isSpectator = true;
  showPage('page-game');
  setStatus('Watching...');
  document.getElementById('undo-area').style.display = 'none';
});

socket.on('game_start', ({ players, firstTurn, wins: serverWins }) => {
  if (myIndex === -1) {
    myIndex = 1;
    console.log('I am player 1 (joiner)');
  }
  console.log('game_start — myIndex:', myIndex, 'firstTurn:', firstTurn);

  if (serverWins) wins = serverWins;
  document.getElementById('label-p0').textContent = '🔴 ' + players[0];
  document.getElementById('label-p1').textContent = '🟡 ' + players[1];
  updateScoreboard();
  document.getElementById('rematch-area').classList.remove('visible');
  document.getElementById('rematch-status').textContent = '';
  document.getElementById('rematch-btn').disabled = false;
  undosLeft = [3, 3];
  updateUndoUI();
  showPage('page-game');

  const isMyTurn = firstTurn === myIndex;
  setStatus(isMyTurn ? '🎯 Your turn first!' : `${players[firstTurn]} goes first!`);
});

socket.on('game_state', (room) => {
  if (room.undosLeft) {
    undosLeft = room.undosLeft;
    updateUndoUI();
  }
  if (room.wins) {
    wins = room.wins;
    updateScoreboard();
  }
  if (room.board) {
    if (prevBoardState && room.lastMove) {
      const prev = prevBoardState[room.lastMove.row]?.[room.lastMove.col];
      const curr = room.board[room.lastMove.row][room.lastMove.col];
      if (prev !== curr) playDropSound();
    }
    prevBoardState = JSON.parse(JSON.stringify(room.board));
    renderBoard(room.board, room.lastMove, room.winningCells);
  }
  if (room.status === 'playing' && room.players.length === 2) {
    const whose = room.players[room.currentTurn]?.name;
    const isMyTurn = room.currentTurn === myIndex;
    if (whose) setStatus(isMyTurn ? '🎯 Your turn' : `${whose}'s turn`);
  }
});

socket.on('game_over', ({ winner, winnerIndex, winningCells, wins: serverWins }) => {
  console.log('game_over —', winner, 'winnerIndex:', winnerIndex);
  if (serverWins) {
    wins = serverWins;
    updateScoreboard();
  }
  if (winner) {
    playWinSound();
    const color = winnerIndex === 0 ? 'red' : 'yellow';
    launchConfetti(color);
    const isMe = winnerIndex === myIndex;
    setStatus(isMe ? '🏆 You win!' : `🏆 ${winner} wins!`);
  } else {
    setStatus("🤝 It's a draw!");
  }
  if (!isSpectator) {
    document.getElementById('rematch-area').classList.add('visible');
    document.getElementById('rematch-btn').disabled = false;
    document.getElementById('rematch-status').textContent = '';
  }
});

socket.on('rematch_vote', ({ votes, voterIndex }) => {
  if (voterIndex === myIndex) {
    document.getElementById('rematch-btn').disabled = true;
    document.getElementById('rematch-status').textContent = 'Waiting for opponent...';
  } else {
    document.getElementById('rematch-status').textContent = 'Opponent wants a rematch!';
  }
});

socket.on('undo_performed', ({ byPlayer, undosLeft: serverUndos }) => {
  undosLeft = serverUndos;
  updateUndoUI();
  const msg = byPlayer === myIndex ? '↶ You undid your move' : '↶ Opponent undid their move';
  setStatus(msg);
});

socket.on('undo_denied', (reason) => {
  alert(reason);
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

// ── Player actions ────────────────────────────────────────────

function voteRematch() {
  socket.emit('vote_rematch');
  document.getElementById('rematch-btn').disabled = true;
  document.getElementById('rematch-status').textContent = 'Waiting for opponent...';
}

function requestUndo() {
  console.log('[UNDO] requesting undo, myIndex:', myIndex);
  socket.emit('undo');
}

function drop(col) {
  console.log('[CLICK] col', col, 'myIndex', myIndex, 'socket.connected:', socket.connected);
  if (!socket.connected) {
    alert('You are disconnected from the server. Refresh the page.');
    return;
  }
  socket.emit('drop_piece', { col });
}

// ── Board ─────────────────────────────────────────────────────

function renderBoard(board, lastMove, winningCells) {
  const el = document.getElementById('board');
  el.innerHTML = '';
  const winSet = new Set((winningCells || []).map(([r,c]) => `${r},${c}`));

  board.forEach((row, r) => {
    row.forEach((cell, c) => {
      const slot = document.createElement('div');
      slot.className = 'cell';
      if (cell === 'R') slot.classList.add('red');
      if (cell === 'Y') slot.classList.add('yellow');
      if (lastMove && lastMove.row === r && lastMove.col === c) {
        slot.classList.add('last-move');
      }
      if (winSet.has(`${r},${c}`)) {
        slot.classList.add('winning');
      }
      if (!isSpectator) slot.addEventListener('click', () => drop(c));
      el.appendChild(slot);
    });
  });
}

function setStatus(msg) {
  document.getElementById('status-bar').textContent = msg;
}

function updateUndoUI() {
  if (isSpectator) {
    document.getElementById('undo-area').style.display = 'none';
    return;
  }
  const myUndos = undosLeft[myIndex] ?? 3;
  document.getElementById('undo-count').textContent = `${myUndos} left`;
  document.getElementById('undo-btn').disabled = myUndos <= 0;
}

function updateScoreboard() {
  document.getElementById('score-p0').textContent = `Wins: ${wins[0]}`;
  document.getElementById('score-p1').textContent = `Wins: ${wins[1]}`;
}

// ── Confetti ──────────────────────────────────────────────────

function launchConfetti(winnerColor) {
  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const palette = winnerColor === 'red'
    ? ['#e74c3c', '#ff6b5b', '#ffaaa5', '#ffffff', '#ffd700']
    : ['#f1c40f', '#ffe45e', '#fff59d', '#ffffff', '#ff9800'];

  const particles = [];
  const count = 150;

  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.5,
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 4,
      size: 6 + Math.random() * 8,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.3,
      color: palette[Math.floor(Math.random() * palette.length)],
      shape: Math.random() > 0.5 ? 'rect' : 'circle'
    });
  }

  const start = Date.now();
  const duration = 3500;

  function animate() {
    const elapsed = Date.now() - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      p.rot += p.vrot;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - elapsed / duration);
      if (p.shape === 'rect') {
        ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.5);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size/2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    if (elapsed < duration) {
      requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  animate();
}