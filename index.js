require('dotenv').config()
const fs = require('fs');
const pino = require('pino');
const chalk = require('chalk');
const readline = require('readline');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const { toBuffer } = require('qrcode');
const { exec } = require('child_process');
const { 
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  makeWASocket,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const { app } = require('./lib/server');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text) => new Promise((resolve) => rl.question(text, resolve))

let pairingStarted = false;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestBaileysVersion();

  const conn = makeWASocket({
    printQRInTerminal: false,
    syncFullHistory: true,
    markOnlineOnConnect: true,
    version,
    browser: ["Windows", "Chrome", "20.0.04"],
    logger: pino({ level: 'fatal' }),
    auth: { 
      creds: state.creds, 
      keys: makeCacheableSignalKeyStore(state.keys, pino().child({ level: 'silent' }))
    }
  });

  conn.ev.on('creds.update', saveCreds)

  conn.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update

    if ((connection === 'connecting' || !!qr) && !conn.authState.creds.registered && !pairingStarted) {
      setTimeout(async () => {
        pairingStarted = true;
        const phone_number = await question(chalk.green("> Masukan nomor aktif (awali dengan 62):\n"));
        try {
          const code = await conn.requestPairingCode(phone_number, "NDIKZONE");
          console.log(chalk.green(`\n[✓] Kode Pairing Anda: ${chalk.bold.white(code?.match(/.{1,4}/g)?.join('-') || code)}`));
        } catch (error) {
          console.log(chalk.red(`\n[✗] Gagal pairing: ${error.message}`));
          process.exit(1);
        }
      }, 3000)
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output.statusCode
      console.log('Disconnected:', reason);
      exec('rm -rf ./auth/*')
      process.exit(1)
    }

    if (connection == 'open') {
      console.log('✅ Connected:', JSON.stringify(conn.user, null, 2));

      if (process.env.AUTO_GROUP === "true") {
        await autoCreateGroups(conn, database)
      } else {
        console.log(chalk.yellow("⚠️ AUTO_GROUP= false → Grup otomatis tidak dibuat"))
      }
    }

    if (qr) {
      qrcode.generate(qr, { small: true })
      app.use('/qr', async (req, res) => {
        res.setHeader('content-type', 'image/png')
        res.end(await toBuffer(qr))
      });
    }
  });
}

// === AUTO CREATE GROUP ===
const delay = ms => new Promise(res => setTimeout(res, ms))
function getMonthNumber() {
  return new Date().getMonth() + 1 // bulan 1-12
}

async function autoCreateGroups(conn, db) {
  let hasil = []
  const month = getMonthNumber()

  for (let i = 1; i <= 5; i++) {
    let randomNum = Math.floor(Math.random() * 100)
    let groupName = `grup ke ${i} ${month} ${randomNum}`
    let member = [conn.user.id]

    try {
      let group = await conn.groupCreate(groupName, member)
      if (!group || !group.id) throw new Error("Respon tidak valid")

      let groupId = group.id
      let list = db.list().buatgc ||= {}
      list[groupId] = { nama: groupName, creator: conn.user.id }
      await db.save()

      hasil.push(`✅ Grup *${groupName}* dibuat! 🆔 ${groupId}`)

      if (i < 5) await delay(4000)
    } catch (e) {
      console.error("❌ Error buat grup:", e)
    }
  }

  console.log(chalk.green("📢 Semua grup berhasil dibuat otomatis"))
}

start()
