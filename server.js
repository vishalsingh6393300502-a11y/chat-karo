const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 30000,
  pingInterval: 10000
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'chat-karo' });
});

const waitingUsers = { male: [], female: [], other: [] };
const onlineUsers = { male: 0, female: 0, other: 0 };
const userGenders = {};
const connections = {};
const reports = [];

function sanitize(value) {
  return String(value ?? '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[`]/g, '')
    .trim()
    .slice(0, 200);
}

function refreshPresence() {
  const total = onlineUsers.male + onlineUsers.female + onlineUsers.other;
  io.emit('presence', {
    total,
    male: onlineUsers.male,
    female: onlineUsers.female,
    other: onlineUsers.other,
    waiting: {
      male: waitingUsers.male.length,
      female: waitingUsers.female.length,
      other: waitingUsers.other.length
    },
    connections: Object.entries(connections).reduce((acc, [socketId, partnerId]) => {
      const left = socketId;
      const right = partnerId;
      if (!left || !right) return acc;
      acc.push({ socketId: left, partnerId: right });
      return acc;
    }, [])
  });
}

function removeFromQueue(socket) {
  ['male', 'female', 'other'].forEach((gender) => {
    const index = waitingUsers[gender].indexOf(socket);
    if (index !== -1) waitingUsers[gender].splice(index, 1);
  });
}

function endCurrentChat(socket, notifyPartner = false) {
  const partnerId = connections[socket.id];
  if (partnerId) {
    if (notifyPartner) io.to(partnerId).emit('partnerDisconnected');
    delete connections[partnerId];
    delete connections[socket.id];
  }
}

function matchUser(socket) {
  if (!socket.userData) return;

  const { gender } = socket.userData;

  ['male', 'female', 'other'].forEach((item) => {
    waitingUsers[item] = waitingUsers[item].filter((itemSocket) => itemSocket.connected && !connections[itemSocket.id]);
  });

  removeFromQueue(socket);

  let partner = null;

  if (gender === 'male') {
    if (waitingUsers.female.length > 0) partner = waitingUsers.female.shift();
    else if (waitingUsers.male.length > 0) partner = waitingUsers.male.shift();
  } else if (gender === 'female') {
    if (waitingUsers.male.length > 0) partner = waitingUsers.male.shift();
    else if (waitingUsers.female.length > 0) partner = waitingUsers.female.shift();
  } else if (gender === 'other') {
    if (waitingUsers.other.length > 0) partner = waitingUsers.other.shift();
  }

  if (partner) {
    connections[socket.id] = partner.id;
    connections[partner.id] = socket.id;

    socket.emit('chatConnected', {
      partnerName: partner.userData.name,
      partnerGender: partner.userData.gender,
      partnerId: partner.userData.userId || partner.userData.name
    });

    partner.emit('chatConnected', {
      partnerName: socket.userData.name,
      partnerGender: socket.userData.gender,
      partnerId: socket.userData.userId || socket.userData.name
    });

    refreshPresence();
    return;
  }

  waitingUsers[gender].push(socket);
  socket.emit('searching');
  refreshPresence();
}

io.on('connection', (socket) => {
  socket.on('startSearch', ({ name, gender, userId } = {}) => {
    const cleanName = sanitize(name) || 'Guest';
    const cleanGender = ['male', 'female', 'other'].includes(gender) ? gender : 'other';
    const cleanUserId = sanitize(userId) || `@${cleanName.toLowerCase().replace(/\s+/g, '')}`;

    socket.userData = {
      name: cleanName,
      gender: cleanGender,
      userId: cleanUserId
    };

    socket.searching = true;
    userGenders[socket.id] = cleanGender;
    onlineUsers[cleanGender] = (onlineUsers[cleanGender] || 0) + 1;

    refreshPresence();
    matchUser(socket);
  });

  socket.on('sendMessage', (message) => {
    const partnerId = connections[socket.id];
    const cleanMessage = sanitize(message).trim();

    if (partnerId && cleanMessage) {
      io.to(partnerId).emit('receiveMessage', {
        name: socket.userData?.name || 'Anonymous',
        message: cleanMessage
      });
    }
  });

  socket.on('typing', () => {
    const partnerId = connections[socket.id];
    if (partnerId && socket.userData) {
      io.to(partnerId).emit('partnerTyping', socket.userData.name);
    }
  });

  socket.on('stopTyping', () => {
    const partnerId = connections[socket.id];
    if (partnerId) io.to(partnerId).emit('partnerStopTyping');
  });

  socket.on('sendPhoto', (base64) => {
    const partnerId = connections[socket.id];
    if (!partnerId || typeof base64 !== 'string' || !base64.trim()) return;

    io.to(partnerId).emit('receivePhoto', {
      name: socket.userData?.name || 'Anonymous',
      photo: base64
    });
  });

  socket.on('newChat', () => {
    endCurrentChat(socket, true);
    if (socket.userData) matchUser(socket);
  });

  socket.on('report', ({ reason } = {}) => {
    const partnerId = connections[socket.id];
    const reasonText = sanitize(reason || 'other');

    reports.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      by: socket.userData?.name || 'Unknown',
      reason: reasonText,
      time: new Date().toISOString()
    });

    io.emit('adminReport', {
      id: reports[reports.length - 1].id,
      by: socket.userData?.name || 'Unknown',
      reason: reasonText,
      time: new Date().toISOString()
    });

    if (partnerId) {
      io.to(partnerId).emit('partnerDisconnected');
      delete connections[partnerId];
    }
    delete connections[socket.id];

    setTimeout(() => {
      if (socket.connected && socket.userData) matchUser(socket);
    }, 500);
  });

  socket.on('developerAction', ({ type, value } = {}) => {
    if (!socket.userData) return;

    if (type === 'changeUserId') {
      socket.userData.userId = sanitize(value) || socket.userData.userId;
      socket.emit('developerUpdated', {
        userId: socket.userData.userId
      });
    }
  });

  socket.on('disconnect', () => {
    if (userGenders[socket.id]) {
      const gender = userGenders[socket.id];
      onlineUsers[gender] = Math.max(0, (onlineUsers[gender] || 0) - 1);
      delete userGenders[socket.id];
    }

    endCurrentChat(socket, true);
    removeFromQueue(socket);
    refreshPresence();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chat Karo server running on port ${PORT}`);
});
