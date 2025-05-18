const fs = require('fs');
const pino = require('pino');
const { default: makeWASocket, Browsers, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");

const delay = ms => new Promise(res => setTimeout(res, ms));

const inputPath = 'i.json'; // yahan JSON file

// Console filtering (jaise tumne diya tha)
const originalConsoleLog = console.log;
function shouldIgnore(msg) {
  return (
    msg.includes("Closing session: SessionEntry") ||
    msg.includes("Decrypted message with closed session.") ||
    msg.includes("Removing old closed session: SessionEntry") ||
    msg.includes("Session error: Error: Bad MAC") ||
    msg.includes("Failed to decrypt message with any known session") ||
    msg.includes("Closing stale open session for new outgoing prekey bundle") ||
    msg.includes("Closing open session in favor of incoming prekey bundle")
  );
}
console.log = (...args) => {
  const msg = args.join(" ");
  if (!shouldIgnore(msg)) originalConsoleLog(...args);
};

// Read input.json and start session
async function start() {
  if (!fs.existsSync(inputPath)) {
    console.log("[X] input.json file missing!");
    process.exit(1);
  }
  let input;
  try {
    input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  } catch (e) {
    console.log("[X] Failed to parse input.json:", e.message);
    process.exit(1);
  }

  const { phoneNumber, haterID, isGroup, filePath, delayTime } = input;

  if (!phoneNumber || !haterID || !filePath) {
    console.log("[X] phoneNumber, haterID, or filePath missing in input.json");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.log(`[X] Number file ${filePath} not found!`);
    process.exit(1);
  }
  if (!isGroup) {
    console.log("[!] isGroup is false, nothing to add.");
    process.exit(0);
  }

  const sessionPath = `./session-${phoneNumber}`;
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

  // Get Baileys version
  const { version } = await fetchLatestBaileysVersion();

  // Setup auth state
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  // Create socket
  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
    },
    browser: Browsers.ubuntu('Chrome'),
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      console.log("[!] Connection closed, reconnecting...");
      start(); // reconnect
    } else if (connection === 'open') {
      console.log("[✓] Connected!");
      startAdding(sock, phoneNumber, haterID, filePath, delayTime || 120);
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

// Function to add members
async function startAdding(sock, phoneNumber, haterID, filePath, delaySeconds) {
  const groupJid = `${haterID}@g.us`;

  const rawNumbers = fs.readFileSync(filePath, 'utf-8').split('\n');
  const numbers = rawNumbers.map(n => n.replace(/\D/g, '').trim()).filter(n => n.length > 5);

  for (const number of numbers) {
    const jid = `${number}@s.whatsapp.net`;
    try {
      await sock.groupParticipantsUpdate(groupJid, [jid], 'add');
      console.log(`[+] Added ${number} to group ${haterID}`);
    } catch (err) {
      const errMsg = err.message || '';
      if (errMsg.includes('too many contacts')) {
        console.log("[X] Rate limit reached, exiting...");
        process.exit(1);
      }
      console.log(`[!] Failed to add ${number}: ${errMsg}`);
    }
    await delay(delaySeconds * 1000);
  }

  console.log("[i] All numbers processed. Exiting.");
  process.exit(0);
}

// Start everything
start();
