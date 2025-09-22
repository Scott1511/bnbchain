// nft_full_spoof_auto_bsc.js
// Spoofs ERC-20 (BUSD) and ERC-721 (Pancake Squad) for MetaMask / BSC testing.
// Automatically shows NFT in wallet by simulating a Transfer event.
// Target chain: BSC Mainnet (chainId 0x38)

const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const PORT = 9726;

// replace with the wallet address you want the spoof to show NFTs/tokens for:
const SPOOF_OWNER = '0x654467492CB23c05A5316141f9BAc44679EEaf8C'.toLowerCase();

// Real contracts on BSC mainnet
const SPOOF_NFT_CONTRACT = '0x0a8901f0e1a3f45b3f2e63f1bb46c9bf3f8633ec'.toLowerCase(); // Pancake Squad
const SPOOF_ERC20_CONTRACT = '0xe9e7cea3dedca5984780bafc599bd69add087d56'.toLowerCase(); // BUSD

const FAKE_BYTECODE = '0x6080604052348015600f57600080fd5b5060...'; // arbitrary non-empty bytecode

function encodeUint256(n) { return '0x' + BigInt(n).toString(16).padStart(64, '0'); }
function encodeAddress(a) { return '0x' + a.toLowerCase().replace('0x','').padStart(64,'0'); }
function encodeBool(b) { return '0x' + (b ? '1' : '0').padStart(64,'0'); }

app.post('/', (req, res) => {
  const { method, params, id } = req.body || {};
  const replyId = (typeof id !== 'undefined') ? id : null;

  // --- Basic RPC ---
  if (method === 'eth_chainId') return res.json({ jsonrpc:'2.0', id:replyId, result:'0x38' }); // BSC mainnet
  if (method === 'eth_blockNumber') return res.json({ jsonrpc:'2.0', id:replyId, result:'0x0' });
  if (method === 'eth_syncing') return res.json({ jsonrpc:'2.0', id:replyId, result:false });

  // --- eth_getCode ---
  if (method === 'eth_getCode') {
    const address = (params && params[0] || '').toLowerCase();
    if (address === SPOOF_NFT_CONTRACT || address === SPOOF_ERC20_CONTRACT)
      return res.json({ jsonrpc:'2.0', id:replyId, result:FAKE_BYTECODE });
    return res.json({ jsonrpc:'2.0', id:replyId, result:'0x' });
  }

  // --- eth_getLogs: simulate NFT Transfer ---
  if (method === 'eth_getLogs') {
    const filter = params && params[0] || {};
    const address = (filter.address || '').toLowerCase();
    const topics = filter.topics || [];
    if (address === SPOOF_NFT_CONTRACT) {
      const transferSig = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const toMatch = '0x' + SPOOF_OWNER.replace('0x','').padStart(64,'0');
      if (!topics[0] || topics[0].toLowerCase() === transferSig) {
        const log = {
          address: SPOOF_NFT_CONTRACT,
          topics: [
            transferSig,
            '0x0000000000000000000000000000000000000000000000000000000000000000',
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
        return res.json({ jsonrpc:'2.0', id:replyId, result:[log] });
      }
    }
    return res.json({ jsonrpc:'2.0', id:replyId, result:[] });
  }

  // --- eth_call ---
  if (method === 'eth_call') {
    const call = (params && params[0]) || {};
    const to = (call.to || '').toLowerCase();
    const data = (call.data || '').toLowerCase();
    const caller = (call.from || SPOOF_OWNER).toLowerCase();

    console.log(`[${new Date().toISOString()}] eth_call to=${to} from=${caller} data=${data.slice(0,10)}...`);

    // --- ERC20 (BUSD) spoof ---
    if (to === SPOOF_ERC20_CONTRACT) {
      if (data.startsWith('0x70a08231')) { // balanceOf
        const value = BigInt(1000) * (BigInt(10) ** BigInt(18)); // 1000 BUSD
        return res.json({ jsonrpc:'2.0', id:replyId, result:encodeUint256(value) });
      }
      if (data.startsWith('0x313ce567')) return res.json({ jsonrpc:'2.0', id:replyId, result:encodeUint256(18) }); // decimals
      if (data.startsWith('0x95d89b41')) return res.json({ jsonrpc:'2.0', id:replyId, result:'0x' + Buffer.from('BUSD').toString('hex').padEnd(64,'0') }); // symbol
      if (data.startsWith('0x06fdde03')) return res.json({ jsonrpc:'2.0', id:replyId, result:'0x' + Buffer.from('Binance USD').toString('hex').padEnd(64,'0') }); // name
    }

    // --- ERC721 (Pancake Squad) spoof ---
    if (to === SPOOF_NFT_CONTRACT) {
      if (data.startsWith('0x01ffc9a7')) return res.json({ jsonrpc:'2.0', id:replyId, result:encodeBool(true) }); // supportsInterface
      if (data.startsWith('0x6352211e')) return res.json({ jsonrpc:'2.0', id:replyId, result:encodeAddress(caller) }); // ownerOf
      if (data.startsWith('0x70a08231')) return res.json({ jsonrpc:'2.0', id:replyId, result:encodeUint256(1) }); // balanceOf
      if (data.startsWith('0xc87b56dd')) { // tokenURI
        const url = 'https://nft.pancakesquad.com/token/1';
        const hex = '0x' + Buffer.from(url).toString('hex').padEnd(64,'0');
        return res.json({ jsonrpc:'2.0', id:replyId, result:hex });
      }
      if (data.startsWith('0x06fdde03')) return res.json({ jsonrpc:'2.0', id:replyId, result:'0x' + Buffer.from('PancakeSquad').toString('hex').padEnd(64,'0') }); // name
      if (data.startsWith('0x95d89b41')) return res.json({ jsonrpc:'2.0', id:replyId, result:'0x' + Buffer.from('PSQUAD').toString('hex').padEnd(64,'0') }); // symbol
    }

    return res.json({ jsonrpc:'2.0', id:replyId, result:'0x' });
  }

  return res.json({ jsonrpc:'2.0', id:replyId, result:'0x' });
});

app.listen(PORT, () => {
  console.log(`NFT+ERC20 full-spoof RPC (BSC) running at http://localhost:${PORT}`);
  console.log(`chainId -> 0x38 (BSC mainnet)`);
  console.log(`SPOOF_NFT_CONTRACT=${SPOOF_NFT_CONTRACT} (Pancake Squad)`);
  console.log(`SPOOF_ERC20_CONTRACT=${SPOOF_ERC20_CONTRACT} (BUSD)`);
});
