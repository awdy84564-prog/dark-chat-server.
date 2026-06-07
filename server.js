// ==================== server.js - الخانة 1 من 3 ====================
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");

// السماح بالاتصالات الخارجية من جميع النطاقات (CORS) لتجنب مشاكل الحظر
const io = new Server(server, { 
  cors: { 
    origin: "*",
    methods: ["GET", "POST"]
  } 
});

app.use(express.static(__dirname));

// قراءة المنفذ ديناميكياً ليتوافق مع استضافة Render السحابية
const PORT = process.env.PORT || 3000;

// نظام رتب لقانا الكامل بالدرجات والألوان المحددة للتوهج
const ROLES = {
  'GUEST': { name: 'زائر', level: 0, color: '#ffffff' },
  'MEMBER': { name: 'عضو', level: 1, color: '#00ffcc' },
  'MODERATOR': { name: 'مشرف الغرفة', level: 2, color: '#ffcc00' },
  'ADMIN': { name: 'إدمن التطبيق', level: 3, color: '#ff3366' },
  'MASTER': { name: 'ماستر', level: 4, color: '#9933ff' },
  'CROWN': { name: 'تاج', level: 5, color: '#ffd700' },
  'OWNER': { name: 'صاحب الموقع', level: 6, color: '#00ff00' }
};

// جدار حماية لكلمات المرور الصارمة للرتب العليا في الدخول
const PASSWORDS = {
  'muhammed0940': 'OWNER',
  'crown2026': 'CROWN',
  'master2026': 'MASTER',
  'admin123': 'ADMIN',
  'mod123': 'MODERATOR',
  'member123': 'MEMBER'
};

// قاعدة بيانات الغرف والمايكات الـ 8 (4 فوق و 4 تحت)
let rooms = {
  'الغرفة العامة': {
    users: {},
    mics: Array(8).fill(null).map((_, index) => ({
      userId: null, username: null, role: null, position: index < 4 ? "top" : "bottom",
      isLocked: false, isMuted: false
    }))
  }
};

let bannedIPs = new Set();
let messageLogs = {}; // لجدار حماية الـ Spam لمنع إغراق الشات
// ==================== server.js - الخانة 2 من 3 ====================

// دالة لإنزال المستخدم تلقائياً من أي مايك في حال خروجه أو نزوله الاختياري
function leaveAnyMic(socket, roomName) {
  const room = rooms[roomName];
  if (!room) return;
  const slotIndex = room.mics.findIndex(s => s.userId === socket.id);
  if (slotIndex !== -1) {
    const user = room.users[socket.id];
    room.mics[slotIndex] = { 
      userId: null, 
      username: null, 
      role: null, 
      position: slotIndex < 4 ? "top" : "bottom", 
      isLocked: room.mics[slotIndex].isLocked, 
      isMuted: false 
    };
    io.to(roomName).emit('update_mics', room.mics);
    if (user) {
      io.to(roomName).emit('sys_broadcast', { text: `📉 نزل [${ROLES[user.role].name}] ${user.username} من المايك رقم ${slotIndex + 1}` });
    }
  }
}

