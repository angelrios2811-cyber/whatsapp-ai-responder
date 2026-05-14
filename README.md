# 🤖 WA-AI-Bot v2.0

Auto-responder de WhatsApp con OpenAI + Dashboard en tiempo real.
Deploy en Railway.

## ¿Qué hace?
- Monitorea mensajes de WhatsApp
- Si el dueño **no responde en X minutos** → la IA responde automáticamente
- Dashboard en tiempo real con WebSockets
- Countdown por chat mostrando cuánto falta para la respuesta automática
- Keep-alive para mantener la sesión de WhatsApp activa
- Se reconecta automáticamente si se desconecta

---

## Variables de entorno (OBLIGATORIAS)

| Variable | Descripción | Ejemplo |
|---|---|---|
| `OPENAI_API_KEY` | Tu API key de OpenAI | `sk-proj-...` |
| `OPENAI_MODEL` | Modelo a usar | `gpt-4o-mini` (barato) o `gpt-4o` |
| `WAIT_MINUTES` | Minutos antes de que la IA responda | `5` |
| `AI_PROMPT` | Instrucciones de comportamiento | Ver abajo |
| `PORT` | Puerto del servidor | `3000` |

---

## 🚀 Correr localmente

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables (Mac/Linux)
export OPENAI_API_KEY=sk-proj-TU_KEY_AQUI
export WAIT_MINUTES=5

# Windows PowerShell
$env:OPENAI_API_KEY="sk-proj-TU_KEY_AQUI"
$env:WAIT_MINUTES="5"

# 3. Arrancar
npm start

# 4. Abrir el dashboard
# http://localhost:3000
```

---

## ☁️ Deploy en Railway (gratis)

### Paso 1 — Crea cuenta en Railway
[railway.app](https://railway.app) → Sign in with GitHub (gratis)

### Paso 2 — Sube el código a GitHub
```bash
git init
git add .
git commit -m "wa-ai-bot v2"
# Crea un repo en github.com y luego:
git remote add origin https://github.com/TU_USUARIO/wa-bot.git
git push -u origin main
```

### Paso 3 — Nuevo proyecto en Railway
1. New Project → Deploy from GitHub repo
2. Selecciona tu repositorio
3. Railway detecta el Dockerfile automáticamente

### Paso 4 — Variables de entorno en Railway
En tu proyecto → Variables → Raw Editor, pega esto y edita:

```
OPENAI_API_KEY=sk-proj-TU_KEY_AQUI
OPENAI_MODEL=gpt-4o-mini
WAIT_MINUTES=5
AI_PROMPT=Eres un asistente amable. Responde brevemente y de forma natural. Si preguntan por citas o precios, di que un asesor les contactará pronto.
```

### Paso 5 — Volumen persistente (MUY IMPORTANTE)
Para que la sesión de WhatsApp no se pierda al reiniciar:
1. En Railway → tu proyecto → Add Volume
2. Mount path: `/app/wwebjs_auth`
3. Esto guarda la sesión permanentemente

### Paso 6 — Conectar WhatsApp
1. Railway te da una URL pública (ej: `mi-bot.up.railway.app`)
2. Ábrela en el navegador → verás el QR
3. En el iPhone del cliente: WhatsApp → Configuración → Dispositivos vinculados → Vincular dispositivo
4. Escanea el QR
5. ¡Listo! El bot queda activo 24/7

---

## 📱 Conectar iPhone del cliente

1. Abrir **WhatsApp** en el iPhone
2. Ir a **Configuración** (ícono abajo a la derecha)
3. Tocar **Dispositivos vinculados**
4. Tocar el botón **+ Vincular un dispositivo**
5. Escanear el QR del dashboard

**¿Cuánto dura la sesión?**
Con el volumen persistente de Railway + el keep-alive del bot, la sesión dura indefinidamente. WhatsApp solo desvincula si el teléfono no tiene internet por más de 14 días.

---

## ✏️ Ejemplos de AI_PROMPT

**Tienda online:**
```
Eres el asistente de TiendaMax. Responde amablemente en español.
Horario de atención humana: Lunes-Viernes 9am-6pm.
Si preguntan por pedidos, pide número de orden.
Para devoluciones, di que en horario laboral un agente les ayudará.
```

**Restaurante:**
```
Eres el asistente de Restaurante La Mesa. 
Horario: Martes-Domingo 1pm-11pm, cerrado lunes.
Si preguntan por reservaciones, pide: fecha, hora, número de personas y nombre.
Menciona que confirmamos por este mismo WhatsApp.
```

**Clínica / médico:**
```
Eres asistente de la Clínica BienStar. Tono profesional y empático.
Para citas: pide nombre, motivo de consulta y disponibilidad.
Horario: Lunes-Viernes 8am-7pm, Sábados 9am-2pm.
Emergencias: llamar al 911 o acudir a urgencias.
```

---

## 💰 Costos aproximados

| Servicio | Costo |
|---|---|
| Railway | $5 crédito gratis/mes (suele alcanzar para uso normal) |
| OpenAI gpt-4o-mini | ~$0.0002 por mensaje (muy barato) |
| OpenAI gpt-4o | ~$0.005 por mensaje |

**Con 100 mensajes/día usando gpt-4o-mini → ~$0.60/mes**

---

## ⚠️ Notas importantes

- Este bot usa la API **no oficial** de WhatsApp. Funciona pero va contra los TOS de WhatsApp.
- Para uso comercial de alto volumen se recomienda la API oficial de Meta.
- Nunca uses para spam — puede resultar en ban del número.
- El bot NO responde a grupos, solo chats individuales.
