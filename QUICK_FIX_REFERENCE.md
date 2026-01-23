# Quick Fix Reference

## Problem
```
GET /media-stream 400 Bad Request
Error: webSocket upgrade required
```

## What Was Wrong
- Your service had no WebSocket endpoint at `/media-stream`
- Twilio tried to upgrade HTTP connection to WebSocket → Failed with 400

## What We Fixed

### 1. Added `express-ws` dependency
```diff
+ "express-ws": "^5.0.2"
```

### 2. Updated service.js
```javascript
// NEW: Initialize express-ws
const expressWs = require('express-ws');
expressWs(app);

// NEW: Voice endpoint now uses WebSocket
const twiml = new twilio.twiml.VoiceResponse();
const mediaStream = twiml.connect();
mediaStream.stream({
  url: `wss://${req.get('host')}/collect-iq/media-stream?payerId=${payerId}`,
});
```

### 3. Added WebSocket endpoint
```javascript
app.ws('/collect-iq/media-stream', (ws, req) => {
  ws.on('message', async (message) => {
    const data = JSON.parse(message);
    
    // Events: 'connected', 'start', 'media', 'stop'
    switch(data.event) {
      case 'media':
        // Process real-time audio here
        // TODO: Integrate AI speech-to-text
        break;
    }
  });
});
```

## Expected Result in ngrok
```
BEFORE (Error):
GET  /media-stream  400 Bad Request  webSocket upgrade required

AFTER (Fixed):
GET  /collect-iq/media-stream  101 Switching Protocols  ✓
```

## Installation
```bash
cd c:\Users\rotho\Desktop\classwork\ sap\collectiq\Collect_IQ-1
npm install
npm start
```

## Configuration
In your `.env`:
```
NGROK_URL=https://your-ngrok-url.ngrok.io
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=your_token
TWILIO_PHONE_NUMBER=+1...
```

## Next: AI Integration
Now you have real-time audio streaming. Add AI processing in the `'media'` event handler:
- Use OpenAI Whisper for speech-to-text
- Use Gemini AI for response generation  
- Use text-to-speech to send audio back

See `TWILIO_MEDIA_STREAM_FIX.md` for detailed integration examples.
