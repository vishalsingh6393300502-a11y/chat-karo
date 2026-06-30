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
//  GENDER-BASED MATCHING QUEUES & ONLINE TRACKING
//  waitingUsers.male    → males waiting for a partner
//  waitingUsers.female  → females waiting for a partner
//  waitingUsers.other   → other gender waiting for a partner
// ============================================================
const waitingUsers = { male: [], female: [], other: [] };
const onlineUsers = { male: 0, female: 0, other: 0 };

// socketId → partnerId (active chat pairs)
const connections = {};

// socketId → user gender (to track online users)
const userGenders = {};

io.on('connection', (socket) => {
  // Increment online count on connection
  console.log(`[+] Connected: ${socket.id}`);

  // ── Start Search ──────────────────────────────────────────
  socket.on('startSearch', ({ name, gender }) => {
    socket.userData = { name: sanitize(name), gender };
    socket.searching = true;
    
    // Track online users by gender
    userGenders[socket.id] = gender;
    onlineUsers[gender]++;
    broadcastOnlineStats();
    
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

  // ── Send Photo (forward base64 image to partner) ──────────
  socket.on('sendPhoto', (base64) => {
    const partnerId = connections[socket.id];
    if (!partnerId) return;
    // Optionally: server-side validation of size/type can be added here
    io.to(partnerId).emit('receivePhoto', {
      name: socket.userData && socket.userData.name ? socket.userData.name : 'Anonymous',
      photo: base64
    });
  });

  // ── New Chat ────────────────────────────────────────────��
  socket.on('newChat', () => {
    endCurrentChat(socket, true); // notify partner
    if (socket.userData) {
      matchUser(socket);
    }
  });

  // ── Report ──────────────────────────────────────────────
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
    // Update online count
    if (userGenders[socket.id]) {
      const gender = userGenders[socket.id];
      onlineUsers[gender] = Math.max(0, onlineUsers[gender] - 1);
      delete userGenders[socket.id];
    }
    
    broadcastOnlineStats();
    endCurrentChat(socket, true);
    removeFromQueue(socket);
    console.log(`[-] Disconnected: ${socket.id}`);
  });
});

// ============================================================
//  SMART MATCHING ALGORITHM
//  
//  Males & Females:
//  - If both available: match Male ↔ Female
//  - If only males left: match Male ↔ Male
//  - If only females left: match Female ↔ Female
//
//  Others:
//  - Only match with other "other" users
//  - Never cross-mix with males/females
// ============================================================
function matchUser(socket) {
  if (!socket.userData) return;

  const { gender } = socket.userData;

  // Clean stale sockets from queues
  ['male', 'female', 'other'].forEach(g => {
    waitingUsers[g] = waitingUsers[g].filter(s => s.connected && !connections[s.id]);
  });

  // Remove self from any queue first
  removeFromQueue(socket);

  let partner = null;

  if (gender === 'male') {
    // Male: prefer female first, then male
    if (waitingUsers.female.length > 0) {
      partner = waitingUsers.female.shift();
    } else if (waitingUsers.male.length > 0) {
      partner = waitingUsers.male.shift();
    }
  } else if (gender === 'female') {
    // Female: prefer male first, then female
    if (waitingUsers.male.length > 0) {
      partner = waitingUsers.male.shift();
    } else if (waitingUsers.female.length > 0) {
      partner = waitingUsers.female.shift();
    }
  } else if (gender === 'other') {
    // Other: only match with other
    if (waitingUsers.other.length > 0) {
      partner = waitingUsers.other.shift();
    }
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
    console.log(`[?] Waiting: ${socket.userData.name}(${gender}) | Queues: M=${waitingUsers.male.length} F=${waitingUsers.female.length} O=${waitingUsers.other.length}`);
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
  ['male', 'female', 'other'].forEach(g => {
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

function broadcastOnlineStats() {
  const totalOnline = onlineUsers.male + onlineUsers.female + onlineUsers.other;
  io.emit('onlineStats', {
    total: totalOnline,
    male: onlineUsers.male,
    female: onlineUsers.female,
    other: onlineUsers.other
  });
  console.log(`[📊] Online: M=${onlineUsers.male} F=${onlineUsers.female} O=${onlineUsers.other} Total=${totalOnline}`);
}

// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🟢 Chat Karo server running on 0.0.0.0:${PORT}\n`);
  console.log(`   PORT env = ${process.env.PORT || '(not set, using 3000)'}\n`);
});
