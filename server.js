const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: { origin: "*" }
});

// هذا السطر ضفته لك - يحل مشكلة Deploy failed والـ APK
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

// المتغيرات
const ROLES = {
  'ضيف': { name: 'ضيف', level: 0 },
  'ادمن': { name: 'ادمن', level: 1 },
  'اونر': { name: 'اونر', level: 2 },
  'المؤسس': { name: 'المؤسس', level: 3 }
};

let activeUsers = {};
let micSlots = Array(8).fill(null).map(() => ({
  userId: null,
  username: null,
  isLocked: false,
  isMuted: false
}));

// دالة خروج من اي مايك
function leaveAnyMic(socketId) {
  const slotIndex = micSlots.findIndex(s => s.userId === socketId);
  if (slotIndex!== -1) {
    const user = activeUsers[socketId];
    micSlots[slotIndex].userId = null;
    micSlots[slotIndex].username = null;
    io.emit('update_mics', micSlots);
    if (user) {
      io.emit('sys_broadcast', { text: `🎤 نزل [${ROLES[user.role].name}] ${user.username} من المايك رقم ${slotIndex + 1}` });
      io.emit('mic_stream_stopped', { broadcasterId: socketId });
    }
  }
}

io.on('connection', (socket) => {

  socket.on('join_room', (data) => {
    const { username, role, userId } = data;
    activeUsers[socket.id] = { username, role, userId, socketId: socket.id };
    socket.emit('room_state', { mics: micSlots, users: Object.values(activeUsers) });
    socket.broadcast.emit('user_joined', activeUsers[socket.id]);
  });

  socket.on('request_mic', (slotId) => {
    const user = activeUsers[socket.id];
    if (!user || slotId < 0 || slotId > 7) return;

    if (micSlots[slotId].isLocked) {
      socket.emit('sys_broadcast', { text: "❌ هذا المايك مقفل من قبل الإدارة." });
      return;
    }

    if (micSlots[slotId].userId!== null) {
      socket.emit('sys_broadcast', { text: "❌ هذا المايك مشغول حالياً." });
      return;
    }

    leaveAnyMic(socket.id);
    micSlots[slotId].userId = socket.id;
    micSlots[slotId].username = user.username;

    io.emit('update_mics', micSlots);
    io.emit('sys_broadcast', { text: `🎤 صعد [${ROLES[user.role].name}] ${user.username} على المايك رقم ${slotId + 1}` });

    // اخبر الكل ان في شخص جديد طلع مايك
    socket.broadcast.emit('mic_stream_started', {
      broadcasterId: socket.id,
      slotId: slotId
    });

    // اخبر الشخص الجديد عن كل الناس اللي على المايك حالياً
    micSlots.forEach((slot, index) => {
      if (slot.userId && slot.userId!== socket.id) {
        socket.emit('mic_stream_started', {
          broadcasterId: slot.userId,
          slotId: index
        });
      }
    });
  });

  socket.on('leave_mic', () => {
    leaveAnyMic(socket.id);
  });

  socket.on('send_message', (text) => {
    const user = activeUsers[socket.id];
    if (!user) return;
    io.emit('new_message', {
      username: user.username,
      role: user.role,
      text: text
    });
  });

  // WebRTC Signaling
  socket.on('webrtc_offer', (data) => {
    io.to(data.to).emit('webrtc_offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  socket.on('webrtc_answer', (data) => {
    io.to(data.to).emit('webrtc_answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  socket.on('webrtc_ice_candidate', (data) => {
    io.to(data.to).emit('webrtc_ice_candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  socket.on('disconnect', () => {
    leaveAnyMic(socket.id);
    const user = activeUsers[socket.id];
    if (user) {
      socket.broadcast.emit('user_left', user);
      delete activeUsers[socket.id];
    }
  });

});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
