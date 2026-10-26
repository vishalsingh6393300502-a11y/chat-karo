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

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);
  admin.attach(socket);

  socket.on('startSearch', ({ name, gender, password }) => {
    if (admin.gate(socket, name, gender, password)) return;

    socket.userData = { name: socket.dn || sanitize(name), gender };
    socket.searching = true;

    userGenders[socket.id] = gender;
    onlineUsers[gender]++;
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
    endCurrentChat(socket, true);
    if (socket.userData) {
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

  const { gender } = socket.userData;

  ['male', 'female', 'other'].forEach((g) => {
    waitingUsers[g] = waitingUsers[g].filter((s) => s.connected && !connections[s.id]);
  });

  removeFromQueue(socket);

  let partner = null;

  if (gender === 'male') {
    if (waitingUsers.female.length > 0) {
      partner = waitingUsers.female.shift();
    } else if (waitingUsers.male.length > 0) {
      partner = waitingUsers.male.shift();
    }
  } else if (gender === 'female') {
    if (waitingUsers.male.length > 0) {
      partner = waitingUsers.male.shift();
    } else if (waitingUsers.female.length > 0) {
      partner = waitingUsers.female.shift();
    }
  } else if (gender === 'other') {
    if (waitingUsers.other.length > 0) {
      partner = waitingUsers.other.shift();
    }
  }

  if (partner) {
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
  } else {
    waitingUsers[gender].push(socket);
    socket.emit('searching');
    console.log(`[?] Waiting: ${socket.userData.name}(${gender}) | Queues: M=${waitingUsers.male.length} F=${waitingUsers.female.length} O=${waitingUsers.other.length}`);
  }
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🟢 Chat Karo server running on 0.0.0.0:${PORT}\n`);
});
