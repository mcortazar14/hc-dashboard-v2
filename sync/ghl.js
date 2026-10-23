const https = require('https');

const TOKEN = process.env.GHL_TOKEN;
const LOCATION_ID = process.env.GHL_LOCATION_ID;

function ghlRequest(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'services.leadconnectorhq.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      }
    };
    let data = '';
    const req = https.request(opts, res => {
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + data.slice(0, 200))); }
      });
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('GHL request timeout: ' + path)); });
    req.on('error', reject);
    req.end();
  });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Fetch all contacts for an HC (with email, phone)
async function getContactsForHC(userId) {
  const all = [];
  let page = 1;
  while (true) {
    const data = await ghlRequest(
      `/contacts/?locationId=${LOCATION_ID}&assignedTo=${userId}&limit=100&page=${page}`
    );
    const contacts = data.contacts || [];
    all.push(...contacts);
    if (contacts.length < 100) break;
    page++;
    await sleep(200);
  }
  return all;
}

// Fetch all conversations for an HC
async function getConversationsForHC(userId) {
  const all = [];
  let lastDate = null, lastId = null;
  while (true) {
    let path = `/conversations/search?locationId=${LOCATION_ID}&limit=50&sort=asc&sortBy=last_message_date&type=inbox&assignedTo=${userId}`;
    if (lastDate) path += '&startAfterDate=' + lastDate;
    if (lastId) path += '&startAfterId=' + lastId;
    const data = await ghlRequest(path);
    const convos = data.conversations || [];
    all.push(...convos);
    if (convos.length < 50) break;
    const last = convos[convos.length - 1];
    lastDate = last.lastMessageDate;
    lastId = last.id;
    await sleep(200);
  }
  return all;
}

// Fetch recent messages for a conversation (last 100)
async function getMessages(conversationId) {
  const data = await ghlRequest(`/conversations/${conversationId}/messages?limit=100`);
  return data.messages?.messages || [];
}

module.exports = { getContactsForHC, getConversationsForHC, getMessages };
