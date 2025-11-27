const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const TelegramBot = require('node-telegram-bot-api');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURATION ====================
const CONFIG = {
    // MongoDB Atlas
    MONGODB_URI: "mongodb+srv://schoolchat_user:tukubhuyan123@cluster0.i386mxq.mongodb.net/?retryWrites=true&w=majority",
    
    // Telegram Bot
    BOT_TOKEN: "8170582086:AAEb5LIj1flmUeeBlYQZaNm81lxufzA3Zyo",
    ADMIN_CHAT_ID: "6142816761",
    
    // JWT Secret
    JWT_SECRET: "chatshpere_super_secret_2024",
    
    // Admin Credentials (Will be created automatically)
    ADMIN_USERNAME: "admin",
    ADMIN_EMAIL: "admin@chatshpere.com",
    ADMIN_PASSWORD: "admin123",
    
    // App Settings
    APP_NAME: "ChatSphere",
    APP_URL: "https://fourr-chat.onrender.com",
    
    // File Upload
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'audio/mpeg', 'audio/wav', 'application/pdf']
};

// ==================== INITIALIZATION ====================
const bot = new TelegramBot(CONFIG.BOT_TOKEN, { polling: true });
let db, usersCollection, messagesCollection, reactionsCollection, reportsCollection, auditLogCollection;

// File upload configuration
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: CONFIG.MAX_FILE_SIZE
    },
    fileFilter: (req, file, cb) => {
        if (CONFIG.ALLOWED_FILE_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }
});

async function initializeDatabase() {
    try {
        console.log('🔄 Connecting to MongoDB...');
        const client = new MongoClient(CONFIG.MONGODB_URI, {
            serverApi: ServerApiVersion.v1,
            maxPoolSize: 20,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000
        });

        await client.connect();
        db = client.db('chatshpere_v3');
        
        // Collections
        usersCollection = db.collection('users');
        messagesCollection = db.collection('messages');
        reactionsCollection = db.collection('reactions');
        reportsCollection = db.collection('reports');
        auditLogCollection = db.collection('audit_logs');
        achievementsCollection = db.collection('achievements');
        notificationsCollection = db.collection('notifications');
        
        // Create indexes
        await usersCollection.createIndex({ username: 1 }, { unique: true });
        await usersCollection.createIndex({ email: 1 }, { sparse: true });
        await messagesCollection.createIndex({ timestamp: -1 });
        await messagesCollection.createIndex({ 'replyTo.id': 1 });
        await reactionsCollection.createIndex({ messageId: 1, userId: 1 });
        
        console.log('✅ MongoDB Connected Successfully');
        
        // Create admin user if not exists
        await createAdminUser();
        
        // Add welcome message
        await addSystemMessage("🚀 Welcome to ChatSphere 3.0! New features: Voice messages, Replies, Profiles & more!");
        
    } catch (error) {
        console.error('❌ MongoDB Connection Failed:', error.message);
        process.exit(1);
    }
}

async function createAdminUser() {
    const adminExists = await usersCollection.findOne({ username: CONFIG.ADMIN_USERNAME });
    if (!adminExists) {
        const hashedPassword = await bcrypt.hash(CONFIG.ADMIN_PASSWORD, 12);
        await usersCollection.insertOne({
            username: CONFIG.ADMIN_USERNAME,
            name: "System Administrator",
            email: CONFIG.ADMIN_EMAIL,
            password: hashedPassword,
            role: "admin",
            avatar: "👑",
            status: "Online",
            bio: "System Administrator",
            points: 1000,
            achievements: ["founder"],
            isVerified: true,
            createdAt: new Date(),
            lastSeen: new Date()
        });
        console.log('✅ Admin user created');
    }
}

async function addSystemMessage(text) {
    await messagesCollection.insertOne({
        id: generateId(),
        userId: "system",
        username: "System",
        name: "ChatSphere",
        message: text,
        type: "system",
        timestamp: new Date(),
        reactions: {}
    });
}

