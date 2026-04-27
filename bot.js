import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ARBEJDSMAPPE = '/home/hjemme/escort5-auto';
const SITE_NAVN = 'escort5.dk';

// Sessions til dialog flows
const sessions = {};

// ── /start ───────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `👋 Hej Søren! Jeg er din AI assistent til *${SITE_NAVN}*\n\nSkriv /help for at se hvad jeg kan!\n\n💬 Du kan også bare skrive til mig på dansk.`,
    { parse_mode: 'Markdown' });
});

// ── /status ──────────────────────────────────────────────
bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id, `✅ Hjemme server kører fint!\n🌐 Site: ${SITE_NAVN}`);
});

// ── /help ────────────────────────────────────────────────
bot.onText(/\/hjaelp|\/hjælp|\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, `📋 *Tilgængelige kommandoer:*

📝 *Artikler*
/artikel - Generer og publicer artikel
/manglende - Find byer der mangler artikler

🖼️ *Billeder*
/billede - Hent billeder fra en URL

🔍 *SEO*
/sogeord - Hent søgeord

⚙️ *Server*
/status - Server status
/help - Vis denne liste

💬 Skriv bare til mig på dansk!`,
    { parse_mode: 'Markdown' });
});

// ── /artikel (dialog) ────────────────────────────────────
bot.onText(/\/artikel$/, (msg) => {
  const chatId = msg.chat.id;
  sessions[chatId] = { type: 'artikel', step: 'by' };
  bot.sendMessage(chatId, `📝 *Artikel opsætning*\n\nHvilken by skal artiklen handle om?\n_(Fx: København, Aarhus, Ishøj)_`,
    { parse_mode: 'Markdown' });
});

// ── /manglende ───────────────────────────────────────────
bot.onText(/\/manglende/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '⏳ Finder manglende byer...');
  exec(`cd ${ARBEJDSMAPPE} && node manglende-byer.js`, { timeout: 60000 }, (error, stdout) => {
    if (error) {
      bot.sendMessage(chatId, `❌ Fejl: ${error.message}`);
    } else {
      bot.sendMessage(chatId, `📋 Manglende byer:\n\`\`\`\n${stdout.slice(0, 3000)}\n\`\`\``, { parse_mode: 'Markdown' });
    }
  });
});

// ── /billede (dialog) ────────────────────────────────────
bot.onText(/\/billede$/, (msg) => {
  const chatId = msg.chat.id;
  sessions[chatId] = { type: 'billede', step: 'url' };
  bot.sendMessage(chatId, `🖼️ *Hent billeder*\n\nHvilken URL vil du hente billeder fra?\n_(Fx: https://www.pornpics.com/galleries/...)_\n\n_Skriv /annuller for at afbryde_`,
    { parse_mode: 'Markdown' });
});

// ── /sogeord (dialog) ────────────────────────────────────
bot.onText(/\/sogeord$/, (msg) => {
  const chatId = msg.chat.id;
  sessions[chatId] = { type: 'sogeord', step: 'mode' };
  bot.sendMessage(chatId, `🔍 *Søgeord — vælg type:*\n\n1️⃣ Artikelmuligheder _(høj visning, lav CTR)_\n2️⃣ Lavt hængende frugter\n3️⃣ Brugerdefineret\n\n_Skriv 1, 2 eller 3_`,
    { parse_mode: 'Markdown' });
});

// ── /annuller ────────────────────────────────────────────
bot.onText(/\/annuller|annuller|stop/, (msg) => {
  const chatId = msg.chat.id;
  if (sessions[chatId]) {
    delete sessions[chatId];
    bot.sendMessage(chatId, '❌ Dialog afbrudt.');
  } else {
    bot.sendMessage(chatId, 'Ingen aktiv dialog at afbryde.');
  }
});

