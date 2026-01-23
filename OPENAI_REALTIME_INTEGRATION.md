# OpenAI Realtime Speech-to-Speech Integration ✅

## What's Been Implemented

Your CollectIQ system now has **real-time voice conversation** powered by OpenAI Realtime API:

```
Caller → Twilio Call → ngrok tunnel → Your Service
        ↓
     WebSocket Audio Stream (Twilio)
        ↓
     OpenAI Realtime API (GPT-4o Real-time)
        ↓
     AI Response Audio → Back to Twilio → Caller Hears AI
```

---

## How It Works

### 1. **Phone Call Initiated**
- STAGE_3 payer receives call from your Twilio number
- Call connects to `/collect-iq/media-stream` WebSocket

### 2. **Two-Way Audio Streaming**
- **Twilio → You**: Caller's voice sent as base64 audio chunks
- **You → OpenAI**: Audio forwarded to OpenAI Realtime API
- **OpenAI → You**: AI response audio received
- **You → Twilio**: Response audio sent back to caller

### 3. **AI Agent Behavior**
The AI is configured to:
- ✅ Be professional but friendly
- ✅ Confirm customer identity
- ✅ Discuss overdue amounts ($$$)
- ✅ Explain situation clearly
- ✅ Propose payment options
- ✅ Be empathetic but firm
- ✅ Keep responses concise
- ✅ End with clear next steps

### 4. **Call Completion**
- When call ends, database updates with `CALL_COMPLETED`
- OpenAI connection gracefully closed

---

## Configuration in `.env`

Already set up:
```
OPENAI_API_KEY=sk-proj-...your-key...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1659...
NGROK_URL=https://unbranching-finley-unbred.ngrok-free.dev
```

---

## Testing the Voice Agent

### Prerequisites
1. ✅ `.env` file filled with all credentials
2. ✅ Twilio phone numbers verified (for testing)
3. ✅ ngrok tunnel running: `ngrok http 4004`
4. ✅ CAP service running: `npm start`

### Test Steps

**Terminal 1: Start ngrok**
```bash
ngrok http 4004
```

**Terminal 2: Start CAP Service**
```bash
npm start
```

Look for:
```
[SCHEDULER] Cron job started: every 2 minutes (testing mode)
```

### Trigger Voice Call

**Option A: Automatic (Scheduler)**
- Wait 2 minutes for scheduler
- Payer 1003 (STAGE_3) will receive call

**Option B: Manual (Via UI)**
- Open Fiori UI
- Select Adani Group (STAGE_3 payer)
- Click "Send Outreach" button
- Your phone should ring immediately

### Monitor in Real-Time

**ngrok Dashboard**:
- Open: http://127.0.0.1:4040
- Watch WebSocket upgrade: `GET /collect-iq/media-stream 101 ↔`
- See audio chunks flowing both directions

**Service Logs**:
```
>>> [TWILIO] Connected event received
>>> [OPENAI] Connecting to OpenAI Realtime API...
>>> [OPENAI] ✓ Connected to OpenAI Realtime API
>>> [OPENAI] Session configured
>>> [TWILIO] Media stream started
>>> [OPENAI] AI Response: Hello, this is...
>>> [TWILIO] Media stream stopped
>>> [TWILIO] Call completed and database updated
```

---

## What the AI Offers

When you call the system, the AI will:

1. **Greet you professionally**
   - "Hello, this is Vegah CollectIQ calling on behalf of [Company]..."

2. **Verify Identity**
   - May ask to confirm account details

3. **Discuss Payment**
   - State amount due and overdue status
   - Explain urgency

4. **Offer Solutions**
   - Multiple payment options
   - Payment plan flexibility
   - Urgency without being aggressive

5. **Close Professionally**
   - Confirm next steps
   - Provide reference numbers
   - Schedule follow-up if needed

---

## Customization

### Modify AI Behavior

In `srv/service.js`, find the `instructions` field in `sessionConfig`:

```javascript
instructions: `You are a professional collections agent...`
```

Edit this to customize:
- **Tone**: More aggressive, friendly, etc.
- **Information**: Add company details, policies
- **Restrictions**: Don't ask for certain info, handle objections differently
- **Languages**: Add multilingual support

### Change Voice

In `sessionConfig`, modify:
```javascript
voice: 'alloy' // Options: alloy, echo, fable, onyx, nova, shimmer
```

### Adjust Response Length

```javascript
max_response_output_tokens: 1024 // Lower = shorter responses, Higher = longer responses
```

### Change Model

```javascript
model: 'gpt-4o-realtime-preview-2024-12-17' // Ensure it supports realtime
```

---

## Error Handling

### Issue: "OPENAI_API_KEY undefined"
- **Fix**: Verify API key in `.env`
- **Check**: `echo $env:OPENAI_API_KEY` in PowerShell

### Issue: "Failed to connect to OpenAI"
- **Fix**: Verify internet connection
- **Check**: OpenAI API status at https://status.openai.com
- **Verify**: API key is valid and has sufficient credits

### Issue: "No audio from AI"
- **Fix**: Check OpenAI model availability
- **Verify**: `gpt-4o-realtime-preview-2024-12-17` supports realtime mode
- **Check**: Audio format compatibility (g711_ulaw)

### Issue: "Call disconnects immediately"
- **Fix**: Verify NGROK_URL matches active tunnel
- **Check**: Twilio webhook returning proper TwiML
- **Verify**: Service logs for connection errors

---

## Next Steps

1. **Test with your phone number** (verify in Twilio first)
2. **Monitor logs** while testing
3. **Record a test call** to evaluate AI quality
4. **Fine-tune instructions** for better responses
5. **Deploy to production** when satisfied

---

## Production Deployment

When deploying to SAP BTP:

1. Update `.env` → Cloud Foundry environment variables
2. Ensure NGROK_URL → Production webhook URL
3. Update Twilio webhook in console
4. Monitor logs via `cf logs collectiq-srv`

---

## Pricing Notes

**OpenAI Realtime API**: 
- $0.10 per 1M input tokens
- $0.40 per 1M output tokens
- Audio included in token count

**Twilio**: 
- Variable based on minutes
- Check Twilio console for rates in your region

---

## Support & Documentation

- **OpenAI Realtime Docs**: https://platform.openai.com/docs/guides/realtime
- **Twilio Media Streams**: https://www.twilio.com/docs/voice/media-streams
- **gpt-4o-realtime**: Latest real-time voice model

---

**Status**: ✅ Speech-to-Speech AI Agent Ready!