// ==================== TELEGRAM BOT SETUP ====================
function setupTelegramBot() {
    console.log('🤖 Initializing Telegram Bot...');

    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId,
            `🎉 Welcome to ${CONFIG.APP_NAME} Bot!\n\n` +
            `Available Commands:\n` +
            `/stats - View chat statistics\n` +
            `/users - See active users\n` +
            `/backup - Download backup (Admin)\n` +
            `/broadcast - Send announcement (Admin)\n\n` +
            `🌐 Website: ${CONFIG.APP_URL}`
        );
    });

    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const stats = await getChatStats();
            bot.sendMessage(chatId,
                `📊 ${CONFIG.APP_NAME} Statistics\n\n` +
                `👥 Total Users: ${stats.totalUsers}\n` +
                `💬 Total Messages: ${stats.totalMessages}\n` +
                `📅 Messages Today: ${stats.todayMessages}\n` +
                `🔄 Voice Messages: ${stats.voiceMessages}\n` +
                `📎 File Shares: ${stats.fileShares}\n` +
                `🕒 Server Uptime: ${stats.uptime}`
            );
        } catch (error) {
            bot.sendMessage(chatId, '❌ Failed to fetch statistics');
        }
    });

    bot.onText(/\/broadcast (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== CONFIG.ADMIN_CHAT_ID) {
            bot.sendMessage(chatId, '❌ Admin access required');
            return;
        }

        const message = match[1];
        try {
            await addSystemMessage(`📢 Announcement: ${message}`);
            bot.sendMessage(chatId, '✅ Broadcast sent successfully');
        } catch (error) {
            bot.sendMessage(chatId, '❌ Broadcast failed');
        }
    });
}

// ==================== HELPER FUNCTIONS ====================
function generateId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function generateToken(user) {
    return jwt.sign(
        { 
            userId: user._id, 
            username: user.username,
            role: user.role 
        },
        CONFIG.JWT_SECRET,
        { expiresIn: '7d' }
    );
}

async function verifyToken(token) {
    try {
        return jwt.verify(token, CONFIG.JWT_SECRET);
    } catch (error) {
        return null;
    }
}

async function getChatStats() {
    const totalUsers = await usersCollection.countDocuments();
    const totalMessages = await messagesCollection.countDocuments();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayMessages = await messagesCollection.countDocuments({
        timestamp: { $gte: today }
    });
    
    const voiceMessages = await messagesCollection.countDocuments({ type: 'voice' });
    const fileShares = await messagesCollection.countDocuments({ type: 'file' });
    
    return {
        totalUsers,
        totalMessages,
        todayMessages,
        voiceMessages,
        fileShares,
        uptime: formatUptime(process.uptime())
    };
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const mins = Math.floor((seconds % (60 * 60)) / 60);
    return `${days}d ${hours}h ${mins}m`;
}

// ==================== MIDDLEWARE ====================
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    next();
});

// Authentication middleware
async function authenticate(req, res, next) {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        const decoded = await verifyToken(token);
        if (!decoded) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }

        const user = await usersCollection.findOne({ _id: new ObjectId(decoded.userId) });
        if (!user) {
            return res.status(401).json({ success: false, error: 'User not found' });
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({ success: false, error: 'Authentication failed' });
    }
}

// Admin middleware
function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
}

// ==================== ROUTES ====================

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await usersCollection.findOne({});
        res.json({
            status: '✅ Healthy',
            version: '3.0.0',
            database: 'MongoDB',
            uptime: formatUptime(process.uptime()),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ status: '❌ Unhealthy', error: error.message });
    }
});

