const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { DeepgramClient } = require('@deepgram/sdk');
require('dotenv').config();
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

async function sendTTS(text, streamSid, ws, markName = null) {
  try {
    const response = await axios.post(
      'https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=mulaw&sample_rate=8000&container=none',
      { text: text },
      {
        headers: {
          'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: 'stream'
      }
    );

    response.data.on('data', (chunk) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          event: 'media',
          streamSid: streamSid,
          media: { payload: chunk.toString('base64') }
        }));
      }
    });

    response.data.on('end', () => {
      if (markName && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          event: 'mark',
          streamSid: streamSid,
          mark: { name: markName }
        }));
      }
    });

  } catch (error) {
    console.error('TTS Error:', error.message);
  }
}

wss.on('connection', async (ws) => {
    console.log('Twilio connected to the media router');
  
    let deepgramLive = null;
    let streamSid = null; 
    let callSid = null;   
    let isAISpeaking = true; 
  
    //  Silence Detection Variables
    let silenceTimer = null;
    let silenceWarnings = 0; // Tracks if we've already warned them

    //  Function to stop the timer
    function clearSilenceTimer() {
      if (silenceTimer) clearTimeout(silenceTimer);
    }

    //  Function to manage the silence countdown
    function resetSilenceTimer() {
      clearSilenceTimer();
      
      // If the AI is talking or thinking, do NOT start the silence timer!
      if (isAISpeaking) return;

      if (silenceWarnings === 0) {
        // Strike 1: 5 seconds of silence
        silenceTimer = setTimeout(() => {
          console.log('\n[SILENCE] 5 seconds of dead air. Warning the user.');
          silenceWarnings = 1; // Mark that we warned them
          isAISpeaking = true; // Mute the mic while we warn them
          sendTTS("Hello? Are you still there?", streamSid, ws, 'unmute_mic');
        }, 5000);
      } else if (silenceWarnings === 1) {
        // Strike 2: 3 more seconds of silence (8 seconds total)
        silenceTimer = setTimeout(() => {
          console.log('\n[SILENCE] 8 seconds of total dead air. Dropping the call.');
          isAISpeaking = true;
          // Speak a polite goodbye, and send the 'end_of_call' mark to hang up!
          sendTTS("I haven't heard anything, so I'm going to disconnect now. Have a great day!", streamSid, ws, 'end_of_call');
        }, 3000);
      }
    }
    const BUSINESS_NAME = "Vertex Transformation";

const BUSINESS_DNA = `
- Business Name: Vertex Transformation
- Business Description: Vertex Transformation is a Manchester-based software firm specializing in custom AI automation and scalable SaaS development, helping enterprises bridge the gap between complex operational challenges and intelligent digital architecture.
- Services Offered: AI Automation Strategy & Workflow Optimization; Custom SaaS & Web Application Development (Next.js, Flutter, Supabase); Machine Learning & Predictive Model Integration; Software Quality Assurance (QA) and System Auditing.
- Opening Hours: Monday to Friday: 09:00 AM - 05:00 PM (GMT) / Remote & Client-Site Support Available.
- Knowledge Base: Expertise in modern web stacks (Next.js, Flutter, Prisma, Supabase). Specialized in enterprise data architectures, CRM/ERP integration testing, and bug-reporting methodologies. All consulting and development services operate under SB Intercontinental LTD.
- Transfer Rules: Technical scoping or architectural queries must be transferred to the lead technical consultant/developer. Billing, contract, or formal enterprise partnership inquiries must be routed directly to management.
- Escalation Rules: Urgent production or deployment failures reported by active enterprise clients must trigger an immediate high-priority alert to the engineering lead. Disputes or unresolved technical blocks lasting over 2 business hours are escalated to senior project management.
- Booking Policy: Consultation sessions must be scheduled at least 24 hours in advance via the official platform calendar. A preliminary discovery questionnaire must be completed before a formal technical audit or development sprint is booked.
- Business Policies: Confidentiality: All client code, data structures, and operational strategies are handled under strict NDA standards. Scope & Delivery: Development and AI integration projects follow defined milestone agreements. Quality Assurance: Every deployment undergoes a strict QA validation phase before production release.
`;

    ws.on('message', (message) => {
      const msg = JSON.parse(message);
  
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid; 
        callSid = msg.start.callSid; 
        console.log(`\n[SUCCESS] Call ID: ${callSid} | Stream ID: ${streamSid}\n`);
        
        sendTTS(`Hello! Thank you for calling ${BUSINESS_NAME}. I am the AI voice receptionist. How can I help you today?`, streamSid, ws, 'unmute_mic');

      } else if (msg.event === 'media') {
        const rawAudioBase64 = msg.media.payload;
        const buffer = Buffer.from(rawAudioBase64, 'base64');
  
        if (deepgramLive && !isAISpeaking) {
          try { deepgramLive.socket.send(buffer); } catch (e) {}
        }

      } else if (msg.event === 'stop') {
        console.log('\nCall terminated by Twilio.');
        clearSilenceTimer(); // Stop the timers if Twilio hangs up
        if (deepgramLive) {
           try { deepgramLive.socket.send(Buffer.alloc(0)); } catch (e) {}
        }
      
      } else if (msg.event === 'mark') {
        if (msg.mark.name === 'end_of_call') {
          console.log('\n[AI HANGUP]: AI finished speaking. Dropping the call.');
          clearSilenceTimer(); // Stop the timers
          ws.close();
        } else if (msg.mark.name === 'unmute_mic') {
          console.log('\n[TURN TAKING]: AI finished speaking. Microphone is LIVE.');
          isAISpeaking = false; 
          
          //  The mic is open, start the silence countdown!
          resetSilenceTimer(); 
        }
      }
    });

    try {
      deepgramLive = await deepgram.listen.v1.connect({
        model: 'nova-2-phonecall', 
        language: 'en-GB',         
        smart_format: true,        
        encoding: 'mulaw',         
        sample_rate: 8000,         
        interim_results: true,
        utterance_end_ms: "2000",
        vad_events: true,          
      });
  
      deepgramLive.on("open", () => {
        console.log('Deepgram connection opened successfully.');
      });
  
      deepgramLive.on("message", async (data) => {
        if (data.type === "Results") {
          const transcript = data.channel?.alternatives[0]?.transcript;
          if (!transcript) return;

          //If Deepgram hears you say ANYTHING, reset the warning strike and timer!
          silenceWarnings = 0;
          resetSilenceTimer();
    
          if (data.is_final) {
            if (isAISpeaking) return;

            isAISpeaking = true;
            clearSilenceTimer(); // Pause the timer while n8n thinks!
            
            console.log(`[FINAL TRANSCRIPT]: ${transcript}`);
            
            const fillers = [
              "Bear with me for just a second...",
              "Let me pull that up for you...",
              "One moment while I check the calendar...",
              "Give me just a quick sec...",
              "Let me take a look at that..."
            ];
            const randomFiller = fillers[Math.floor(Math.random() * fillers.length)];
            
            // sendTTS(randomFiller, streamSid, ws, null);
            
            try {
                const now = new Date();
                const currentDateTime = now.toLocaleString('en-GB', { timeZone: 'Europe/London' });
                const maxDateObj = new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000));
              const maxDate = maxDateObj.toLocaleString('en-GB', { timeZone: 'Europe/London' });
              const n8nWebhookUrl = 'http://localhost:5678/webhook/voice-receptionist';
              const response = await axios.post(n8nWebhookUrl, {
                transcript: transcript,
                callSid: callSid,
                currentDateTime:currentDateTime,
                maxDate: maxDate,
                businessName:BUSINESS_NAME,
                businessDNA: BUSINESS_DNA
              });
        
              let aiText = response.data[0].output;
              const shouldHangUp = aiText.includes('[END_CALL]');
              aiText = aiText.replace('[END_CALL]', '').trim();
              
              console.log(`[n8n RESPONSE]: ${aiText}`);
              
              sendTTS(aiText, streamSid, ws, shouldHangUp ? 'end_of_call' : 'unmute_mic');

            } catch (error) {
              console.error('Error calling n8n workflow:', error.message);
            }
          } else {
            console.log(`[Interim]: ${transcript}`);
          }
        }
      });
  
      deepgramLive.on("error", (err) => {
        console.error('Deepgram Error:', err);
      });

      deepgramLive.connect();
      await deepgramLive.waitForOpen();
  
    } catch (error) {
      console.error('Failed to start Deepgram:', error);
    }
  });

app.post('/incoming-call', (req, res) => {
    const NGROK_WS_URL = 'wss://smashup-halved-unleveled.ngrok-free.dev/media-stream';
  
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
  <Response>
      <Connect>
          <Stream url="${NGROK_WS_URL}" />
      </Connect>
  </Response>`;
  
    res.type('text/xml');
    res.send(twimlResponse);
  });

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});