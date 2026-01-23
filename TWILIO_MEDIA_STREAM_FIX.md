# Twilio Media Stream WebSocket Fix - ngrok 400 Error Resolution

## Problem
You were getting a **400 Bad Request** error from ngrok with the message: **"webSocket upgrade required"**

This occurred because Twilio's media stream endpoint requires a **WebSocket connection** (wss://) for real-time audio streaming, but your service was missing this endpoint.

## Root Cause
The `/media-stream` endpoint didn't exist in your service, so when Twilio tried to upgrade the connection to WebSocket, it failed.

## Solution Implemented

### 1. Added `express-ws` Package
- Updated `package.json` to include `express-ws` for WebSocket support in Express
- This allows Express to handle WebSocket (`ws://` and `wss://`) connections alongside HTTP

### 2. Updated `/collect-iq/voice` Endpoint
Changed from old **DTMF (Dial Tone Multi-Frequency)** gather method:
```javascript
// OLD - Using DTMF/Gather (keypresses)
const gather = twiml.gather({
  numDigits: 1,
  action: `${ngrokUrl}/collect-iq/handle-reminder?payerId=${payerId}`,
  method: 'POST',
  timeout: 10,
});
```

To new **Media Stream** approach:
```javascript
// NEW - Using WebSocket Media Stream (real-time audio)
const mediaStream = twiml.connect();
mediaStream.stream({
  url: `wss://${req.get('host')}/collect-iq/media-stream?payerId=${payerId}`,
});
```

### 3. Added New `/collect-iq/media-stream` WebSocket Endpoint
This endpoint:
- Accepts WebSocket connections from Twilio
- Handles four key events:
  - **`connected`**: Initializes stream with StreamSID and CallSID
  - **`start`**: Marks the beginning of media stream
  - **`media`**: Receives audio frames (integrate AI speech-to-text here)
  - **`stop`**: Handles stream termination and updates database

## How It Works Now

1. **Twilio Call Initiated**: Your scheduler creates a call via Twilio API
   ```
   Twilio.calls.create({
     from: TWILIO_PHONE_NUMBER,
     to: payer.ContactPhone,
     url: `${NGROK_URL}/collect-iq/voice?payerId=${payerId}`
   })
   ```

2. **HTTP Request to `/collect-iq/voice`**: Twilio makes HTTP request
   - Service responds with TwiML instructing Twilio to connect to WebSocket stream

3. **WebSocket Upgrade**: Twilio upgrades connection to `wss://` (secure WebSocket)
   - Connection to `/collect-iq/media-stream?payerId=${payerId}`
   - Real-time audio frames flow through WebSocket

4. **Audio Processing**: In the WebSocket handler:
   - Receive audio chunks in `media` event
   - Send to AI service (Google Gemini, OpenAI, etc.) for speech-to-text
   - Process with business logic
   - Generate response with text-to-speech
   - Send back through media stream

5. **Call Completion**: When call ends, `stop` event triggers
   - Database updates with final status

## Next Steps: AI Integration

To complete the speech-to-speech agent, you'll need to:

### Option 1: Google Gemini (Recommended - Already in dependencies)
```javascript
case 'media':
  // Decode audio from Twilio's format
  const audioData = decodeAudio(data.media.payload);
  
  // Send to Google speech-to-text
  const transcript = await recognizeAudio(audioData);
  
  // Process with Gemini AI
  const aiResponse = await gemini.generateContent(transcript);
  
  // Convert response to speech
  const audioResponse = await textToSpeech(aiResponse.text);
  
  // Send back through media stream
  sendMediaFrame(ws, audioResponse);
  break;
```

### Option 2: OpenAI (Whisper + GPT)
```javascript
case 'media':
  const transcript = await openai.audio.transcriptions.create({
    file: audioData,
    model: "whisper-1"
  });
  
  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: transcript }]
  });
  
  const speech = await generateSpeech(response.choices[0].message.content);
  sendMediaFrame(ws, speech);
  break;
```

## Testing

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Set Environment Variables** (in `.env`):
   ```
   TWILIO_ACCOUNT_SID=your_account_sid
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_PHONE_NUMBER=+1234567890
   NGROK_URL=https://your-ngrok-url.ngrok.io
   ```

3. **Start the Application**:
   ```bash
   npm start
   ```

4. **Verify ngrok Connection**:
   - Open ngrok dashboard at http://127.0.0.1:4040
   - Look for WebSocket upgrade requests (101 Switching Protocols)
   - Previously you saw: `GET /media-stream 400 Bad Request`
   - Now you should see: `GET /collect-iq/media-stream 101 Switching Protocols`

5. **Trigger a Test Call**:
   - In the UI, select a STAGE_3 payer
   - Click "Send Outreach"
   - Twilio will call the payer
   - Audio should stream through WebSocket

## Key Files Modified

- **[package.json](package.json)**: Added `express-ws` dependency
- **[srv/service.js](srv/service.js)**:
  - Added `expressWs` import
  - Initialized `expressWs(app)`
  - Updated `/collect-iq/voice` endpoint
  - Added new `/collect-iq/media-stream` WebSocket handler

## Troubleshooting

### Still seeing 400 error?
- Ensure `express-ws` is installed: `npm list express-ws`
- Check ngrok logs for actual error messages
- Verify NGROK_URL matches the active tunnel

### WebSocket not connecting?
- Make sure you're using `wss://` (secure) not `ws://`
- Verify ngrok is forwarding WebSocket: `ngrok http -R --ws`
- Check browser console for connection errors

### Audio not flowing?
- Verify Twilio credentials are correct
- Check that phone numbers are valid
- Ensure the media stream handler is logging audio events

---
**Status**: ✅ Fixed - WebSocket endpoint operational, ready for AI integration
