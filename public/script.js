// ===== CONFIGURATION =====
const CONFIG = {
    BACKEND_URL: window.location.origin,
    REFRESH_INTERVAL: 3000,
    TYPING_TIMEOUT: 2000,
    MAX_MESSAGE_LENGTH: 500
};

// ===== STATE MANAGEMENT =====
let state = {
    currentUser: null,
    isAdmin: false,
    messages: [],
    typingUsers: new Set(),
    isTyping: false,
    lastTypingTime: 0,
    selectedMessage: null,
    theme: localStorage.getItem('theme') || 'dark',
    autoScroll: true
};

// ===== DOM ELEMENTS =====
const elements = {
    // Screens
    loadingScreen: document.getElementById('loadingScreen'),
    authScreen: document.getElementById('authScreen'),
    chatScreen: document.getElementById('chatScreen'),
    blockedScreen: document.getElementById('blockedScreen'),
    
    // Auth Screen
    nameInput: document.getElementById('nameInput'),
    adminPasswordGroup: document.getElementById('adminPasswordGroup'),
    adminPassword: document.getElementById('adminPassword'),
    continueBtn: document.getElementById('continueBtn'),
    
    // Chat Screen
    backBtn: document.getElementById('backBtn'),
    themeToggle: document.getElementById('themeToggle'),
    adminBadge: document.getElementById('adminBadge'),
    onlineStatus: document.getElementById('onlineStatus'),
    messagesContainer: document.getElementById('messagesContainer'),
    messagesList: document.getElementById('messagesList'),
    typingIndicator: document.getElementById('typingIndicator'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    charCount: document.getElementById('charCount'),
    
    // Modals & Menus
    contextMenu: document.getElementById('contextMenu'),
    adminModal: document.getElementById('adminModal'),
    modalAdminPassword: document.getElementById('modalAdminPassword'),
    confirmAdmin: document.getElementById('confirmAdmin'),
    cancelAdmin: document.getElementById('cancelAdmin')
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
    setupEventListeners();
    applyTheme(state.theme);
});

async function initializeApp() {
    // Simulate loading
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if user is blocked
    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/health`);
        if (!response.ok) {
            showBlockedScreen();
            return;
        }
    } catch (error) {
        // If health check fails, assume connection issue rather than block
        console.log('Health check failed, continuing...');
    }
    
    hideLoadingScreen();
    showAuthScreen();
    
    // Check for existing session
    const savedName = localStorage.getItem('chatSphere_userName');
    if (savedName) {
        elements.nameInput.value = savedName;
    }
}

function setupEventListeners() {
    // Auth Screen
    elements.nameInput.addEventListener('input', handleNameInput);
    elements.continueBtn.addEventListener('click', handleAuth);
    elements.nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleAuth();
    });
    
    // Chat Screen
    elements.backBtn.addEventListener('click', handleBack);
    elements.themeToggle.addEventListener('click', toggleTheme);
    elements.messageInput.addEventListener('input', handleMessageInput);
    elements.messageInput.addEventListener('keydown', handleMessageKeydown);
    elements.messageInput.addEventListener('focus', handleInputFocus);
    elements.messageInput.addEventListener('blur', handleInputBlur);
    elements.sendBtn.addEventListener('click', sendMessage);
    
    // Context Menu
    document.addEventListener('click', hideContextMenu);
    elements.contextMenu.addEventListener('click', handleContextMenuAction);
    
    // Admin Modal
    elements.confirmAdmin.addEventListener('click', handleAdminAuth);
    elements.cancelAdmin.addEventListener('click', hideAdminModal);
    elements.modalAdminPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleAdminAuth();
    });
    
    // Window events
    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Messages container scroll
    elements.messagesList.addEventListener('scroll', handleMessagesScroll);
}

// ===== SCREEN MANAGEMENT =====
function hideLoadingScreen() {
    elements.loadingScreen.style.opacity = '0';
    setTimeout(() => {
        elements.loadingScreen.classList.add('hidden');
    }, 500);
}

function showAuthScreen() {
    elements.authScreen.classList.remove('hidden');
}

function showChatScreen() {
    elements.authScreen.classList.add('hidden');
    elements.chatScreen.classList.remove('hidden');
    elements.messageInput.focus();
    startMessagePolling();
}

function showBlockedScreen() {
    elements.loadingScreen.classList.add('hidden');
    elements.authScreen.classList.add('hidden');
    elements.chatScreen.classList.add('hidden');
    elements.blockedScreen.classList.remove('hidden');
}

// ===== AUTHENTICATION =====
function handleNameInput() {
    const name = elements.nameInput.value.trim();
    const isAdmin = name.toLowerCase() === 'admin';
    
    elements.adminPasswordGroup.classList.toggle('hidden', !isAdmin);
    
    // Add magnetic effect to button when name is entered
    if (name.length > 0) {
        elements.continueBtn.classList.add('magnetic-active');
    } else {
        elements.continueBtn.classList.remove('magnetic-active');
    }
}

async function handleAuth() {
    const name = elements.nameInput.value.trim();
    const password = elements.adminPassword.value;
    
    if (!name) {
        showError('Please enter your name');
        return;
    }
    
    if (name.toLowerCase() === 'admin' && !password) {
        showAdminModal();
        return;
    }
    
    await authenticateUser(name, password);
}

async function authenticateUser(name, password) {
    try {
        showLoadingState();
        
        const response = await fetch(`${CONFIG.BACKEND_URL}/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            state.currentUser = name;
            state.isAdmin = data.isAdmin || false;
            
            localStorage.setItem('chatSphere_userName', name);
            
            if (state.isAdmin) {
                elements.adminBadge.classList.remove('hidden');
                showSuccess('Admin access granted!');
            }
            
            showChatScreen();
            loadMessages();
            
        } else {
            if (data.error === 'ADMIN_PASSWORD_REQUIRED') {
                showAdminModal();
            } else if (data.error === 'INVALID_ADMIN_PASSWORD') {
                showError('Invalid admin password');
                elements.adminPassword.value = '';
                elements.adminPassword.focus();
            } else {
                showError(data.error || 'Authentication failed');
            }
        }
        
    } catch (error) {
        showError('Network error. Please check your connection.');
    } finally {
        hideLoadingState();
    }
}

