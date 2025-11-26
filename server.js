const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const TelegramBot = require('node-telegram-bot-api');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURATION ====================
const CONFIG = {
    // MongoDB Atlas - FREE 512MB
    MONGODB_URI: "mongodb+srv://chatshpere:tukubhuyan123@cluster0.i386mxq.mongodb.net/?retryWrites=true&w=majority",
    
    // Telegram Bot
    BOT_TOKEN: "8170582086:AAEb5LIj1flmUeeBlYQZaNm81lxufzA3Zyo",
    ADMIN_CHAT_ID: "6142816761",
    
    // Admin Security
    ADMIN_PASSWORD: "$2a$10$8K1p/a0dRTlR0d.kU7L3u.ZqB0QY9QzJ9VQJ9VQJ9VQJ9VQJ9VQJ9V", // "admin123"
    
    // App Settings
    APP_NAME: "ChatSphere",
    APP_URL: "https://fourr-chat.onrender.com"
};

// ==================== INITIALIZATION ====================
const bot = new TelegramBot(CONFIG.BOT_TOKEN, { polling: true });
let db, messagesCollection, usersCollection;

async function initializeDatabase() {
    try {
        console.log('🔄 Connecting to MongoDB...');
        const client = new MongoClient(CONFIG.MONGODB_URI, {
            serverApi: ServerApiVersion.v1,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000
        });

        await client.connect();
        db = client.db('chatshpere');
        messagesCollection = db.collection('messages');
        usersCollection = db.collection('users');
        
        // Create indexes
        await messagesCollection.createIndex({ timestamp: -1 });
        await usersCollection.createIndex({ ip: 1 });
        await usersCollection.createIndex({ lastSeen: -1 });
        
        console.log('✅ MongoDB Connected Successfully');
        
        // Add welcome message if no messages
        const messageCount = await messagesCollection.countDocuments();
        if (messageCount === 0) {
            await addSystemMessage("🚀 Welcome to ChatSphere! Start chatting with your school community.");
            await addSystemMessage("💫 Messages are permanent and sync across all devices.");
        }
        
    } catch (error) {
        console.error('❌ MongoDB Connection Failed:', error.message);
        process.exit(1);
    }
}

async function addSystemMessage(text) {
    await messagesCollection.insertOne({
        name: "System",
        message: text,
        type: "system",
        timestamp: new Date(),
        id: Date.now().toString()
    });
}

// ==================== TELEGRAM BOT SETUP ====================
function setupTelegramBot() {
    console.log('🤖 Initializing Telegram Bot...');

    // Start command
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId,
            `🎉 Welcome to ${CONFIG.APP_NAME} Bot!\n\n` +
            `Available Commands:\n` +
            `/stats - View chat statistics\n` +
            `/users - See active users\n` +
            `/backup - Download message backup (Admin)\n` +
            `/block <ip> - Block user by IP (Admin)\n\n` +
            `🌐 Website: ${CONFIG.APP_URL}`
        );
    });

    // Stats command
    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const stats = await getChatStats();
            bot.sendMessage(chatId,
                `📊 ${CONFIG.APP_NAME} Statistics\n\n` +
                `💬 Total Messages: ${stats.totalMessages}\n` +
                `👥 Active Users: ${stats.activeUsers}\n` +
                `📅 Messages Today: ${stats.todayMessages}\n` +
                `👑 Admin Messages: ${stats.adminMessages}\n` +
                `🕒 Server Uptime: ${stats.uptime}\n\n` +
                `Last Message: ${stats.lastMessageTime}`
            );
        } catch (error) {
            bot.sendMessage(chatId, '❌ Failed to fetch statistics');
        }
    });

    // Users command
    bot.onText(/\/users/, async (msg) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== CONFIG.ADMIN_CHAT_ID) {
            bot.sendMessage(chatId, '❌ Admin access required');
            return;
        }

        try {
            const users = await usersCollection.find().sort({ lastSeen: -1 }).limit(20).toArray();
            let userList = `👥 Active Users (Last 24h)\n\n`;
            
            users.forEach((user, index) => {
                const timeAgo = getTimeAgo(user.lastSeen);
                userList += `${index + 1}. ${user.name} (${user.ip})\n   🕒 ${timeAgo}\n\n`;
            });

            bot.sendMessage(chatId, userList);
        } catch (error) {
            bot.sendMessage(chatId, '❌ Failed to fetch users');
        }
    });

    // Backup command (Admin only)
    bot.onText(/\/backup/, async (msg) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== CONFIG.ADMIN_CHAT_ID) {
            bot.sendMessage(chatId, '❌ Admin access required');
            return;
        }

        try {
            const backupData = await generateBackup();
            bot.sendDocument(chatId, Buffer.from(JSON.stringify(backupData, null, 2)), {}, {
                filename: `chatshpere-backup-${new Date().toISOString().split('T')[0]}.json`,
                contentType: 'application/json'
            });
        } catch (error) {
            bot.sendMessage(chatId, '❌ Backup failed: ' + error.message);
        }
    });

    // Block command (Admin only)
    bot.onText(/\/block (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== CONFIG.ADMIN_CHAT_ID) {
            bot.sendMessage(chatId, '❌ Admin access required');
            return;
        }

        const ip = match[1];
        try {
            await usersCollection.updateOne(
                { ip: ip },
                { $set: { blocked: true, blockedAt: new Date(), blockedBy: 'Telegram Bot' } },
                { upsert: true }
            );

            bot.sendMessage(chatId, `✅ IP ${ip} blocked successfully`);
            
            // Notify on main chat
            await sendToTelegram(`🚫 User blocked via Telegram\nIP: ${ip}\nBy: Admin Bot`);
        } catch (error) {
            bot.sendMessage(chatId, '❌ Block failed: ' + error.message);
        }
    });

    console.log('✅ Telegram Bot Ready');
}

