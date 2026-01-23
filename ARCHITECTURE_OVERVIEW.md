# Twilio Voice Agent - Architecture Overview (Fixed)

## Problem Diagnosis

```
┌─────────────────────────────────────────────────────────────┐
│ BEFORE: Getting 400 Bad Request from ngrok                  │
└─────────────────────────────────────────────────────────────┘

User Call
   ↓
Twilio Service (calls your number)
   ↓
HTTP Request to /collect-iq/voice
   ↓
Your service responds with TwiML connecting to /media-stream
   ↓
Twilio tries to UPGRADE to WebSocket ❌
   ↓
NO /media-stream endpoint exists!
   ↓
400 Bad Request: "webSocket upgrade required"
   ↓
ngrok shows: GET /media-stream 400 Bad Request
```

## Solution Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ AFTER: WebSocket endpoint + express-ws configured           │
└──────────────────────────────────────────────────────────────┘

1️⃣ User calls Twilio number (e.g., +1-XXX-XXX-XXXX)
                ↓
2️⃣ Twilio dials → Makes HTTP POST to /collect-iq/voice
   URL: https://your-ngrok.ngrok.io/collect-iq/voice?payerId=1001
                ↓
3️⃣ Your Express server responds with TwiML:
   "Connect to WebSocket stream at wss://your-ngrok.ngrok.io/collect-iq/media-stream"
                ↓
4️⃣ Twilio upgrades connection to WebSocket ✅
   HTTP GET /collect-iq/media-stream 
   → 101 Switching Protocols (WebSocket established)
                ↓
5️⃣ Real-time audio flows through WebSocket
   Twilio → your app (audio frames)
   your app → Twilio (audio responses)
                ↓
6️⃣ Media Stream Handler processes audio:
   • Receive audio chunks in 'media' event
   • Send to AI (Gemini, ChatGPT, Whisper)
   • Generate response
   • Send back through media stream
                ↓
7️⃣ Call ends → 'stop' event triggers → Database updated
```

## Call Flow Diagram

```
┌─────────────┐
│   Twilio    │
│ (Call made) │
└──────┬──────┘
       │
       │ HTTP POST /collect-iq/voice?payerId=1001
       ↓
┌──────────────────────┐
│  Express.js Server   │
│                      │
│  /collect-iq/voice   │ ← Returns TwiML with WebSocket URL
│  (HTTP endpoint)     │
└──────────────────────┘
       │
       │ TwiML Response:
       │ <Connect>
       │   <Stream url="wss://.../>
       │ </Connect>
       ↓
┌──────────────────────────────────────┐
│         Twilio                       │
│  Upgrade HTTP to WebSocket           │
└──────────────────────────────────────┘
       │
       │ GET /collect-iq/media-stream
       │ (WebSocket Upgrade Request)
       ↓
┌───────────────────────────────────────────┐
│  Express.js + express-ws                  │
│                                           │
│  app.ws('/collect-iq/media-stream')  ✅   │
│  ├─ Event: 'connected'                    │
│  ├─ Event: 'start'                        │
│  ├─ Event: 'media' (audio data) →    AI   │
│  └─ Event: 'stop'                         │
└───────────────────────────────────────────┘
       ↕ (Bidirectional WebSocket)
       │ Audio frames in both directions
       ↓
┌─────────────┐
│   Twilio    │ ← Real-time audio to/from user
└─────────────┘
```

## File Structure After Fix

```
srv/
├── service.js              ← MODIFIED
│   ├── Added: const expressWs = require('express-ws')
│   ├── Added: expressWs(app)
│   ├── Updated: /collect-iq/voice endpoint
│   └── Added: /collect-iq/media-stream WebSocket handler
│
├── templates/
│   ├── stage1.js           (unchanged)
│   ├── stage2.js           (unchanged)
│   └── stage3.js           (unchanged)
│
└── service.cds             (unchanged)

package.json                ← MODIFIED
└── Added: "express-ws": "^5.0.2"

Documentation/
├── TWILIO_MEDIA_STREAM_FIX.md     ← NEW (Detailed explanation)
├── QUICK_FIX_REFERENCE.md         ← NEW (Quick reference)
└── ngrok-setup.sh                 ← NEW (Setup script)
```

## Key Changes Summary

| Item | Before | After |
|------|--------|-------|
| **Voice Endpoint** | Used DTMF Gather | Uses WebSocket Stream |
| **Audio Handling** | Keypress-based (DTMF) | Real-time audio stream |
| **Connection** | HTTP (simple) | HTTP → WebSocket upgrade |
| **Media Stream Endpoint** | ❌ Missing | ✅ app.ws('/collect-iq/media-stream') |
| **AI Processing** | Not possible | ✅ Ready for integration |
| **ngrok Status** | 400 Bad Request | 101 Switching Protocols ✓ |

## Deployment Checklist

- [ ] Run `npm install` to add express-ws
- [ ] Verify package.json has "express-ws": "^5.0.2"
- [ ] Check srv/service.js has expressWs initialization
- [ ] Start server with `npm start`
- [ ] Start ngrok: `ngrok http --ws 4004`
- [ ] Note ngrok URL and set NGROK_URL in .env
- [ ] Test voice call (STAGE_3 payer)
- [ ] Check ngrok dashboard for 101 Switching Protocols
- [ ] Monitor console for media-stream events

## Next Steps: AI Integration

The WebSocket media stream is now ready. To complete the AI voice agent:

1. **Add Speech-to-Text** (in media event handler)
   - Decode Twilio audio format (µ-law)
   - Send to Google Cloud Speech-to-Text or OpenAI Whisper
   - Get transcript

2. **Process with AI** (use existing Gemini/OpenAI setup)
   - Send transcript to LLM
   - Get intelligent response

3. **Add Text-to-Speech** (in media event handler)
   - Convert LLM response to speech
   - Encode to Twilio format (µ-law)
   - Send back through media stream

4. **Handle Context**
   - Keep conversation history
   - Reference payer details from database
   - Maintain call state

See examples in TWILIO_MEDIA_STREAM_FIX.md for code samples.

---
**Status**: ✅ WebSocket Configured | ⏳ Ready for AI Integration