function showAdminModal() {
    elements.adminModal.classList.remove('hidden');
    elements.modalAdminPassword.focus();
}

function hideAdminModal() {
    elements.adminModal.classList.add('hidden');
    elements.modalAdminPassword.value = '';
}

async function handleAdminAuth() {
    const password = elements.modalAdminPassword.value.trim();
    
    if (!password) {
        showError('Please enter admin password');
        return;
    }
    
    await authenticateUser('admin', password);
    hideAdminModal();
}

// ===== MESSAGE MANAGEMENT =====
async function loadMessages() {
    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/messages`);
        const data = await response.json();
        
        if (data.success) {
            if (JSON.stringify(state.messages) !== JSON.stringify(data.messages)) {
                state.messages = data.messages;
                renderMessages();
                
                if (state.autoScroll) {
                    scrollToBottom();
                }
            }
        }
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

function renderMessages() {
    const messagesHTML = state.messages.map(message => createMessageElement(message)).join('');
    elements.messagesList.innerHTML = messagesHTML;
}

function createMessageElement(message) {
    const isSent = message.name === state.currentUser;
    const isSystem = message.type === 'system';
    const isAdminMessage = message.type === 'admin';
    
    const messageClass = isSent ? 'sent' : isSystem ? 'system' : isAdminMessage ? 'admin' : 'received';
    
    const time = new Date(message.timestamp).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    return `
        <div class="message message-${messageClass}" data-message-id="${message.id}">
            <div class="message-bubble">
                ${!isSent && !isSystem ? `
                    <div class="message-header">
                        <span class="message-sender">${escapeHtml(message.name)}</span>
                        <span class="message-time">${time}</span>
                    </div>
                ` : ''}
                
                <div class="message-content">
                    ${escapeHtml(message.message)}
                </div>
                
                ${isSent || isSystem ? `
                    <div class="message-time" style="text-align: right; margin-top: 0.25rem;">
                        ${time}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

async function sendMessage() {
    const message = elements.messageInput.value.trim();
    
    if (!message) {
        showError('Please enter a message');
        return;
    }
    
    if (message.length > CONFIG.MAX_MESSAGE_LENGTH) {
        showError(`Message too long (max ${CONFIG.MAX_MESSAGE_LENGTH} characters)`);
        return;
    }
    
    try {
        // Optimistic update
        const tempMessage = {
            id: 'temp-' + Date.now(),
            name: state.currentUser,
            message: message,
            timestamp: new Date().toISOString(),
            type: state.isAdmin ? 'admin' : 'user'
        };
        
        state.messages.push(tempMessage);
        renderMessages();
        scrollToBottom();
        
        // Clear input
        elements.messageInput.value = '';
        updateCharCount();
        resetTyping();
        
        // Send to server
        const response = await fetch(`${CONFIG.BACKEND_URL}/send-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: state.currentUser,
                message: message,
                isAdmin: state.isAdmin
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            showError('Failed to send message');
            // Remove optimistic message
            state.messages = state.messages.filter(m => m.id !== tempMessage.id);
            renderMessages();
        } else {
            // Reload messages to get proper ID
            loadMessages();
        }
        
    } catch (error) {
        showError('Network error. Message not sent.');
        // Remove optimistic message
        state.messages = state.messages.filter(m => m.id !== tempMessage.id);
        renderMessages();
    }
}

