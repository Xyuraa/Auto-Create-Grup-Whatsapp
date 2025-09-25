const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require("baileys")
const pino = require("pino")
const chalk = require("chalk")
const readline = require("readline")

// === Prompt Input Terminal ===
async function question(prompt) {
  process.stdout.write(prompt)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => rl.question("", (ans) => {
    rl.close()
    resolve(ans)
  }))
}

// === Fungsi Utama ===
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./session")

  // Cek versi WA
  const { version, isLatest } = await fetchLatestBaileysVersion()
  console.log(`Menggunakan WA v${version.join(".")}, isLatest: ${isLatest}`)

  const sock = makeWASocket({
    logger: pino({ level: "silent" }),
    printQRInTerminal: false, // QR dimatikan karena pakai pairing code
    auth: state,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    version,
  })

  // === Pairing Code ===
  if (!sock.authState.creds.registered) {
    try {
      const phoneNumber = await question("📱 Masukkan nomor diawali 62:\n")
      const code = await sock.requestPairingCode(phoneNumber.trim())
      console.log(`✅ Pairing Code: ${code}`)
    } catch (err) {
      console.error("Gagal mendapatkan pairing code:", err)
    }
  }

  // Simpan sesi login
  sock.ev.on("creds.update", saveCreds)

  // Status koneksi
  sock.ev.on("connection.update", (update) => {
    const { connection } = update
    if (connection === "close") {
      console.log(chalk.red("❌ Koneksi terputus, mencoba ulang..."))
      connectToWhatsApp()
    } else if (connection === "open") {
      console.log(chalk.green("✔ Terhubung ke WhatsApp"))
    }
  })

  // === Respon Pesan ===
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0]
    if (!msg.message) return

    const from = msg.key.remoteJid
    const body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ""

    // === Command: Buat Grup Otomatis ===
    if (body.startsWith(".cg")) {
      const args = body.split(" ")
      const total = parseInt(args[1]) || 0
      const baseName = args.slice(2).join(" ") || "Grup Baru"

      if (isNaN(total) || total <= 0) {
        return sock.sendMessage(from, { text: "❌ Format salah!\nContoh: .cg 5 grupku" }, { quoted: msg })
      }

      sock.sendMessage(from, { text: `🔄 Membuat ${total} grup dengan nama: ${baseName}` }, { quoted: msg })

      let current = 1
      const delayPerGroup = 5000 // 5 detik

      async function createGroups(start) {
        for (let i = start; i <= total; i++) {
          try {
            const groupName = `${baseName} ${i}`
            await sock.groupCreate(groupName, [from])
            console.log(chalk.green(`✔ Grup berhasil dibuat: ${groupName}`))

            current = i // update progress terakhir berhasil

            // Jeda sebelum bikin grup berikutnya
            await new Promise((resolve) => setTimeout(resolve, delayPerGroup))
          } catch (err) {
            console.error(chalk.red("❌ Gagal buat grup:"), err)

            // === Deteksi Over Limit ===
            if (String(err).includes("limit") || String(err).includes("403")) {
              console.log(chalk.yellow("⚠ Terkena limit, menunggu 1 menit sebelum lanjut..."))
              await new Promise((resolve) => setTimeout(resolve, 60000)) // delay 1 menit

              // Restart otomatis dari grup berikutnya
              return createGroups(current + 1)
            }
          }
        }

        sock.sendMessage(from, { text: `✅ Semua ${total} grup selesai dibuat!` }, { quoted: msg })
      }

      // Mulai proses
      createGroups(1)
    }
  })
}

// === Jalankan ===
connectToWhatsApp()