// ── Alle beskeder ─────────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const tekst = msg.text;

  if (!tekst || tekst.startsWith('/')) return;

  const session = sessions[chatId];

  // ── Artikel dialog ────────────────────────────────────
  if (session && session.type === 'artikel') {

    if (session.step === 'by') {
      session.by = tekst;
      session.step = 'emne';
      bot.sendMessage(chatId, `🖊️ Hvilket emne?\n_(Standard: escort guide — skriv "ok" for standard)_`, { parse_mode: 'Markdown' });

    } else if (session.step === 'emne') {
      session.emne = (tekst.toLowerCase() === 'ok') ? 'escort guide' : tekst;
      session.step = 'type';
      bot.sendMessage(chatId, `📄 Artikel eller blog?\n\n1️⃣ Artikel\n2️⃣ Blog\n\n_Skriv 1 eller 2_`, { parse_mode: 'Markdown' });

    } else if (session.step === 'type') {
      session.erBlog = tekst === '2';
      session.step = 'extra';
      bot.sendMessage(chatId, `✏️ Ekstra instruktioner?\n_(Valgfrit — skriv "nej" for at springe over)_`, { parse_mode: 'Markdown' });

    } else if (session.step === 'extra') {
      session.extra = (tekst.toLowerCase() === 'nej') ? '' : tekst;
      const { by, emne, extra, erBlog } = session;
      delete sessions[chatId];

      const typeNavn = erBlog ? 'blog' : 'artikel';
      const blogFlag = erBlog ? '--blog' : '';
      const extraArg = extra ? ` --extra "${extra}"` : '';

      bot.sendMessage(chatId, `⏳ Genererer ${typeNavn} om *${by}*...`, { parse_mode: 'Markdown' });

      exec(
        `cd ${ARBEJDSMAPPE} && node artikel.js --by "${by}" --emne "${emne}"${extraArg} ${blogFlag} --headless`,
        { timeout: 180000 },
        (error) => {
          if (error) {
            bot.sendMessage(chatId, `❌ Fejl: ${error.message}`);
          } else {
            bot.sendMessage(chatId, `✅ ${typeNavn.charAt(0).toUpperCase() + typeNavn.slice(1)} om *${by}* publiceret på ${SITE_NAVN}!`, { parse_mode: 'Markdown' });
          }
        }
      );
    }
    return;
  }

  // ── Billede dialog ────────────────────────────────────
  if (session && session.type === 'billede') {

    if (session.step === 'url') {
      if (!tekst.startsWith('http')) {
        bot.sendMessage(chatId, '❌ Det ser ikke ud som en URL. Send venligst en URL der starter med https://');
        return;
      }
      session.url = tekst.replace(/__/g, '').replace(/^_+|_+$/g, '').trim();
      session.step = 'mappe';
      bot.sendMessage(chatId, `📁 Hvilken mappe skal billederne gemmes i?\n_(Fx: escort, massage, kobenhavn, generelle)_`, { parse_mode: 'Markdown' });

    } else if (session.step === 'mappe') {
      session.mappe = tekst.toLowerCase().replace(/[^a-z0-9-]/g, '').trim() || 'generelle';
      session.step = 'crop';
      bot.sendMessage(chatId, `✂️ Hvor mange % skal afskæres af bunden?\n_(Standard: 3)_`, { parse_mode: 'Markdown' });

    } else if (session.step === 'crop') {
      session.crop = parseFloat(tekst) || 3;
      const { url, mappe, crop } = session;
      delete sessions[chatId];

      bot.sendMessage(chatId,
        `⏳ Henter alle billeder:\n• URL: ${url.substring(0, 60)}...\n• Mappe: *${mappe}*\n• Crop: ${crop}%\n\nDette kan tage 1-2 minutter...`,
        { parse_mode: 'Markdown' }
      );

      exec(
        `cd ${ARBEJDSMAPPE} && node hent-billede.js --url "${url}" --mappe "${mappe}" --crop ${crop}`,
        { timeout: 300000 },
        (error, stdout) => {
          if (error) {
            bot.sendMessage(chatId, `❌ Fejl: ${error.message}`);
          } else {
            const gemte = (stdout.match(/Gemt som/g) || []).length;
            bot.sendMessage(chatId,
              `✅ *${gemte} billeder gemt i billeder/${mappe}/*\n\`\`\`\n${stdout.slice(-500)}\n\`\`\``,
              { parse_mode: 'Markdown' }
            );
          }
        }
      );
    }
    return;
  }

  // ── Søgeord dialog ────────────────────────────────────
  if (session && session.type === 'sogeord') {

    if (session.step === 'mode') {
      if (tekst === '1') {
        delete sessions[chatId];
        bot.sendMessage(chatId, `⏳ Henter artikelmuligheder...`);
        exec(`cd ${ARBEJDSMAPPE} && node sogeord.js --antal 10`, { timeout: 60000 }, (error, stdout) => {
          if (error) bot.sendMessage(chatId, `❌ Fejl: ${error.message}`);
          else bot.sendMessage(chatId, `📊 *Artikelmuligheder:*\n\`\`\`\n${stdout.slice(0, 3000)}\`\`\``, { parse_mode: 'Markdown' });
        });
      } else if (tekst === '2') {
        delete sessions[chatId];
        bot.sendMessage(chatId, `⏳ Finder lavt hængende frugter...`);
        exec(`cd ${ARBEJDSMAPPE} && node sogeord.js --dage 180 --antal 10`, { timeout: 60000 }, (error, stdout) => {
          if (error) bot.sendMessage(chatId, `❌ Fejl: ${error.message}`);
          else bot.sendMessage(chatId, `🍋 *Lavt hængende frugter:*\n\`\`\`\n${stdout.slice(0, 3000)}\`\`\``, { parse_mode: 'Markdown' });
        });
      } else if (tekst === '3') {
        session.step = 'antal';
        bot.sendMessage(chatId, `🔧 Hvor mange søgeord vil du se? _(Standard: 10)_`, { parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(chatId, `Skriv venligst 1, 2 eller 3 😊`);
      }

    } else if (session.step === 'antal') {
      session.antal = parseInt(tekst) || 10;
      session.step = 'dage';
      bot.sendMessage(chatId, `📅 Hvor mange dage tilbage? _(Standard: 90)_`, { parse_mode: 'Markdown' });

    } else if (session.step === 'dage') {
      session.dage = parseInt(tekst) || 90;
      const { antal, dage } = session;
      delete sessions[chatId];

      bot.sendMessage(chatId, `⏳ Henter ${antal} søgeord fra de seneste ${dage} dage...`);
      exec(`cd ${ARBEJDSMAPPE} && node sogeord.js --antal ${antal} --dage ${dage}`, { timeout: 60000 }, (error, stdout) => {
        if (error) bot.sendMessage(chatId, `❌ Fejl: ${error.message}`);
        else bot.sendMessage(chatId, `🔍 *Søgeord:*\n\`\`\`\n${stdout.slice(0, 3000)}\`\`\``, { parse_mode: 'Markdown' });
      });
    }
    return;
  }

  // ── Claude AI fallback ────────────────────────────────
  try {
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: tekst }],
      system: `Du er en hjælpsom dansk AI assistent der hjælper Søren med at administrere ${SITE_NAVN}. Svar altid kort og præcist på dansk.`
    });
    bot.sendMessage(chatId, response.content[0].text);
  } catch (err) {
    bot.sendMessage(chatId, '❌ Fejl: ' + err.message);
  }
});

console.log('\n🤖 escort5.dk Bot starter...');
console.log(`📁 Arbejdsmappe: ${ARBEJDSMAPPE}`);
console.log('📡 Lytter efter beskeder...\n');