// ===== TYPING INDICATORS =====
function handleMessageInput() {
    updateCharCount();
    
    if (!state.isTyping) {
        state.isTyping = true;
        // In a real app, you'd send typing start to server
    }
    
    state.lastTypingTime = Date.now();
    
    // Reset typing after timeout
    clearTimeout(state.typingTimeout);
    state.typingTimeout = setTimeout(resetTyping, CONFIG.TYPING_TIMEOUT);
}

function resetTyping() {
    state.isTyping = false;
    state.lastTypingTime = 0;
    // In a real app, you'd send typing stop to server
}

function updateTypingIndicator() {
    // This would be populated from server in real implementation
    if (state.typingUsers.size > 0) {
        const typingList = Array.from(state.typingUsers).slice(0, 3);
        let typingText = '';
        
        if (typingList.length === 1) {
            typingText = `${typingList[0]} is typing`;
        } else if (typingList.length === 2) {
            typingText = `${typingList[0]} and ${typingList[1]} are typing`;
        } else {
            typingText = `${typingList[0]}, ${typingList[1]} and others are typing`;
        }
        
        elements.typingIndicator.querySelector('.typing-text').textContent = typingText;
        elements.typingIndicator.classList.remove('hidden');
    } else {
        elements.typingIndicator.classList.add('hidden');
    }
}