// User Registration
app.post('/auth/register', async (req, res) => {
    try {
        const { username, name, password, email, phone } = req.body;

        // Validation
        if (!username || !name || !password) {
            return res.json({ success: false, error: 'Username, name and password are required' });
        }

        if (username.length < 3) {
            return res.json({ success: false, error: 'Username must be at least 3 characters' });
        }

        if (password.length < 6) {
            return res.json({ success: false, error: 'Password must be at least 6 characters' });
        }

        // Check if username exists
        const existingUser = await usersCollection.findOne({ 
            $or: [
                { username: username.toLowerCase() },
                { email: email }
            ]
        });

        if (existingUser) {
            return res.json({ success: false, error: 'Username or email already exists' });
        }

        // Create user
        const hashedPassword = await bcrypt.hash(password, 12);
        const user = {
            username: username.toLowerCase(),
            name: name.trim(),
            email: email?.toLowerCase() || null,
            phone: phone || null,
            password: hashedPassword,
            role: 'user',
            avatar: '👤',
            status: 'Hey there! I\\'m using ChatSphere',
            bio: '',
            points: 100,
            achievements: ['welcome'],
            isVerified: false,
            settings: {
                theme: 'dark',
                notifications: true,
                privacy: {
                    readReceipts: true,
                    onlineStatus: true,
                    messageTimer: 0
                }
            },
            createdAt: new Date(),
            lastSeen: new Date()
        };

        const result = await usersCollection.insertOne(user);
        const newUser = await usersCollection.findOne({ _id: result.insertedId });
        
        // Generate token
        const token = generateToken(newUser);

        // Log registration
        await auditLogCollection.insertOne({
            action: 'USER_REGISTER',
            userId: result.insertedId,
            username: username,
            timestamp: new Date(),
            ip: req.ip
        });

        res.json({
            success: true,
            message: 'Registration successful!',
            token,
            user: {
                id: newUser._id,
                username: newUser.username,
                name: newUser.name,
                avatar: newUser.avatar,
                role: newUser.role,
                points: newUser.points
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.json({ success: false, error: 'Registration failed' });
    }
});

// User Login
app.post('/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.json({ success: false, error: 'Username and password are required' });
        }

        // Find user
        const user = await usersCollection.findOne({ 
            username: username.toLowerCase() 
        });

        if (!user) {
            return res.json({ success: false, error: 'Invalid username or password' });
        }

        // Check password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.json({ success: false, error: 'Invalid username or password' });
        }

        // Update last seen
        await usersCollection.updateOne(
            { _id: user._id },
            { $set: { lastSeen: new Date() } }
        );

        // Generate token
        const token = generateToken(user);

        res.json({
            success: true,
            message: 'Login successful!',
            token,
            user: {
                id: user._id,
                username: user.username,
                name: user.name,
                avatar: user.avatar,
                role: user.role,
                points: user.points,
                settings: user.settings
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.json({ success: false, error: 'Login failed' });
    }
});

// Get current user
app.get('/auth/me', authenticate, async (req, res) => {
    try {
        res.json({
            success: true,
            user: {
                id: req.user._id,
                username: req.user.username,
                name: req.user.name,
                avatar: req.user.avatar,
                role: req.user.role,
                points: req.user.points,
                achievements: req.user.achievements,
                settings: req.user.settings
            }
        });
    } catch (error) {
        res.json({ success: false, error: 'Failed to get user data' });
    }
});

// Get all messages with pagination
app.get('/messages', authenticate, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        const messages = await messagesCollection.find()
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        // Get reactions for these messages
        const messageIds = messages.map(m => m.id);
        const reactions = await reactionsCollection.find({ 
            messageId: { $in: messageIds } 
        }).toArray();

        // Format response
        const formattedMessages = messages.reverse().map(message => ({
            id: message.id,
            userId: message.userId,
            username: message.username,
            name: message.name,
            avatar: message.avatar,
            message: message.message,
            type: message.type,
            timestamp: message.timestamp,
            replyTo: message.replyTo,
            file: message.file,
            reactions: message.reactions || {},
            isEdited: message.isEdited || false
        }));

        res.json({
            success: true,
            messages: formattedMessages,
            pagination: {
                page,
                limit,
                total: await messagesCollection.countDocuments()
            }
        });

    } catch (error) {
        console.error('Get messages error:', error);
        res.json({ success: false, error: 'Failed to load messages', messages: [] });
    }
});

