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

const waitingUsers = { male: [], female: [], other: [] };
const onlineUsers = { male: 0, female: 0, other: 0 };
const connections = {};
const userGenders = {};

// Hidden developer console: opens when the secret code is typed as the name. See ADMIN-GUIDE.md
const admin = require('./admin')({ io, app, connections, waitingUsers, endCurrentChat, removeFromQueue, sanitize });

app.use(admin.cookie);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const validGenders = new Set(['male', 'female', 'other']);
const normalizeGender = (gender) => (validGenders.has(gender) ? gender : 'other');

function findAvailablePartner(targetGender, currentSocketId) {
  const queue = waitingUsers[targetGender] || [];

  for (let index = 0; index < queue.length; index += 1) {
    const candidate = queue[index];
    if (!candidate || candidate.id === currentSocketId) continue;
    if (!candidate.connected || connections[candidate.id]) continue;
    return queue.splice(index, 1)[0];
  }

  return null;
}

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);
  admin.attach(socket);

  socket.on('startSearch', ({ name, gender, password }) => {
    const safeName = String(name || '').trim();
    const safeGender = normalizeGender(gender);

    if (!safeName) {
      socket.emit('authError', 'Please enter your name before searching.');
      return;
    }

    if (admin.gate(socket, safeName, safeGender, password)) return;

    removeFromQueue(socket);
    endCurrentChat(socket, true);

    if (userGenders[socket.id] && userGenders[socket.id] !== safeGender) {
      onlineUsers[userGenders[socket.id]] = Math.max(0, onlineUsers[userGenders[socket.id]] - 1);
    }

    if (!userGenders[socket.id]) {
      onlineUsers[safeGender] = (onlineUsers[safeGender] || 0) + 1;
    }

    userGenders[socket.id] = safeGender;

    socket.userData = { name: socket.dn || sanitize(safeName), gender: safeGender };
    socket.searching = true;
    broadcastOnlineStats();
    matchUser(socket);
  });

  socket.on('sendMessage', (message) => {
    const partnerId = connections[socket.id];
    if (partnerId && typeof message === 'string' && message.trim()) {
      const text = sanitize(message.trim());
      io.to(partnerId).emit('receiveMessage', {
        name: admin.label(socket),
        message: text
      });
      admin.msg(socket, { text });
    }
  });

  socket.on('typing', () => {
    const partnerId = connections[socket.id];
    if (partnerId) io.to(partnerId).emit('partnerTyping', admin.label(socket));
  });

  socket.on('stopTyping', () => {
    const partnerId = connections[socket.id];
    if (partnerId) io.to(partnerId).emit('partnerStopTyping');
  });

  socket.on('requestPhoto', () => {
    const partnerId = connections[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('photoRequested', admin.label(socket));
    }
  });

  socket.on('sendPhoto', (base64) => {
    const partnerId = connections[socket.id];
    if (!partnerId || !admin.okPhoto(base64)) return;
    io.to(partnerId).emit('receivePhoto', {
      name: socket.userData && socket.userData.name ? admin.label(socket) : 'Anonymous',
      photo: base64
    });
    admin.msg(socket, { photo: base64 });
  });

  socket.on('newChat', () => {
    removeFromQueue(socket);
    endCurrentChat(socket, true);
    if (socket.userData) {
      socket.searching = true;
      matchUser(socket);
    }
  });

  socket.on('disconnect', () => {
    if (userGenders[socket.id]) {
      const gender = userGenders[socket.id];
      onlineUsers[gender] = Math.max(0, onlineUsers[gender] - 1);
      delete userGenders[socket.id];
    }

    const partnerId = connections[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('partnerDisconnected');
    }

    broadcastOnlineStats();
    endCurrentChat(socket, true);
    removeFromQueue(socket);
    admin.left(socket);
    console.log(`[-] Disconnected: ${socket.id}`);
  });
});

function matchUser(socket) {
  if (!socket.userData) return;

  const gender = normalizeGender(socket.userData.gender);
  removeFromQueue(socket);

  const preferredOrder = gender === 'male'
    ? ['female', 'male']
    : gender === 'female'
      ? ['male', 'female']
      : ['other'];

  for (const targetGender of preferredOrder) {
    const partner = findAvailablePartner(targetGender, socket.id);
    if (!partner) continue;

    if (!partner.userData || !partner.userData.gender) {
      waitingUsers[targetGender].push(partner);
      continue;
    }

    socket.searching = false;
    partner.searching = false;

    connections[socket.id] = partner.id;
    connections[partner.id] = socket.id;

    socket.emit('chatConnected', {
      partnerName: admin.label(partner),
      partnerGender: partner.userData.gender
    });
    partner.emit('chatConnected', {
      partnerName: admin.label(socket),
      partnerGender: socket.userData.gender
    });
    admin.paired(socket, partner);
    console.log(`[~] Paired: ${socket.userData.name}(${gender}) ↔ ${partner.userData.name}(${partner.userData.gender})`);
    return;
  }

  waitingUsers[gender].push(socket);
  socket.searching = true;
  socket.emit('searching');
  console.log(`[?] Waiting: ${socket.userData.name}(${gender}) | Queues: M=${waitingUsers.male.length} F=${waitingUsers.female.length} O=${waitingUsers.other.length}`);
}

function endCurrentChat(socket, notifyPartner = false) {
  const partnerId = connections[socket.id];
  if (partnerId) {
    admin.ended(socket.id);
    if (notifyPartner) io.to(partnerId).emit('partnerDisconnected');
    delete connections[partnerId];
    delete connections[socket.id];
  }
}

function removeFromQueue(socket) {
  ['male', 'female', 'other'].forEach((g) => {
    const queue = waitingUsers[g] || [];
    const index = queue.findIndex((user) => user && user.id === socket.id);
    if (index !== -1) queue.splice(index, 1);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🟢 Chat Karo server running on 0.0.0.0:${PORT}\n`);
});
