const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let activeUsers = {};

const ROLES = {
"GUEST": { name: "زائر", level: 1, color: "#FFFFFF" },
"MEMBER": { name: "عضو", level: 2, color: "#00FFCC" },
"MODERATOR": { name: "مشرف", level: 3, color: "#FFCC00" },
"ADMIN": { name: "إدمن", level: 4, color: "#FF0000" }
};

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
console.log(`📡 اتصال جديد: ${socket.id}`);

socket.on('register_user', (data) => {
activeUsers[socket.id] = {
username: data.username || "مستخدم مجهول",
role: data.role || "GUEST",
room: "المضافة العامة"
};
socket.join("المضافة العامة");

socket.emit('registration_success', activeUsers[socket.id]);

io.to("المضافة العامة").emit('sys_broadcast', {
text: `📢 انضم [${ROLES[activeUsers[socket.id].role].name}] ${activeUsers[socket.id].username} إلى الشات.`
});
});

socket.on('send_chat_msg', (msgText) => {
const user = activeUsers[socket.id];
if (!user) return;
const roleInfo = ROLES[user.role];
io.to(user.room).emit('receive_chat_msg', {
username: user.username,
text: msgText,
color: roleInfo.color,
roleName: roleInfo.name
});
});

socket.on('disconnect', () => {
if (activeUsers[socket.id]) {
io.to(activeUsers[socket.id].room).emit('sys_broadcast', {
text: `❌ غادر ${activeUsers[socket.id].username} الشات.`
});
delete activeUsers[socket.id];
}
});
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
console.log(`🔥 DARK CHAT SERVER IS LIVE!`);
console.log(`Port: ${PORT}`);
});