// بدء استقبال اتصالات الأجهزة والشبكات الحية
io.on('connection', (socket) => {
    // جلب معرف شبكة المستخدم (IP) للتحقق من جدار الحماية ضد المخربين
    const clientIP = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    if (bannedIPs.has(clientIP)) {
        socket.emit('banned', { reason: "🚫 تم حظر جهازك أو شبكتك نهائياً من دخول التطبيق." });
        socket.disconnect(true);
        return;
    }

    let currentRoom = 'الغرفة العامة';

    // التحقق من هوية المستخدم وكلمة مرور رتبته المخصصة عند الدخول
    socket.on('register_user', (data) => {
        let assignedRole = 'GUEST'; // الافتراضي زائر بدون صلاحيات
        
        // فحص جدار الحماية ضد كلمات المرور لتخصيص الرتبة تلقائياً
        if (data.password && PASSWORDS[data.password]) {
            assignedRole = PASSWORDS[data.password];
        } else if (data.password && !PASSWORDS[data.password]) {
            socket.emit('auth_error', { text: "⚠️ كلمة مرور الرتبة غير صحيحة! تم تسجيل دخولك كـ زائر." });
        }

        const userObj = {
            id: socket.id,
            username: data.username || `زائر_${Math.floor(1000 + Math.random() * 9000)}`,
            role: assignedRole,
            ip: clientIP
        };

        rooms[currentRoom].users[socket.id] = userObj;
        socket.join(currentRoom);

        // إرسال تأكيد النجاح للواجهة مع تطبيق ألوان لقانا الرسمية المحددة للرتبة
        socket.emit('registration_success', {
            username: userObj.username,
            role: userObj.role,
            roleName: ROLES[userObj.role].name,
            color: ROLES[userObj.role].color,
            room: currentRoom
        });

        // مزامنة فورية لحالة المايكات الـ 8 وقائمة الأسماء المتواجدة للمستخدم الجديد
        socket.emit('update_mics', rooms[currentRoom].mics);
        
        io.to(currentRoom).emit('update_users_list', Object.values(rooms[currentRoom].users).map(u => ({
            username: u.username,
            role: u.role,
            roleName: ROLES[u.role].name,
            color: ROLES[u.role].color
        })));

        // بث إعلان الدخول المميّز لجميع أعضاء الغرفة
        io.to(currentRoom).emit('sys_broadcast', {
            text: `📢 انضم [${ROLES[userObj.role].name}] ${userObj.username} إلى الدردشة الآن.`
        });
    });

    // استقبال رسائل الشات العامة مع فلتر الحماية الصارم ضد السبام وإغراق الغرفة
    socket.on('send_chat_msg', (text) => {
        const room = rooms[currentRoom];
        if (!room) return;
        const user = room.users[socket.id];
        if (!user) return;

        // نظام الـ Anti-Spam: يمنع إرسال أكثر من 3 رسائل في غضون 3 ثوانٍ فقط لتوفير استقرار السيرفر
        const now = Date.now();
        if (!messageLogs[socket.id]) messageLogs[socket.id] = [];
        messageLogs[socket.id] = messageLogs[socket.id].filter(t => now - t < 3000); 
        
        if (messageLogs[socket.id].length >= 3) {
            socket.emit('sys_broadcast', { text: "⚠️ نظام الحماية: الرجاء عدم تكرار الرسائل بسرعة فائقة منعا للحظر المؤقت!" });
            return;
        }
        messageLogs[socket.id].push(now);

        // إعادة بث الرسالة فورا لجميع الهواتف المتصلة لتظهر بالخط المخصص
        io.to(currentRoom).emit('receive_chat_msg', {
            username: user.username,
            text: text,
            role: user.role,
            roleName: ROLES[user.role].name,
            color: ROLES[user.role].color
        });
    });
// ==================== server.js - الخانة 3 من 3 ====================

    // 4. معالجة الصعود والطلب على المايكات الـ 8 يدوياً أو تلقائياً
    socket.on('request_mic_slot', (slotIndex) => {
        const room = rooms[currentRoom];
        if (!room || slotIndex < 0 || slotIndex >= 8) return;

        const user = room.users[socket.id];
        if (!user) return;

        const slot = room.mics[slotIndex];

        // التحقق من الحجز المسبق للمايك
        if (slot.userId !== null) {
            socket.emit('sys_broadcast', { text: "⚠️ هذا المايك محجوز حالياً من مستخدم آخر!" });
            return;
        }
        
        // التحقق من قفل المايك (المشرف ليفل 2 فما فوق فقط يتجاوز القفل)
        if (slot.isLocked && ROLES[user.role].level < 2) { 
            socket.emit('sys_broadcast', { text: "🔒 هذا المايك مقفل بطلب من الإدارة!" });
            return;
        }

        // حجز المايك بنجاح (إنزال المستخدم من أي مايك قديم أولاً في الغرفة)
        leaveAnyMic(socket, currentRoom); 
        
        room.mics[slotIndex] = {
            userId: socket.id,
            username: user.username,
            role: user.role,
            position: slotIndex < 4 ? "top" : "bottom",
            isLocked: slot.isLocked,
            isMuted: false
        };

        // بث التحديث الفوري للمايكات وإعلان الصعود داخل الغرفة
        io.to(currentRoom).emit('update_mics', room.mics);
        io.to(currentRoom).emit('sys_broadcast', { text: `🎤 اعتلى [${ROLES[user.role].name}] ${user.username} المايك رقم ${slotIndex + 1}` });
    });

    // 5. النزول الاختياري أو ترك المايك من قبل المستخدم
    socket.on('leave_mic', () => {
        leaveAnyMic(socket, currentRoom);
    });

    // 6. لوحة تحكم وإجراءات الإشراف (التحقق من الرتب لمنع التجاوزات)
    socket.on('admin_action', (data) => {
        const room = rooms[currentRoom];
        if (!room) return;
        
        const adminUser = room.users[socket.id];
        const targetUser = Object.values(room.users).find(u => u.username === data.targetUsername);

        if (!adminUser || !targetUser) return;

        // نظام الحصانة لغرف لقانا (الأعلى رتبة برقم الليفل يتحكم بالأقل حصرياً)
        if (ROLES[adminUser.role].level > ROLES[targetUser.role].level) {
            
            // إجراء الطرد (Kick) خارج الغرفة
            if (data.action === 'kick') {
                io.to(targetUser.id).emit('kicked_from_app', { reason: "تم طردك من الغرفة بواسطة الإدارة." });
                const targetSocket = io.sockets.sockets.get(targetUser.id);
                if (targetSocket) {
                    leaveAnyMic(targetSocket, currentRoom);
                    targetSocket.leave(currentRoom);
                }
                delete room.users[targetUser.id];
                io.to(currentRoom).emit('sys_broadcast', { text: `🚫 قام المشرف بطرد ${targetUser.username} خارج الدردشة.` });
            } 
            
            // إجراء الحظر الكامل (Ban) بإضافة الآي بي للجدار الناري
            else if (data.action === 'ban') {
                bannedIPs.add(targetUser.ip); 
                io.to(targetUser.id).emit('banned', { reason: "تم حظر جهازك نهائياً من قبل صاحب الموقع." });
                const targetSocket = io.sockets.sockets.get(targetUser.id);
                if (targetSocket) targetSocket.disconnect(true);
                io.to(currentRoom).emit('sys_broadcast', { text: `⛔ تم حظر جهاز الحساب ${targetUser.username} نهائياً بالـ IP.` });
            }
            
            // تحديث قائمة الأسماء لجميع المتواجدين بعد إجراء الطرد/الحظر
            io.to(currentRoom).emit('update_users_list', Object.values(room.users).map(u => ({
                username: u.username, role: u.role, roleName: ROLES[u.role].name, color: ROLES[u.role].color
            })));

        } else {
            socket.emit('sys_broadcast', { text: "❌ خطأ حماية: لا تملك الصلاحية الكافية للتحكم بهذا المستخدم (لديه حصانة رتبة أعلى)!" });
        }
    });

    // 7. قطع الاتصال وتنظيف البيانات تلقائياً عند قفل التطبيق أو فصل الإنترنت
    socket.on('disconnect', () => {
        const room = rooms[currentRoom];
        if (room && room.users[socket.id]) {
            leaveAnyMic(socket, currentRoom); // إنزاله فوراً من المايكات إن كان متحدثاً
            
            const user = room.users[socket.id];
            delete room.users[socket.id];
            delete messageLogs[socket.id]; // حذف سجل الرسائل لتوفير ذاكرة السيرفر
            
            // تحديث قائمة المتواجدين بعد خروج العضو
            io.to(currentRoom).emit('update_users_list', Object.values(room.users).map(u => ({
                username: u.username, role: u.role, roleName: ROLES[u.role].name, color: ROLES[u.role].color
            })));
            io.to(currentRoom).emit('sys_broadcast', { text: `❌ غادر ${user.username} الدردشة.` });
        }
    });
});

// تشغيل سيرفر DARK VIP ROOT الاستماع للاتصالات عبر البورت المعين لـ Render
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==============================================`);
    console.log(`🔥 DARK VIP ROOT BACKEND IS LIVE!`);
    console.log(`Running smoothly on port: ${PORT}`);
    console.log(`==============================================\n`);
});