// Send message
app.post('/messages', authenticate, async (req, res) => {
    try {
        const { message, replyTo, type = 'text' } = req.body;

        if (!message && type === 'text') {
            return res.json({ success: false, error: 'Message is required' });
        }

        const newMessage = {
            id: generateId(),
            userId: req.user._id.toString(),
            username: req.user.username,
            name: req.user.name,
            avatar: req.user.avatar,
            message: message,
            type: type,
            timestamp: new Date(),
            replyTo: replyTo || null,
            reactions: {},
            isEdited: false
        };

        await messagesCollection.insertOne(newMessage);

        // Award points for messaging
        await awardPoints(req.user._id, 'message_sent', 5);

        // Check for achievements
        await checkAchievements(req.user._id);

        res.json({
            success: true,
            message: newMessage
        });

    } catch (error) {
        console.error('Send message error:', error);
        res.json({ success: false, error: 'Failed to send message' });
    }
});

// Upload file/voice message
app.post('/upload', authenticate, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, error: 'No file uploaded' });
        }

        const { replyTo, type = 'file' } = req.body;
        
        // Convert file to base64 for storage
        const fileData = {
            name: req.file.originalname,
            type: req.file.mimetype,
            size: req.file.size,
            data: req.file.buffer.toString('base64')
        };

        const newMessage = {
            id: generateId(),
            userId: req.user._id.toString(),
            username: req.user.username,
            name: req.user.name,
            avatar: req.user.avatar,
            message: type === 'voice' ? 'Voice message' : `File: ${req.file.originalname}`,
            type: type,
            timestamp: new Date(),
            replyTo: replyTo || null,
            file: fileData,
            reactions: {},
            isEdited: false
        };

        await messagesCollection.insertOne(newMessage);

        // Award points for file share
        await awardPoints(req.user._id, 'file_shared', 10);

        res.json({
            success: true,
            message: newMessage
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.json({ success: false, error: 'Upload failed' });
    }
});

// Search messages
app.get('/search', authenticate, async (req, res) => {
    try {
        const { query, page = 1, limit = 20 } = req.query;

        if (!query || query.length < 2) {
            return res.json({ success: false, error: 'Search query too short' });
        }

        const searchResults = await messagesCollection.find({
            $text: { $search: query }
        })
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .toArray();

        res.json({
            success: true,
            results: searchResults,
            query: query,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: searchResults.length
            }
        });

    } catch (error) {
        res.json({ success: false, error: 'Search failed' });
    }
});

// Add reaction to message
app.post('/messages/:id/reactions', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { emoji } = req.body;

        const message = await messagesCollection.findOne({ id: id });
        if (!message) {
            return res.json({ success: false, error: 'Message not found' });
        }

        // Update reactions
        const reactions = message.reactions || {};
        reactions[emoji] = (reactions[emoji] || 0) + 1;

        await messagesCollection.updateOne(
            { id: id },
            { $set: { reactions: reactions } }
        );

        // Store individual reaction
        await reactionsCollection.insertOne({
            messageId: id,
            userId: req.user._id,
            emoji: emoji,
            timestamp: new Date()
        });

        res.json({ success: true, reactions: reactions });

    } catch (error) {
        res.json({ success: false, error: 'Failed to add reaction' });
    }
});

// User profiles
app.get('/users', authenticate, async (req, res) => {
    try {
        const users = await usersCollection.find(
            { role: { $ne: 'admin' } },
            { projection: { password: 0, email: 0, phone: 0 } }
        )
        .sort({ points: -1 })
        .limit(50)
        .toArray();

        res.json({ success: true, users });

    } catch (error) {
        res.json({ success: false, error: 'Failed to get users' });
    }
});

// Update user profile
app.put('/users/profile', authenticate, async (req, res) => {
    try {
        const { name, avatar, status, bio, settings } = req.body;
        
        const updateData = {};
        if (name) updateData.name = name;
        if (avatar) updateData.avatar = avatar;
        if (status) updateData.status = status;
        if (bio) updateData.bio = bio;
        if (settings) updateData.settings = { ...req.user.settings, ...settings };

        await usersCollection.updateOne(
            { _id: req.user._id },
            { $set: updateData }
        );

        const updatedUser = await usersCollection.findOne({ _id: req.user._id });

        res.json({
            success: true,
            user: {
                id: updatedUser._id,
                username: updatedUser.username,
                name: updatedUser.name,
                avatar: updatedUser.avatar,
                role: updatedUser.role,
                points: updatedUser.points,
                settings: updatedUser.settings
            }
        });

    } catch (error) {
        res.json({ success: false, error: 'Failed to update profile' });
    }
});

