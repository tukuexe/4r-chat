const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// === YOUR ACTUAL VALUES ===
const BOT_TOKEN = '8170582086:AAEb5LIj1flmUeeBlYQZaNm81lxufzA3Zyo'; // Your bot token
const CHAT_ID = '6142816761'; // Your personal chat ID
// YOUR MONGODB CONNECTION STRING
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://schoolchat_user:tukubhuyan123@cluster0.i386mxq.mongodb.net/schoolchat?retryWrites=true&w=majority';

const bot = new TelegramBot(BOT_TOKEN, { polling: false });
let db, messagesCollection;

// Connect to MongoDB
async function connectDB() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    console.log('MongoDB URI:', MONGODB_URI.replace(/tukubhuyan123/g, '***')); // Hide password in logs
    
    const client = new MongoClient(MONGODB_URI, {
      serverApi: ServerApiVersion.v1
    });
    
    await client.connect();
    db = client.db('schoolchat');
    messagesCollection = db.collection('messages');
    
    // Test connection
    await messagesCollection.findOne({});
    console.log('✅ Connected to MongoDB successfully!');
    
    // Create index for better performance
    await messagesCollection.createIndex({ timestamp: 1 });
    console.log('✅ Database index created!');
    
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.log('💡 Check:');
    console.log('1. MongoDB Atlas cluster is running');
    console.log('2. IP address is allowed (0.0.0.0/0)');
    console.log('3. Username and password are correct');
  }
}

connectDB();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all messages
app.get('/messages', async (req, res) => {
  try {
    if (!messagesCollection) {
      return res.status(500).json({ error: 'Database not connected' });
    }
    
    const messages = await messagesCollection.find().sort({ timestamp: 1 }).toArray();
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send new message
app.post('/send-message', async (req, res) => {
  try {
    const { name, message } = req.body;

    if (!name || !message) {
      return res.status(400).json({ error: 'Name and message are required' });
    }

    if (!messagesCollection) {
      return res.status(500).json({ error: 'Database not connected' });
    }

    const newMessage = {
      name: name.trim(),
      message: message.trim(),
      timestamp: new Date(),
      id: Date.now().toString()
    };

    // Save to database
    await messagesCollection.insertOne(newMessage);
    console.log(`💾 Message saved from ${newMessage.name}`);

    // Also send to your Telegram (optional)
    try {
      await bot.sendMessage(CHAT_ID, `💬 From ${name}:\n${message}`);
      console.log('📱 Message also sent to Telegram');
    } catch (tgError) {
      console.log('⚠️ Telegram notification failed, but message saved to DB');
    }

    res.json({ success: true, message: 'Message sent!' });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    if (messagesCollection) {
      await messagesCollection.findOne({});
      res.json({ 
        status: '✅ Healthy', 
        database: 'Connected',
        totalMessages: await messagesCollection.countDocuments(),
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({ 
        status: '❌ Unhealthy', 
        database: 'Disconnected',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(500).json({ 
      status: '❌ Unhealthy', 
      database: 'Error: ' + error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get message count
app.get('/stats', async (req, res) => {
  try {
    if (!messagesCollection) {
      return res.status(500).json({ error: 'Database not connected' });
    }
    
    const totalMessages = await messagesCollection.countDocuments();
    const latestMessage = await messagesCollection.find().sort({ timestamp: -1 }).limit(1).toArray();
    
    res.json({
      totalMessages: totalMessages,
      latestMessage: latestMessage[0] || null,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Clear all messages (for admin use)
app.delete('/clear-messages', async (req, res) => {
  try {
    if (!messagesCollection) {
      return res.status(500).json({ error: 'Database not connected' });
    }
    
    const result = await messagesCollection.deleteMany({});
    console.log('🗑️ All messages cleared');
    
    res.json({ 
      success: true, 
      message: 'All messages cleared',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error clearing messages:', error);
    res.status(500).json({ error: 'Failed to clear messages' });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Stats: http://localhost:${PORT}/stats`);
  console.log(`💬 Chat app: http://localhost:${PORT}/`);
  console.log(`🗑️ Clear messages: http://localhost:${PORT}/clear-messages (DELETE)`);
});
