'use strict';
// WA-AI-Bot v6.0

var fs   = require('fs');
var path = require('path');

// Remove Chromium lock files left by Docker/Railway restarts
function cleanLocks(dir) {
  var names = ['SingletonLock','SingletonCookie','SingletonSocket'];
  function walk(d, depth) {
    if (depth > 4) return;
    var entries; try { entries = fs.readdirSync(d, {withFileTypes:true}); } catch(e){ return; }
    entries.forEach(function(e) {
      var full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth+1);
      else if (names.indexOf(e.name) !== -1) {
        try { fs.unlinkSync(full); console.log('[lock] removed:', full); } catch(_){}
      }
    });
  }
  if (dir && fs.existsSync(dir)) walk(dir, 0);
}

var WWebJS    = require('whatsapp-web.js');
var Client    = WWebJS.Client;
var LocalAuth = WWebJS.LocalAuth;
var qrTerm    = require('qrcode-terminal');
var QRCode    = require('qrcode');
var OpenAI    = require('openai');
var express   = require('express');
var http      = require('http');
var ioMod     = require('socket.io');

// Config
var OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
var OPENAI_MODEL   = process.env.OPENAI_MODEL   || 'gpt-4o-mini';
var WAIT_MINUTES   = Math.max(0.1, parseFloat(process.env.WAIT_MINUTES || '5'));
var WAIT_MS        = Math.round(WAIT_MINUTES * 60 * 1000);
var PORT           = parseInt(process.env.PORT || '3000', 10);
var AUTH_DIR       = process.env.WA_AUTH_DIR || path.resolve('./wwebjs_auth');
var KEEPALIVE_MS   = 18000;

var AI_PROMPT = process.env.AI_PROMPT ||
  'Eres un asistente de atencion al cliente amable y profesional. ' +
  'Responde de forma breve y natural, como una persona real. ' +
  'Si preguntan por precios, horarios o servicios, di que pronto un asesor les atendera. ' +
  'Nunca digas que eres IA a menos que te lo pregunten directamente. ' +
  'Responde siempre en el mismo idioma del mensaje recibido.';

console.log('[boot] v6.0 | Auth:', AUTH_DIR, '| Wait:', WAIT_MINUTES+'min | Model:', OPENAI_MODEL);
if (!OPENAI_API_KEY) console.warn('[boot] WARNING: OPENAI_API_KEY not set');

var openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
var app    = express();
var server = http.createServer(app);
var io     = new ioMod.Server(server, { cors: { origin: '*' } });
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// State
var botStatus    = 'starting';
var currentQR    = null;
var lastQRRaw    = null;
var whoName      = '';
var keepAliveInt = null;
var waClient     = null;
var initializing = false;
var sessionReady = false;

var stats  = { replied: 0, skipped: 0, errors: 0 };
var events = [];
// chatId -> { name, lastMsg, history[], timerId, timerEnd, lastMsgTs }
var chats  = new Map();

function pushEvent(type, chatId, text) {
  var name = (chats.get(chatId) || {}).name || (chatId ? chatId.split('@')[0] : 'Sistema');
  var ev = { id: Date.now()+Math.random(), type:type, chatId:chatId, name:name, text:String(text||'').slice(0,300), ts:Date.now() };
  events.unshift(ev);
  if (events.length > 200) events.pop();
  io.emit('ev', ev);
}

function getState() {
  var now = Date.now(), pending = [];
  chats.forEach(function(d, id) {
    if (d.timerId && d.timerEnd)
      pending.push({ chatId:id, name:d.name, lastMsg:d.lastMsg||'', timerEnd:d.timerEnd, remaining:Math.max(0,d.timerEnd-now) });
  });
  return { botStatus:botStatus, stats:stats, pending:pending, qr:currentQR, who:whoName, waitMs:WAIT_MS, waitMin:WAIT_MINUTES, model:OPENAI_MODEL };
}

setInterval(function() { io.emit('state', getState()); }, 500);

function startKA() {
  // Keep-alive disabled: waClient.getState() polling was causing
  // "Attempted to use detached Frame" errors when AI tried to sendMessage.
  // The whatsapp-web.js client maintains its own connection internally.
  if (keepAliveInt) clearInterval(keepAliveInt);
  console.log('[ka] keep-alive disabled — relying on internal heartbeat');
}
function stopKA() { if (keepAliveInt) { clearInterval(keepAliveInt); keepAliveInt = null; } }

function cancelAllTimers() {
  chats.forEach(function(d) {
    if (d.timerId) { clearTimeout(d.timerId); d.timerId = null; d.timerEnd = null; }
  });
}

var PUPPETEER_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas', '--disable-gpu', '--no-first-run',
  '--no-zygote', '--single-process',
  '--ignore-profile-directory-lock',
  '--disable-features=LockProfileCookieDatabase',
  '--disable-background-networking', '--disable-extensions', '--mute-audio',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
];