// ===== UI INTERACTIONS =====
function handleMessageKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function handleInputFocus() {
    elements.chatInputContainer.classList.add('focused');
    // Scroll input into view on mobile
    setTimeout(() => {
        elements.messageInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
}

function handleInputBlur() {
    elements.chatInputContainer.classList.remove('focused');
}

function updateCharCount() {
    const length = elements.messageInput.value.length;
    elements.charCount.textContent = `${length}/${CONFIG.MAX_MESSAGE_LENGTH}`;
    
    if (length > CONFIG.MAX_MESSAGE_LENGTH * 0.9) {
        elements.charCount.style.color = 'var(--danger)';
    } else if (length > CONFIG.MAX_MESSAGE_LENGTH * 0.7) {
        elements.charCount.style.color = 'var(--accent)';
    } else {
        elements.charCount.style.color = 'var(--text-muted)';
    }
}

function handleMessagesScroll() {
    const { scrollTop, scrollHeight, clientHeight } = elements.messagesList;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    state.autoScroll = isNearBottom;
}

function scrollToBottom() {
    elements.messagesList.scrollTop = elements.messagesList.scrollHeight;
}

// ===== CONTEXT MENU (ADMIN) =====
function showContextMenu(messageId, x, y) {
    if (!state.isAdmin) return;
    
    state.selectedMessage = messageId;
    
    elements.contextMenu.style.left = x + 'px';
    elements.contextMenu.style.top = y + 'px';
    elements.contextMenu.classList.remove('hidden');
    
    // Adjust position if menu goes off-screen
    const rect = elements.contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        elements.contextMenu.style.left = (x - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        elements.contextMenu.style.top = (y - rect.height) + 'px';
    }
}

function hideContextMenu() {
    elements.contextMenu.classList.add('hidden');
    state.selectedMessage = null;
}

async function handleContextMenuAction(e) {
    e.stopPropagation();
    
    const action = e.target.closest('.menu-item')?.dataset.action;
    if (!action || !state.selectedMessage) return;
    
    hideContextMenu();
    
    switch (action) {
        case 'delete':
            await deleteMessage(state.selectedMessage);
            break;
        case 'block':
            await blockUser(state.selectedMessage);
            break;
        case 'cancel':
            // Do nothing
            break;
    }
}

async function deleteMessage(messageId) {
    if (!state.isAdmin) return;
    
    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/message/${messageId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                adminPassword: 'admin123' // In real app, this would be secure
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess('Message deleted');
            loadMessages();
        } else {
            showError('Failed to delete message');
        }
    } catch (error) {
        showError('Network error');
    }
}

async function blockUser(messageId) {
    if (!state.isAdmin) return;
    
    const message = state.messages.find(m => m.id === messageId);
    if (!message || !message.ip) {
        showError('Cannot block this user');
        return;
    }
    
    // In real implementation, you'd get IP from server
    const userIP = message.ip;
    
    try {
        const response = await fetch(`${CONFIG.BACKEND_URL}/block-ip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ip: userIP,
                reason: 'Admin action',
                adminPassword: 'admin123' // In real app, this would be secure
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess('User blocked successfully');
        } else {
            showError('Failed to block user');
        }
    } catch (error) {
        showError('Network error');
    }
}

// ===== THEME MANAGEMENT =====
function toggleTheme() {
    const newTheme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    state.theme = newTheme;
    localStorage.setItem('theme', newTheme);
    
    // Update theme toggle icon
    const themeIcon = elements.themeToggle.querySelector('.theme-icon');
    themeIcon.textContent = newTheme === 'dark' ? '🌙' : '☀️';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

// ===== POLLING =====
function startMessagePolling() {
    // Initial load
    loadMessages();
    
    // Set up interval
    setInterval(() => {
        loadMessages();
        updateOnlineStatus();
    }, CONFIG.REFRESH_INTERVAL);
}

function updateOnlineStatus() {
    const statusText = elements.onlineStatus.querySelector('.status-text');
    statusText.textContent = `Connected • ${state.messages.length} messages`;
}

// ===== EVENT HANDLERS =====
function handleBack() {
    if (confirm('Are you sure you want to leave the chat?')) {
        state.currentUser = null;
        state.isAdmin = false;
        state.messages = [];
        
        elements.chatScreen.classList.add('hidden');
        elements.authScreen.classList.remove('hidden');
        elements.adminBadge.classList.add('hidden');
        
        // Reset admin password field
        elements.adminPassword.value = '';
        elements.adminPasswordGroup.classList.add('hidden');
    }
}

function handleWindowResize() {
    // Adjust UI for mobile keyboard
    if (state.autoScroll) {
        setTimeout(scrollToBottom, 100);
    }
}

function handleBeforeUnload(e) {
    // Optional: Add confirmation for unsent messages
    if (elements.messageInput.value.trim()) {
        e.preventDefault();
        e.returnValue = 'You have unsent messages. Are you sure you want to leave?';
    }
}

// ===== UTILITY FUNCTIONS =====
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLoadingState() {
    elements.continueBtn.disabled = true;
    elements.continueBtn.querySelector('.btn-text').textContent = 'Connecting...';
}

function hideLoadingState() {
    elements.continueBtn.disabled = false;
    elements.continueBtn.querySelector('.btn-text').textContent = 'Continue to Chat';
}

function showError(message) {
    // Create temporary error message
    const errorEl = document.createElement('div');
    errorEl.className = 'error-message';
    errorEl.textContent = message;
    errorEl.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--danger);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: var(--radius-lg);
        z-index: 1000;
        animation: slideDown 0.3s ease;
    `;
    
    document.body.appendChild(errorEl);
    
    setTimeout(() => {
        errorEl.style.animation = 'slideUp 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(errorEl);
        }, 300);
    }, 3000);
}

function showSuccess(message) {
    // Create temporary success message
    const successEl = document.createElement('div');
    successEl.className = 'success-message';
    successEl.textContent = message;
    successEl.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--secondary);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: var(--radius-lg);
        z-index: 1000;
        animation: slideDown 0.3s ease;
    `;
    
    document.body.appendChild(successEl);
    
    setTimeout(() => {
        successEl.style.animation = 'slideUp 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(successEl);
        }, 300);
    }, 2000);
}

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideDown {
        from {
            opacity: 0;
            transform: translateX(-50%) translateY(-20px);
        }
        to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
    }
    
    @keyframes slideUp {
        from {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        to {
            opacity: 0;
            transform: translateX(-50%) translateY(-20px);
        }
    }
    
    .magnetic-active {
        animation: pulse 2s infinite;
    }
    
    .error-message, .success-message {
        box-shadow: var(--shadow-lg);
    }
`;
document.head.appendChild(style);

// ===== MESSAGE CONTEXT MENU TRIGGER =====
document.addEventListener('contextmenu', (e) => {
    const messageElement = e.target.closest('.message');
    if (messageElement && state.isAdmin) {
        e.preventDefault();
        showContextMenu(
            messageElement.dataset.messageId,
            e.pageX,
            e.pageY
        );
    }
});

// Touch support for long press
let touchTimer;
document.addEventListener('touchstart', (e) => {
    const messageElement = e.target.closest('.message');
    if (messageElement && state.isAdmin) {
        touchTimer = setTimeout(() => {
            const touch = e.touches[0];
            showContextMenu(
                messageElement.dataset.messageId,
                touch.pageX,
                touch.pageY
            );
        }, 500);
    }
});

document.addEventListener('touchend', () => {
    clearTimeout(touchTimer);
});

// ===== SERVICE WORKER (Optional) =====
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
        .then(registration => console.log('SW registered'))
        .catch(error => console.log('SW registration failed'));
}

console.log('🚀 ChatSphere Frontend Loaded Successfully!');