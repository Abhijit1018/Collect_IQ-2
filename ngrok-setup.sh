#!/bin/bash
# ngrok Configuration for Twilio Integration with WebSocket Support

# Start ngrok - it handles BOTH HTTP and WebSocket automatically
# No special flags needed!

ngrok http 4004

# After running, ngrok will show:
# Session Status: online
# Forwarding: https://xxx.ngrok-free.dev -> http://localhost:4004
# Web Interface: http://127.0.0.1:4040

# Copy the HTTPS URL and set in your .env file:
# NGROK_URL=https://xxx.ngrok-free.dev

# Verify WebSocket is working:
# 1. Open http://127.0.0.1:4040 in browser (ngrok dashboard)
# 2. Make a test call (trigger STAGE_3 payer outreach)
# 3. Look for requests to /collect-iq/media-stream
# 4. Check status code: "101 Switching Protocols" = SUCCESS ✓
# 5. Previously: "400 Bad Request webSocket upgrade required" = FAILURE ✗

# Testing the endpoint manually (requires websocat or wscat):
# npm install -g wscat
# wscat -c "wss://xxx.ngrok-free.dev/collect-iq/media-stream?payerId=1001"