function buildClient() {
  cleanLocks(AUTH_DIR);
  var c = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: PUPPETEER_ARGS,
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    }
  });

  c.on('qr', function(raw) {
    if (raw === lastQRRaw) return;
    lastQRRaw = raw; botStatus = 'qr'; sessionReady = false;
    qrTerm.generate(raw, { small: true });
    QRCode.toDataURL(raw).then(function(url) {
      currentQR = url;
      pushEvent('system', null, 'QR listo — escanea desde WhatsApp');
      io.emit('state', getState());
    }).catch(function(){});
  });

  c.on('authenticated', function() { console.log('[wa] Authenticated'); });

  c.on('ready', function() {
    if (sessionReady) { console.log('[wa] Ready event ignored (already ready)'); return; }
    initializing = false; sessionReady = true;
    botStatus = 'ready'; currentQR = null; lastQRRaw = null;
    try { whoName = c.info && (c.info.pushname || (c.info.wid && c.info.wid.user) || ''); } catch(e){ whoName=''; }
    console.log('[wa] Ready | User:', whoName);
    pushEvent('system', null, 'Conectado' + (whoName ? ' — ' + whoName : ''));
    startKA();
    io.emit('state', getState());
  });

  c.on('disconnected', function(reason) {
    sessionReady = false; botStatus = 'disconnected'; currentQR = null; lastQRRaw = null;
    stopKA(); cancelAllTimers(); initializing = false;
    var msg = reason === 'LOGOUT'
      ? 'Desvinculado desde el celular — reconectando...'
      : 'Desconectado (' + reason + ') — reconectando...';
    console.log('[wa]', msg);
    pushEvent('system', null, msg);
    io.emit('state', getState());
    setTimeout(initClient, 6000);
  });

  c.on('auth_failure', function() {
    initializing = false; sessionReady = false; botStatus = 'disconnected';
    currentQR = null; lastQRRaw = null; stopKA();
    pushEvent('system', null, 'Sesion expirada — escanea el QR de nuevo');
    io.emit('state', getState());
    setTimeout(initClient, 5000);
  });

  // Incoming message from someone else
  c.on('message', function(msg) {
    handleMsg(msg).catch(function(e){ console.error('[msg] handler error:', e.message); });
  });

  // Outgoing message from owner (manual reply) — cancel pending AI timer
  c.on('message_create', function(msg) {
    if (!msg.fromMe) return;
    var d = chats.get(msg.to);
    if (!d) return;
    // Cancel timer if running
    if (d.timerId) {
      clearTimeout(d.timerId); d.timerId = null; d.timerEnd = null;
      pushEvent('human_reply', msg.to, msg.body);
      console.log('[timer] cancelled — owner replied to', msg.to);
    }
    // Also set flag in case timer already fired but AI hasnt run yet
    d.manualReplied = true;
    // Reset flag after a window to avoid false positives on next conversation
    setTimeout(function() { var dd = chats.get(msg.to); if (dd) dd.manualReplied = false; }, WAIT_MS * 2);
  });

  return c;
}

function initClient() {
  if (initializing) { console.log('[wa] already initializing, skipping'); return; }
  initializing = true; sessionReady = false; botStatus = 'starting';
  if (waClient) { try { waClient.destroy(); } catch(e){} waClient = null; }
  waClient = buildClient();
  waClient.initialize().catch(function(e) {
    console.error('[wa] init error:', e.message);
    initializing = false; botStatus = 'disconnected';
    pushEvent('system', null, 'Error al iniciar: ' + e.message);
    io.emit('state', getState());
    setTimeout(initClient, 12000);
  });
}

// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────
async function handleMsg(message) {
  var chatId = message.from;
  if (message.fromMe || !chatId || chatId.includes('@g.us') || chatId === 'status@broadcast') return;

  var name = chatId.split('@')[0];
  try { var ct = await message.getContact(); name = ct.pushname || ct.name || name; } catch(e){}

  // Determine message text — handle any message type defensively
  var msgType = message.type || 'chat';
  var hasText = message.body && String(message.body).trim().length > 0;
  var msgText;
  if (hasText) {
    msgText = String(message.body).trim();
  } else if (msgType === 'sticker')                   { msgText = '[Sticker]'; }
  else if (msgType === 'image')                       { msgText = '[Imagen]'; }
  else if (msgType === 'video')                       { msgText = '[Video]'; }
  else if (msgType === 'audio' || msgType === 'ptt')  { msgText = '[Nota de voz]'; }
  else if (msgType === 'document')                    { msgText = '[Documento]'; }
  else if (msgType === 'location')                    { msgText = '[Ubicacion]'; }
  else                                                { msgText = '[Mensaje]'; }

  if (!chats.has(chatId)) chats.set(chatId, { name:name, history:[], timerId:null, timerEnd:null, lastMsgTs:0 });
  var d = chats.get(chatId);
  d.name    = name;
  d.lastMsg = msgText;
  d.lastMsgTs = message.timestamp;

  // Only add text messages to history (AI cant process media)
  if (msgText !== '[Sticker]' && msgText !== '[Nota de voz]') {
    d.history.push({ role: 'user', content: msgText });
    if (d.history.length > 20) d.history.shift();
  }

  console.log('[msg] FROM:', name, '| TYPE:', msgType, '| TEXT:', msgText.slice(0, 100));
  pushEvent('incoming', chatId, msgText);

  // Do NOT reset the timer if already running — messages accumulate in history.
  if (d.timerId) {
    console.log('[timer] already running for', name, '— message added to history (NOT resetting timer)');
    return;
  }

  // Dont start timer for media-only messages with no text (stickers, audio etc)
  // — the AI cant respond meaningfully to these alone
  if (msgText === '[Sticker]' || msgText === '[Nota de voz]') {
    console.log('[timer] skipping media-only message for', name);
    return;
  }

  d.timerEnd = Date.now() + WAIT_MS;
  console.log('[timer] STARTED for', name, '— fires at', new Date(d.timerEnd).toLocaleTimeString());

  d.timerId = setTimeout(async function() {
    d.timerId = null; d.timerEnd = null;

    var chatData  = chats.get(chatId);
    var history   = chatData ? chatData.history.slice() : [];
    var lastMsgTs = chatData ? chatData.lastMsgTs : 0;

    console.log('[timer] FIRED for', name, '| history:', history.length, 'msgs | lastMsgTs:', lastMsgTs);

    // Check if owner already replied manually.
    // We rely on message_create event which sets d.manualReplied = true when owner sends.
    // This avoids getChatById which crashes with "detached Frame" on Railway.
    var chatData2 = chats.get(chatId);
    var humanReplied = chatData2 && chatData2.manualReplied;
    if (humanReplied) {
      console.log('[timer] owner already replied (flagged) — skipping AI');
      if (chatData2) chatData2.manualReplied = false;
    }

    if (humanReplied) {
      pushEvent('skipped', chatId, 'Respondido manualmente — IA omitida');
      stats.skipped++;
      return;
    }

    if (!openai) {
      console.error('[ai] No OPENAI_API_KEY configured');
      pushEvent('error', chatId, 'OPENAI_API_KEY no configurado — revisa las variables de entorno');
      stats.errors++;
      return;
    }

    console.log('[ai] Calling', OPENAI_MODEL, 'for', name, 'with', history.length, 'messages...');
    var reply;
    try {
      var response = await openai.chat.completions.create({
        model:      OPENAI_MODEL,
        max_tokens: 400,
        messages:   [{ role: 'system', content: AI_PROMPT }].concat(history)
      });
      reply = ((response.choices[0] || {}).message || {}).content || '';
      reply = reply.trim();
      if (!reply) throw new Error('OpenAI returned empty response');
    } catch(err) {
      stats.errors++;
      console.error('[ai] OpenAI error for', name, ':', err.message);
      pushEvent('error', chatId, 'Error IA (OpenAI): ' + err.message);
      return;
    }

    // Send to WhatsApp with retry on detached-frame errors.
    // The browser frame can detach randomly; retry once after waiting for ready.
    var sent = false;
    for (var attempt = 1; attempt <= 3 && !sent; attempt++) {
      try {
        if (!waClient || !sessionReady) {
          console.warn('[send] session not ready, waiting...');
          await new Promise(function(r) { setTimeout(r, 2000); });
        }
        await waClient.sendMessage(chatId, reply);
        sent = true;
      } catch(sendErr) {
        var msg = String(sendErr.message || sendErr);
        console.warn('[send] attempt ' + attempt + ' failed:', msg);
        if (msg.indexOf('detached Frame') !== -1 || msg.indexOf('Session closed') !== -1) {
          // Wait for the client to reconnect and try again
          await new Promise(function(r) { setTimeout(r, 3000 * attempt); });
        } else {
          break;
        }
      }
    }

    if (!sent) {
      stats.errors++;
      console.error('[ai] Could not send to', name, 'after 3 attempts');
      pushEvent('error', chatId, 'No se pudo enviar — sesion WhatsApp inestable');
      return;
    }

    var current = chats.get(chatId);
    if (current) {
      current.history.push({ role: 'assistant', content: reply });
      if (current.history.length > 20) current.history.shift();
    }

    stats.replied++;
    console.log('[ai] REPLIED to', name, ':', reply.slice(0, 100));
    pushEvent('ai_reply', chatId, reply);
  }, WAIT_MS);
}

