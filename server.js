const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURATION ====================
const CONFIG = {
    ADMIN_PASSWORD: '$2a$10$8K1p/a0dRTlR0d.kU7L3u.ZqB0QY9QzJ9VQJ9VQJ9VQJ9VQJ9VQJ9V', // "admin123" hashed
    BOT_TOKEN: '8170582086:AAEb5LIj1flmUeeBlYQZaNm81lxufzA3Zyo', // Replace with your bot token
    CHAT_ID: '6142816761', // Replace with your chat ID
    MESSAGES_FILE: 'messages.json',
    BLOCKED_IPS_FILE: 'blocked_ips.json',
    USER_SESSIONS_FILE: 'user_sessions.json'
};

const bot = new TelegramBot(CONFIG.BOT_TOKEN, { polling: false });

// ==================== UTILITY FUNCTIONS ====================
function readJSON(file) {
    try {
        if (!fs.existsSync(file)) return [];
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        console.error(`Error reading ${file}:`, error);
        return [];
    }
}

function writeJSON(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error writing ${file}:`, error);
        return false;
    }
}

function getClientIP(req) {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
}

function isAdminName(name) {
    return name && name.toLowerCase() === 'admin';
}

// ==================== INITIALIZATION ====================
function initializeFiles() {
    if (!fs.existsSync(CONFIG.MESSAGES_FILE)) {
        const welcomeMessages = [
            {
                id: generateId(),
                name: "ChatSphere",
                message: "🚀 Welcome to ChatSphere! Start connecting with your school community.",
                timestamp: new Date().toISOString(),
                type: "system"
            },
            {
                id: generateId(),
                name: "System",
                message: "💫 All messages are secure and visible to everyone in real-time.",
                timestamp: new Date().toISOString(),
                type: "system"
            }
        ];
        writeJSON(CONFIG.MESSAGES_FILE, welcomeMessages);
    }
    
    if (!fs.existsSync(CONFIG.BLOCKED_IPS_FILE)) {
        writeJSON(CONFIG.BLOCKED_IPS_FILE, []);
    }
    
    if (!fs.existsSync(CONFIG.USER_SESSIONS_FILE)) {
        writeJSON(CONFIG.USER_SESSIONS_FILE, {});
    }
}

function generateId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// IP Blocking Middleware
app.use((req, res, next) => {
    const clientIP = getClientIP(req);
    const blockedIPs = readJSON(CONFIG.BLOCKED_IPS_FILE);
    
    if (blockedIPs.includes(clientIP)) {
        return res.status(403).json({ 
            success: false, 
            error: 'ACCESS_DENIED',
            message: 'Your access has been restricted by administrator.'
        });
    }
    next();
});

// ==================== ROUTES ====================

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all messages
app.get('/messages', (req, res) => {
    try {
        const messages = readJSON(CONFIG.MESSAGES_FILE);
        res.json({
            success: true,
            messages: messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
            total: messages.length
        });
    } catch (error) {
        res.json({ success: true, messages: [], total: 0 });
    }
});

// User authentication
app.post('/auth', (req, res) => {
    try {
        const { name, password } = req.body;
        const clientIP = getClientIP(req);
        
        if (!name || !name.trim()) {
            return res.json({ success: false, error: 'Please enter your name' });
        }

        // Track user session
        const sessions = readJSON(CONFIG.USER_SESSIONS_FILE);
        const previousName = sessions[clientIP];
        
        // Check if user changed name
        if (previousName && previousName !== name.trim()) {
            // Send notification to Telegram
            bot.sendMessage(CONFIG.CHAT_ID, 
                `🔄 NAME CHANGE DETECTED\n` +
                `IP: ${clientIP}\n` +
                `From: ${previousName}\n` +
                `To: ${name.trim()}\n` +
                `Time: ${new Date().toLocaleString()}`
            ).catch(console.error);
        }

        // Update session
        sessions[clientIP] = name.trim();
        writeJSON(CONFIG.USER_SESSIONS_FILE, sessions);

        // Admin authentication
        if (isAdminName(name.trim())) {
            if (!password) {
                return res.json({ 
                    success: false, 
                    isAdmin: true, 
                    error: 'ADMIN_PASSWORD_REQUIRED' 
                });
            }
            
            const isValid = bcrypt.compareSync(password, CONFIG.ADMIN_PASSWORD);
            if (!isValid) {
                return res.json({ 
                    success: false, 
                    isAdmin: true, 
                    error: 'INVALID_ADMIN_PASSWORD' 
                });
            }
            
            return res.json({ 
                success: true, 
                isAdmin: true, 
                message: 'Admin access granted' 
            });
        }

        res.json({ success: true, isAdmin: false, message: 'Authentication successful' });
    } catch (error) {
        res.json({ success: false, error: 'Authentication failed' });
    }
});

// Send message
app.post('/send-message', async (req, res) => {
    try {
        const { name, message, isAdmin } = req.body;
        const clientIP = getClientIP(req);

        if (!name || !message) {
            return res.json({ success: false, error: 'Name and message required' });
        }

        if (message.length > 500) {
            return res.json({ success: false, error: 'Message too long' });
        }

        const messages = readJSON(CONFIG.MESSAGES_FILE);
        const newMessage = {
            id: generateId(),
            name: name.trim(),
            message: message.trim(),
            timestamp: new Date().toISOString(),
            type: isAdmin ? 'admin' : 'user',
            ip: isAdmin ? clientIP : undefined
        };

        messages.push(newMessage);
        writeJSON(CONFIG.MESSAGES_FILE, messages);

        // Send to Telegram if from admin
        if (isAdmin) {
            bot.sendMessage(CONFIG.CHAT_ID, 
                `📢 ADMIN BROADCAST\n` +
                `From: ${name}\n` +
                `Message: ${message}\n` +
                `IP: ${clientIP}`
            ).catch(console.error);
        }

        res.json({ success: true, messageId: newMessage.id });
    } catch (error) {
        res.json({ success: false, error: 'Failed to send message' });
    }
});

// Delete message (Admin only)
app.delete('/message/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { adminPassword } = req.body;
        const clientIP = getClientIP(req);

        // Verify admin
        if (!bcrypt.compareSync(adminPassword, CONFIG.ADMIN_PASSWORD)) {
            return res.json({ success: false, error: 'Admin authentication required' });
        }

        const messages = readJSON(CONFIG.MESSAGES_FILE);
        const filteredMessages = messages.filter(msg => msg.id !== id);
        
        if (filteredMessages.length === messages.length) {
            return res.json({ success: false, error: 'Message not found' });
        }

        writeJSON(CONFIG.MESSAGES_FILE, filteredMessages);

        // Log deletion
        bot.sendMessage(CONFIG.CHAT_ID,
            `🗑️ MESSAGE DELETED\n` +
            `Admin IP: ${clientIP}\n` +
            `Message ID: ${id}\n` +
            `Time: ${new Date().toLocaleString()}`
        ).catch(console.error);

        res.json({ success: true, message: 'Message deleted' });
    } catch (error) {
        res.json({ success: false, error: 'Failed to delete message' });
    }
});

// Block IP (Admin only)
app.post('/block-ip', (req, res) => {
    try {
        const { ip, reason, adminPassword } = req.body;
        const clientIP = getClientIP(req);

        if (!bcrypt.compareSync(adminPassword, CONFIG.ADMIN_PASSWORD)) {
            return res.json({ success: false, error: 'Admin authentication required' });
        }

        const blockedIPs = readJSON(CONFIG.BLOCKED_IPS_FILE);
        if (!blockedIPs.includes(ip)) {
            blockedIPs.push(ip);
            writeJSON(CONFIG.BLOCKED_IPS_FILE, blockedIPs);
        }

        // Notify Telegram
        bot.sendMessage(CONFIG.CHAT_ID,
            `🚫 IP BLOCKED\n` +
            `Blocked IP: ${ip}\n` +
            `Reason: ${reason || 'No reason provided'}\n` +
            `By Admin IP: ${clientIP}\n` +
            `Time: ${new Date().toLocaleString()}`
        ).catch(console.error);

        res.json({ success: true, message: 'IP blocked successfully' });
    } catch (error) {
        res.json({ success: false, error: 'Failed to block IP' });
    }
});

// Get user sessions (Admin only)
app.get('/user-sessions', (req, res) => {
    try {
        const { adminPassword } = req.query;
        
        if (!bcrypt.compareSync(adminPassword, CONFIG.ADMIN_PASSWORD)) {
            return res.json({ success: false, error: 'Admin authentication required' });
        }

        const sessions = readJSON(CONFIG.USER_SESSIONS_FILE);
        res.json({ success: true, sessions });
    } catch (error) {
        res.json({ success: false, error: 'Failed to get sessions' });
    }
});

// Daily backup to Telegram
function sendDailyBackup() {
    try {
        const messages = readJSON(CONFIG.MESSAGES_FILE);
        const blockedIPs = readJSON(CONFIG.BLOCKED_IPS_FILE);
        const sessions = readJSON(CONFIG.USER_SESSIONS_FILE);
        
        const activeUsers = new Object.keys(sessions).length;
        const today = new Date();
        const todayMessages = messages.filter(msg => 
            new Date(msg.timestamp).toDateString() === today.toDateString()
        ).length;

        const backupInfo = {
            date: today.toISOString(),
            totalMessages: messages.length,
            messagesToday: todayMessages,
            blockedIPs: blockedIPs.length,
            activeUsers: activeUsers,
            stats: {
                adminMessages: messages.filter(m => m.type === 'admin').length,
                systemMessages: messages.filter(m => m.type === 'system').length,
                userMessages: messages.filter(m => m.type === 'user').length
            }
        };

        bot.sendMessage(CONFIG.CHAT_ID,
            `📊 DAILY BACKUP REPORT\n` +
            `Date: ${today.toLocaleDateString()}\n` +
            `Total Messages: ${messages.length}\n` +
            `Today's Messages: ${todayMessages}\n` +
            `Active Users: ${activeUsers}\n` +
            `Blocked IPs: ${blockedIPs.length}\n` +
            `Admin Messages: ${backupInfo.stats.adminMessages}\n` +
            `System Messages: ${backupInfo.stats.systemMessages}`
        ).catch(console.error);

        // Send JSON backup file
        const backupData = {
            backupInfo,
            messages: messages.slice(-100), // Last 100 messages
            blockedIPs,
            userSessions: sessions
        };

        // In a real scenario, you'd save this as a file and send it
        console.log('📦 Backup ready:', JSON.stringify(backupInfo, null, 2));

    } catch (error) {
        console.error('Backup failed:', error);
    }
}

// Schedule daily backup at 23:59
setInterval(() => {
    const now = new Date();
    if (now.getHours() === 23 && now.getMinutes() === 59) {
        sendDailyBackup();
    }
}, 60000);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: '✅ Healthy',
        service: 'ChatSphere',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        messages: readJSON(CONFIG.MESSAGES_FILE).length,
        blockedIPs: readJSON(CONFIG.BLOCKED_IPS_FILE).length
    });
});

// ==================== SERVER START ====================
initializeFiles();
app.listen(PORT, () => {
    console.log(`
    🚀 CHATSPHERE SERVER STARTED
    📍 Port: ${PORT}
    🔐 Admin: Protected
    📱 Mobile: Optimized
    🌐 URL: http://localhost:${PORT}
    ✅ Ready for connections!
    `);
});
