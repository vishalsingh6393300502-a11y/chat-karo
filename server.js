const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 30000,
  pingInterval: 10000
});

app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for the root route (fallback if public/ lookup misses)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
//  GENDER-BASED MATCHING QUEUES
//  waitingUsers.male  → males waiting for a partner
//  waitingUsers.female → females waiting for a partner
// ============================================================
const waitingUsers = { male: [], female: [] };

// socketId → partnerId (active chat pairs)
const connections = {};

// Track online count
let onlineCount = 0;

io.on('connection', (socket) => {
  onlineCount++;
  io.emit('onlineCount', onlineCount);
  console.log(`[+] Connected: ${socket.id} | Online: ${onlineCount}`);

  // ── Start Search ──────────────────────────────────────────
  socket.on('startSearch', ({ name, gender }) => {
    socket.userData = { name: sanitize(name), gender };
    socket.searching = true;
    matchUser(socket);
  });

  // ── Send Message ─────────────────────────────────────────
  socket.on('sendMessage', (message) => {
    const partnerId = connections[socket.id];
    if (partnerId && message && message.trim()) {
      io.to(partnerId).emit('receiveMessage', {
        name: socket.userData.name,
        message: sanitize(message.trim())
      });
    }
  });

  // ── Typing Indicators ────────────────────────────────────
  socket.on('typing', () => {
    const partnerId = connections[socket.id];
    if (partnerId) io.to(partnerId).emit('partnerTyping', socket.userData.name);
  });

  socket.on('stopTyping', () => {
    const partnerId = connections[socket.id];
    if (partnerId) io.to(partnerId).emit('partnerStopTyping');
  });

  // ── Request Photo ────────────────────────────────────────
  socket.on('requestPhoto', () => {
    const partnerId = connections[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('photoRequested', socket.userData.name);
    }
  });

  // ── New Chat ─────────────────────────────────────────────
  socket.on('newChat', () => {
    endCurrentChat(socket, true); // notify partner
    if (socket.userData) {
      matchUser(socket);
    }
  });

  // ── Report ───────────────────────────────────────────────
  socket.on('report', ({ reason }) => {
    const partnerId = connections[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('partnerDisconnected');
      delete connections[partnerId];
    }
    delete connections[socket.id];
    console.log(`[!] Report: ${socket.id} reported for "${reason}"`);
    // After report, put user back in search
    setTimeout(() => {
      if (socket.connected && socket.userData) matchUser(socket);
    }, 500);
  });

  // ── Disconnect ───────────────────────────────────────────
  socket.on('disconnect', () => {
    onlineCount = Math.max(0, onlineCount - 1);
    io.emit('onlineCount', onlineCount);
    endCurrentChat(socket, true);
    removeFromQueue(socket);
    console.log(`[-] Disconnected: ${socket.id} | Online: ${onlineCount}`);
  });
});

// ============================================================
//  MATCHING ALGORITHM
//  80% chance → opposite gender
//  20% chance → same gender (or fallback if no opposite)
// ============================================================
function matchUser(socket) {
  if (!socket.userData) return;

  const { gender } = socket.userData;
  const opposite = gender === 'male' ? 'female' : 'male';

  // Clean stale sockets from queues
  waitingUsers.male   = waitingUsers.male.filter(s => s.connected && !connections[s.id]);
  waitingUsers.female = waitingUsers.female.filter(s => s.connected && !connections[s.id]);

  // Remove self from any queue first
  removeFromQueue(socket);

  const oppositeQueue = waitingUsers[opposite];
  const sameQueue     = waitingUsers[gender];

  let partner = null;
  const roll = Math.random(); // 0.0 – 1.0

  if (roll < 0.80 && oppositeQueue.length > 0) {
    // 80% → opposite gender
    partner = oppositeQueue.shift();
  } else if (sameQueue.length > 0) {
    // 20% (or no opposite available) → same gender
    partner = sameQueue.shift();
  } else if (oppositeQueue.length > 0) {
    // Fallback → opposite gender if same is empty
    partner = oppositeQueue.shift();
  }

  if (partner) {
    // Create active pair
    connections[socket.id]  = partner.id;
    connections[partner.id] = socket.id;

    socket.emit('chatConnected', {
      partnerName: partner.userData.name,
      partnerGender: partner.userData.gender
    });
    partner.emit('chatConnected', {
      partnerName: socket.userData.name,
      partnerGender: socket.userData.gender
    });
    console.log(`[~] Paired: ${socket.userData.name}(${gender}) ↔ ${partner.userData.name}(${partner.userData.gender})`);
  } else {
    // No match found → add to waiting queue
    waitingUsers[gender].push(socket);
    socket.emit('searching');
    console.log(`[?] Waiting: ${socket.userData.name}(${gender}) | Queue: M=${waitingUsers.male.length} F=${waitingUsers.female.length}`);
  }
}

function endCurrentChat(socket, notifyPartner = false) {
  const partnerId = connections[socket.id];
  if (partnerId) {
    if (notifyPartner) io.to(partnerId).emit('partnerDisconnected');
    delete connections[partnerId];
    delete connections[socket.id];
  }
}

function removeFromQueue(socket) {
  ['male', 'female'].forEach(g => {
    const idx = waitingUsers[g].indexOf(socket);
    if (idx !== -1) waitingUsers[g].splice(idx, 1);
  });
}

function sanitize(str) {
  return String(str)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .substring(0, 300);
}

// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🟢 Chat Karo server running on 0.0.0.0:${PORT}\n`);
  console.log(`   PORT env = ${process.env.PORT || '(not set, using 3000)'}\n`);
});