// ─── REST API ─────────────────────────────────────────────────────────────────
app.get('/api/status', function(_, res) { res.json(getState()); });
app.get('/api/events', function(_, res) { res.json(events.slice(0, 100)); });

app.post('/api/logout', async function(_, res) {
  res.json({ ok: true });
  pushEvent('system', null, 'Cerrando sesion en WhatsApp...');
  console.log('[logout] Starting logout sequence');

  // CRITICAL: logout() while session is still alive — this unlinks the phone.
  // If browser frame is detached, logout will fail but we continue anyway.
  if (waClient && sessionReady) {
    try {
      console.log('[logout] Calling waClient.logout() to unlink phone...');
      await Promise.race([
        waClient.logout(),
        new Promise(function(_, rej) { setTimeout(function() { rej(new Error('logout timeout')); }, 8000); })
      ]);
      console.log('[logout] Successfully unlinked from phone');
    } catch(e) {
      console.warn('[logout] logout() failed:', e.message);
    }
  } else {
    console.warn('[logout] Skipping logout() — session not ready');
  }

  sessionReady = false;
  try {
    if (waClient) {
      try { await waClient.destroy(); } catch(e){ console.warn('[logout] destroy err:', e.message); }
      waClient = null;
    }
    // Delete auth data — skip files that are still locked by the volume
    var authPath = path.resolve(AUTH_DIR);
    if (fs.existsSync(authPath)) {
      try {
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log('[logout] Auth data deleted');
      } catch(rmErr) {
        // EBUSY on Railway volume — delete individual session files instead
        console.warn('[logout] rmSync failed (' + rmErr.code + '), cleaning files individually');
        var lockNames = ['Default/Cookies','Default/Storage','session/Default'];
        lockNames.forEach(function(rel) {
          var p = path.join(authPath, rel);
          try { fs.rmSync(p, { recursive:true, force:true }); } catch(_){}
        });
        // At minimum, clear the lock files so Chromium starts fresh
        var locks = ['SingletonLock','SingletonCookie','SingletonSocket'];
        function rmLocks(dir, d) {
          if (d > 3) return;
          try { fs.readdirSync(dir, {withFileTypes:true}).forEach(function(e) {
            var fp = path.join(dir, e.name);
            if (e.isDirectory()) rmLocks(fp, d+1);
            else if (locks.indexOf(e.name) !== -1) { try { fs.unlinkSync(fp); } catch(_){} }
          }); } catch(_){}
        }
        rmLocks(authPath, 0);
        console.log('[logout] Partial cleanup done');
      }
    }
  } catch(e) { console.error('[logout] error:', e.message); }
  botStatus = 'disconnected'; currentQR = null; lastQRRaw = null;
  stopKA(); cancelAllTimers(); initializing = false;
  pushEvent('system', null, 'Sesion cerrada — generando nuevo QR...');
  io.emit('state', getState());
  setTimeout(initClient, 2000);
});

// SVG Favicon — WhatsApp style green gradient icon
app.get('/favicon.ico', function(_, res) {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send([
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
    '<defs>',
    '<linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">',
    '<stop offset="0%" stop-color="#25D366"/>',
    '<stop offset="100%" stop-color="#128C7E"/>',
    '</linearGradient>',
    '</defs>',
    '<rect width="32" height="32" rx="8" fill="url(#g)"/>',
    '<path fill="white" d="M16 5a11 11 0 0 0-9.26 16.9L5 27l5.26-1.7A11 11 0 1 0 16 5z"/>',
    '<path fill="#25D366" d="M21.5 18.8c-.28-.14-1.64-.8-1.89-.9-.26-.1-.44-.14-.63.14-.18.28-.72.9-.88 1.08-.16.18-.32.2-.6.07-.28-.14-1.18-.44-2.24-1.38-.83-.73-1.39-1.64-1.55-1.91-.16-.28-.02-.43.12-.57.12-.12.28-.32.42-.48.14-.16.18-.28.28-.46.1-.18.05-.34-.02-.48-.07-.14-.63-1.52-.86-2.08-.23-.54-.46-.47-.63-.48h-.54c-.18 0-.48.07-.74.34-.25.28-.96.94-.96 2.29s.98 2.66 1.12 2.84c.14.18 1.93 2.96 4.68 4.15.65.28 1.16.45 1.56.58.65.21 1.24.18 1.71.11.52-.08 1.64-.67 1.87-1.32.23-.65.23-1.2.16-1.32-.07-.11-.25-.18-.53-.32z"/>',
    '</svg>'
  ].join(''));
});

// ─── START ────────────────────────────────────────────────────────────────────
server.listen(PORT, function() {
  console.log('[server] Dashboard: http://localhost:' + PORT);
});

initClient();