// Admin routes
app.get('/admin/stats', authenticate, requireAdmin, async (req, res) => {
    try {
        const stats = await getChatStats();
        const recentUsers = await usersCollection.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .toArray();

        const recentReports = await reportsCollection.find()
            .sort({ timestamp: -1 })
            .limit(10)
            .toArray();

        res.json({
            success: true,
            stats: {
                ...stats,
                recentUsers: recentUsers.length,
                pendingReports: await reportsCollection.countDocuments({ status: 'pending' })
            },
            recentUsers,
            recentReports
        });

    } catch (error) {
        res.json({ success: false, error: 'Failed to get admin stats' });
    }
});

// Report message
app.post('/messages/:id/report', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const message = await messagesCollection.findOne({ id: id });
        if (!message) {
            return res.json({ success: false, error: 'Message not found' });
        }

        await reportsCollection.insertOne({
            messageId: id,
            reporterId: req.user._id,
            reporterUsername: req.user.username,
            reason: reason,
            status: 'pending',
            timestamp: new Date()
        });

        // Notify admin via Telegram
        await sendToTelegram(
            `🚨 MESSAGE REPORTED\n` +
            `Message ID: ${id}\n` +
            `Reporter: ${req.user.username}\n` +
            `Reason: ${reason}\n` +
            `Time: ${new Date().toLocaleString()}`
        );

        res.json({ success: true, message: 'Report submitted successfully' });

    } catch (error) {
        res.json({ success: false, error: 'Failed to report message' });
    }
});

// Achievement system
async function awardPoints(userId, action, points) {
    try {
        await usersCollection.updateOne(
            { _id: userId },
            { $inc: { points: points } }
        );

        await auditLogCollection.insertOne({
            action: 'POINTS_AWARDED',
            userId: userId,
            points: points,
            reason: action,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Award points error:', error);
    }
}

async function checkAchievements(userId) {
    try {
        const user = await usersCollection.findOne({ _id: userId });
        const achievements = user.achievements || [];
        const newAchievements = [];

        // Check message count achievement
        const messageCount = await messagesCollection.countDocuments({ userId: userId.toString() });
        if (messageCount >= 10 && !achievements.includes('chatty')) {
            newAchievements.push('chatty');
            await awardPoints(userId, 'achievement_chatty', 50);
        }

        if (messageCount >= 100 && !achievements.includes('social_butterfly')) {
            newAchievements.push('social_butterfly');
            await awardPoints(userId, 'achievement_social_butterfly', 100);
        }

        // Add new achievements
        if (newAchievements.length > 0) {
            await usersCollection.updateOne(
                { _id: userId },
                { $push: { achievements: { $each: newAchievements } } }
            );
        }

        return newAchievements;

    } catch (error) {
        console.error('Check achievements error:', error);
        return [];
    }
}

// Telegram notification function
async function sendToTelegram(message) {
    try {
        await bot.sendMessage(CONFIG.ADMIN_CHAT_ID, message);
        return true;
    } catch (error) {
        console.log('Telegram send failed:', error.message);
        return false;
    }
}

// ==================== START SERVER ====================
async function startServer() {
    await initializeDatabase();
    setupTelegramBot();
    
    app.listen(PORT, () => {
        console.log(`
    🚀 CHATSPHERE 3.0 SERVER STARTED
    📍 Port: ${PORT}
    🗃️  Database: MongoDB Atlas
    🤖 Telegram: Connected
    👑 Admin: Ready (username: admin, password: admin123)
    🌐 URL: ${CONFIG.APP_URL}
    ✅ ALL SYSTEMS GO!
        `);
    });
}

startServer().catch(console.error);
