# 🚀 OPENAI REALTIME VOICE AGENT - QUICK START

## Status: ✅ READY TO TEST

Your CollectIQ system now has a real-time AI voice agent powered by OpenAI GPT-4o Realtime API!

---

## ARCHITECTURE

```
📞 Payer Calls → Twilio → ngrok tunnel → Your Service
                              ↓
                    WebSocket Connection
                              ↓
                    OpenAI Realtime API
                              ↓
                        AI Voice Response
                              ↓
                         Back to Payer
```

---

## WHAT'S RUNNING NOW

### Service Status
```
✅ CAP Service: http://localhost:4004
✅ ngrok tunnel: Active (check output for URL)
✅ Scheduler: Running every 2 minutes
✅ Email (STAGE_1 & 2): Configured
✅ Voice Agent (STAGE_3): OpenAI Realtime Ready
```

---

## HOW TO TEST

### Step 1: Make Sure ngrok is Running
```bash
# In a separate terminal
ngrok http 4004
```

You should see:
```
Forwarding: https://unbranching-finley-unbred.ngrok-free.dev -> http://localhost:4004
```

### Step 2: Trigger a Voice Call

**Option A: Wait for Scheduler (2 minutes)**
- Service will automatically call payer 1003 (Adani Group)
- Your phone receives the call from your Twilio number

**Option B: Trigger Manually (Instant)**
- In Fiori UI: Select Adani Group (STAGE_3)
- Click "Send Outreach"
- Your phone rings in 5 seconds

### Step 3: Answer the Call
```
AI: "Hello, this is Vegah CollectIQ calling on behalf of [Company]. 
     I'm calling regarding an outstanding balance on your account. 
     Is this a good time to speak?"

You: "Yes, go ahead"

AI: [Continues with payment collection conversation]
```

---

## WHAT THE AI DOES

When you answer the call:

1. ✅ **Greets you professionally** - Explains who's calling and why
2. ✅ **States amount due** - ₹85,000 (or your amount)
3. ✅ **Listens to you** - Understands your responses in real-time
4. ✅ **Adapts responses** - Real-time conversation, not scripted
5. ✅ **Proposes solutions** - Payment options, arrangements
6. ✅ **Ends professionally** - Confirms next steps

---

## MONITOR IN REAL-TIME

### Terminal: Service Logs
Look for:
```
>>> [TWILIO] Connected event received
>>> [OPENAI] Connecting to OpenAI Realtime API...
>>> [OPENAI] ✓ Connected to OpenAI Realtime API
>>> [OPENAI] Session configured
>>> [OPENAI] AI Response: Hello, this is...
>>> [TWILIO] Call completed and database updated
```

### ngrok Dashboard
- URL: http://127.0.0.1:4040
- Look for: `/collect-iq/media-stream`
- Status: `101 Switching Protocols` ✓
- Watch: Audio chunks flowing both directions

### Database
After call completes:
- Payer status: `CALL_COMPLETED`
- lastOutreachAt: Current timestamp

---

## CUSTOMIZE THE AI

Edit `srv/service.js`, find `instructions` field in `sessionConfig`:

```javascript
instructions: `You are a professional collections agent...`
```

**Examples:**
- Add more aggressive tone
- Add company-specific policies
- Add language preferences
- Add special handling rules

---

## VOICE OPTIONS

In `srv/service.js`, change:
```javascript
voice: 'alloy' 
// Options: alloy, echo, fable, onyx, nova, shimmer
```

---

## NEXT STAGE: FULL COLLECTION CYCLE

After voice call testing:

1. **Email Stage 1** (STAGE_1 Payer)
   - Gets friendly reminder email
   - Can click link to secure payment portal

2. **Email Stage 2** (STAGE_2 Payer)
   - Gets urgent payment notice
   - Escalated tone

3. **Voice Call** (STAGE_3 Payer)
   - Receives call from AI agent ← YOU ARE HERE
   - Real-time conversation
   - AI adapts to responses

---

## TROUBLESHOOTING

### ❌ Call doesn't come through?
- ✅ Verify phone is in Twilio verified list
- ✅ Check TWILIO_PHONE_NUMBER in `.env`
- ✅ Verify NGROK_URL matches active tunnel

### ❌ AI doesn't respond?
- ✅ Check OpenAI API key is valid
- ✅ Verify OpenAI account has credits
- ✅ Check service logs for OpenAI errors

### ❌ Audio quality issues?
- ✅ Check network/WiFi stability
- ✅ OpenAI Realtime API uses g711_ulaw codec (industry standard)
- ✅ Verify Twilio call quality

### ❌ WebSocket disconnects?
- ✅ Check ngrok is still running
- ✅ Verify NGROK_URL in logs
- ✅ Check internet connection

---

## COSTS

**OpenAI Realtime**: ~$0.10-0.50 per minute (varies by usage)
**Twilio**: Varies by region (~$0.01-0.05 per minute)

---

## PRODUCTION READY

This implementation is ready for production. When deploying to SAP BTP:

1. Update environment variables in Cloud Foundry
2. Update Twilio webhook URL to production domain
3. Update NGROK_URL to production
4. Monitor OpenAI credits and costs
5. Add error handling/retry logic as needed

---

## DEMO SCRIPT

### What to say when you answer:

```
AI: "Hello, is this [Your Name]?"
You: "Yes"

AI: "Hi [Name], I'm calling from Vegah Collections regarding 
     an outstanding balance on your account. Do you have a few 
     minutes to discuss this?"
You: "Sure"

AI: "Great! According to our records, you have an outstanding 
     balance of $85,000 that's been overdue. This is very 
     important and needs your immediate attention. How would 
     you like to proceed with payment?"
You: "I wasn't aware of this"

AI: "I understand. Let me explain the situation and provide 
     you with some options for payment..."
```

---

**Status**: 🎉 Speech-to-Speech AI Agent Active!
**Next**: Wait for scheduler or trigger manually to test