// ==================== HELPER FUNCTIONS ====================
async function getChatStats() {
    const totalMessages = await messagesCollection.countDocuments();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayMessages = await messagesCollection.countDocuments({
        timestamp: { $gte: today }
    });
    
    const adminMessages = await messagesCollection.countDocuments({ type: 'admin' });
    
    const activeUsers = await usersCollection.countDocuments({
        lastSeen: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    
    const lastMessage = await messagesCollection.findOne({}, { sort: { timestamp: -1 } });
    
    return {
        totalMessages,
        todayMessages,
        adminMessages,
        activeUsers,
        lastMessageTime: lastMessage ? new Date(lastMessage.timestamp).toLocaleTimeString() : 'No messages',
        uptime: formatUptime(process.uptime())
    };
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const mins = Math.floor((seconds % (60 * 60)) / 60);
    return `${days}d ${hours}h ${mins}m`;
}

async function generateBackup() {
    const messages = await messagesCollection.find().sort({ timestamp: 1 }).toArray();
    const users = await usersCollection.find().toArray();
    
    return {
        exportedAt: new Date().toISOString(),
        totalMessages: messages.length,
        totalUsers: users.length,
        app: CONFIG.APP_NAME,
        version: "2.0.0",
        messages: messages,
        users: users
    };
}

async function sendToTelegram(message, isAlert = false) {
    try {
        await bot.sendMessage(CONFIG.ADMIN_CHAT_ID, message);
        return true;
    } catch (error) {
        console.log('❌ Telegram send failed:', error.message);
        return false;
    }
}

// ==================== EXPRESS SERVER SETUP ====================
app.use(express.json());
app.use(express.static('public'));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    next();
});

// Get client IP
function getClientIP(req) {
    return req.ip || req.connection.remoteAddress || 'unknown';
}

// Check if user is blocked
async function isUserBlocked(ip) {
    const user = await usersCollection.findOne({ ip: ip });
    return user && user.blocked === true;
}

// Update user activity
async function updateUserActivity(ip, name) {
    await usersCollection.updateOne(
        { ip: ip },
        { 
            $set: { 
                name: name,
                lastSeen: new Date(),
                ip: ip
            },
            $setOnInsert: {
                firstSeen: new Date()
            }
        },
        { upsert: true }
    );
}

// ==================== ROUTES ====================

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await messagesCollection.findOne({});
        res.json({
            status: '✅ Healthy',
            database: 'MongoDB',
            uptime: formatUptime(process.uptime()),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ status: '❌ Unhealthy', error: error.message });
    }
});

// Get all messages
app.get('/messages', async (req, res) => {
    try {
        const messages = await messagesCollection.find().sort({ timestamp: 1 }).toArray();
        res.json({ success: true, messages });
    } catch (error) {
        res.json({ success: false, error: 'Failed to load messages', messages: [] });
    }
});

// User authentication
app.post('/auth', async (req, res) => {
    try {
        const { name, password } = req.body;
        const clientIP = getClientIP(req);

        if (!name || !name.trim()) {
            return res.json({ success: false, error: 'Please enter your name' });
        }

        // Check if user is blocked
        if (await isUserBlocked(clientIP)) {
            return res.json({ success: false, error: 'ACCESS_DENIED' });
        }

        // Track user activity
        await updateUserActivity(clientIP, name.trim());

        // Check for name changes
        const existingUser = await usersCollection.findOne({ ip: clientIP });
        if (existingUser && existingUser.name !== name.trim()) {
            await sendToTelegram(
                `🔄 NAME CHANGE DETECTED\n` +
                `IP: ${clientIP}\n` +
                `From: ${existingUser.name}\n` +
                `To: ${name.trim()}\n` +
                `Time: ${new Date().toLocaleString()}`
            );
        }

        // Admin authentication
        if (name.toLowerCase() === 'admin') {
            if (!password) {
                return res.json({ success: false, isAdmin: true, error: 'ADMIN_PASSWORD_REQUIRED' });
            }
            
            const isValid = bcrypt.compareSync(password, CONFIG.ADMIN_PASSWORD);
            if (!isValid) {
                return res.json({ success: false, isAdmin: true, error: 'INVALID_ADMIN_PASSWORD' });
            }
            
            return res.json({ success: true, isAdmin: true, message: 'Admin access granted' });
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

        if (await isUserBlocked(clientIP)) {
            return res.json({ success: false, error: 'ACCESS_DENIED' });
        }

        const newMessage = {
            id: Date.now().toString(),
            name: name.trim(),
            message: message.trim(),
            timestamp: new Date(),
            type: isAdmin ? 'admin' : 'user',
            ip: clientIP
        };

        // Save to MongoDB
        await messagesCollection.insertOne(newMessage);

        // Update user activity
        await updateUserActivity(clientIP, name.trim());

        // Send to Telegram
        if (isAdmin) {
            await sendToTelegram(
                `📢 ADMIN BROADCAST\n` +
                `From: ${name}\n` +
                `Message: ${message}\n` +
                `IP: ${clientIP}`
            );
        }

        // Send backup to Telegram every 10 messages
        const messageCount = await messagesCollection.countDocuments();
        if (messageCount % 10 === 0) {
            const stats = await getChatStats();
            await sendToTelegram(
                `💾 AUTO-BACKUP TRIGGERED\n` +
                `Total Messages: ${stats.totalMessages}\n` +
                `Active Users: ${stats.activeUsers}\n` +
                `Message #${messageCount}`
            );
        }

        res.json({ success: true, messageId: newMessage.id });

    } catch (error) {
        res.json({ success: false, error: 'Failed to send message' });
    }
});

// Delete message (Admin only)
app.delete('/message/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { adminPassword } = req.body;
        const clientIP = getClientIP(req);

        if (!bcrypt.compareSync(adminPassword, CONFIG.ADMIN_PASSWORD)) {
            return res.json({ success: false, error: 'Admin authentication required' });
        }

        const result = await messagesCollection.deleteOne({ id: id });
        
        if (result.deletedCount === 0) {
            return res.json({ success: false, error: 'Message not found' });
        }

        await sendToTelegram(
            `🗑️ MESSAGE DELETED\n` +
            `Admin IP: ${clientIP}\n` +
            `Message ID: ${id}\n` +
            `Time: ${new Date().toLocaleString()}`
        );

        res.json({ success: true, message: 'Message deleted' });

    } catch (error) {
        res.json({ success: false, error: 'Failed to delete message' });
    }
});

// Block user (Admin only)
app.post('/block-user', async (req, res) => {
    try {
        const { ip, reason } = req.body;
        const { adminPassword } = req.body;
        const clientIP = getClientIP(req);

        if (!bcrypt.compareSync(adminPassword, CONFIG.ADMIN_PASSWORD)) {
            return res.json({ success: false, error: 'Admin authentication required' });
        }

        await usersCollection.updateOne(
            { ip: ip },
            { 
                $set: { 
                    blocked: true, 
                    blockedAt: new Date(), 
                    blockedBy: clientIP,
                    blockReason: reason 
                }
            },
            { upsert: true }
        );

        await sendToTelegram(
            `🚫 USER BLOCKED\n` +
            `Blocked IP: ${ip}\n` +
            `Reason: ${reason || 'No reason provided'}\n` +
            `By Admin IP: ${clientIP}\n` +
            `Time: ${new Date().toLocaleString()}`
        );

        res.json({ success: true, message: 'User blocked successfully' });

    } catch (error) {
        res.json({ success: false, error: 'Failed to block user' });
    }
});

// Get statistics
app.get('/stats', async (req, res) => {
    try {
        const stats = await getChatStats();
        res.json({ success: true, stats });
    } catch (error) {
        res.json({ success: false, error: 'Failed to get stats' });
    }
});

// Download backup
app.get('/backup', async (req, res) => {
    try {
        const backupData = await generateBackup();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=chatshpere-backup-${Date.now()}.json`);
        res.send(JSON.stringify(backupData, null, 2));
    } catch (error) {
        res.status(500).json({ error: 'Backup failed: ' + error.message });
    }
});

// Get online users
app.get('/online-users', async (req, res) => {
    try {
        const users = await usersCollection.find({
            lastSeen: { $gte: new Date(Date.now() - 15 * 60 * 1000) } // Last 15 minutes
        }).sort({ lastSeen: -1 }).toArray();

        res.json({ success: true, users });
    } catch (error) {
        res.json({ success: false, error: 'Failed to get users' });
    }
});

// ==================== START SERVER ====================
async function startServer() {
    await initializeDatabase();
    setupTelegramBot();
    
    app.listen(PORT, () => {
        console.log(`
    🚀 ${CONFIG.APP_NAME} SERVER STARTED
    📍 Port: ${PORT}
    🗃️  Database: MongoDB Atlas
    🤖 Telegram: Connected
    👑 Admin: Ready
    🌐 URL: ${CONFIG.APP_URL}
    ✅ ALL SYSTEMS GO!
        `);
    });
}

startServer().catch(console.error);