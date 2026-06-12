import "./load_env";
import { db } from "./lib/firebase";
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  serverTimestamp,
  increment,
  query,
  where,
  limit
} from "firebase/firestore";
import twilio from "twilio";

// Types
type Campaign = {
  id: string;
  name: string;
  templateSid: string;
  templateName: string;
  templateText: string;
  status: "draft" | "running" | "paused" | "completed";
  createdAt: any;
  totalCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  delaySeconds: number;
  stopOnSpam: boolean;
  failureThreshold: number;
  consecutiveFailureThreshold: number;
  variableMappings?: Record<string, { type: "csv" | "default"; value: string; fallback?: string }>;
  isSimulated?: boolean;
};

type CampaignRecipient = {
  phone: string;
  variables: Record<string, string>;
  status: "pending" | "sending" | "sent" | "delivered" | "read" | "failed";
  twilioSid?: string;
  errorCode?: string;
  errorMessage?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
};

// Clean phone number helper
function cleanPhone(phone: string): string {
  if (!phone) return "";
  let raw = phone.trim().replace(/^whatsapp:/, "");
  let cleaned = raw.replace(/[^\d+]/g, "");
  
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 5) return "";
  
  if (cleaned.startsWith("00")) {
    cleaned = "+" + cleaned.substring(2);
  }
  
  if (!cleaned.startsWith("+") && cleaned.startsWith("0") && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }
  
  if (!cleaned.startsWith("+")) {
    if (/^\d{10}$/.test(cleaned)) {
      cleaned = "+91" + cleaned;
    } else if (/^91\d{10}$/.test(cleaned)) {
      cleaned = "+" + cleaned;
    } else {
      cleaned = "+91" + cleaned;
    }
  }
  return cleaned;
}

// Compile template text helper
function compileTemplateText(templateText: string, variables: Record<string, string>): string {
  let text = templateText;
  if (variables) {
    Object.entries(variables).forEach(([v, val]) => {
      text = text.split(`{{${v}}}`).join(val || "");
    });
  }
  return text;
}

// Write to chat history log
async function writeChatMessage(
  phone: string,
  text: string,
  sid: string,
  status: "sent" | "failed",
  timeString: string,
  errorCode?: string,
  errorMessage?: string
) {
  try {
    const msgData: any = {
      text: text,
      isSent: true,
      time: timeString,
      status: status,
      twilioSid: sid,
      timestamp: serverTimestamp(),
      senderName: "Campaign Manager"
    };
    if (errorCode) msgData.errorCode = errorCode;
    if (errorMessage) msgData.errorMessage = errorMessage;
    
    await addDoc(collection(db, "contacts", phone, "messages"), msgData);
    
    await setDoc(doc(db, "contacts", phone), {
      id: phone,
      name: phone,
      preview: text.length > 50 ? text.substring(0, 47) + "..." : text,
      time: timeString,
      lastUpdated: serverTimestamp(),
      statusText: "WhatsApp • Online",
      unreadCount: 0,
      isMarketing: true
    }, { merge: true });
  } catch (err) {
    console.error(`[Worker] Error writing chat log for ${phone}:`, err);
  }
}

// Simulate webhook delivery status calls for simulated mode
function simulateStatusCallbacks(campaignId: string, phone: string, twilioSid: string) {
  const recDocRef = doc(db, "campaigns", campaignId, "recipients", phone);
  const campaignDocRef = doc(db, "campaigns", campaignId);
  
  // 1. Simulate delivery status after 3 seconds
  setTimeout(async () => {
    try {
      const snap = await getDoc(recDocRef);
      if (!snap.exists() || snap.data().status !== "sent") return;
      
      const timeString = new Date().toLocaleTimeString("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      
      await updateDoc(recDocRef, {
        status: "delivered",
        deliveredAt: timeString
      });
      await updateDoc(campaignDocRef, {
        sentCount: increment(-1),
        deliveredCount: increment(1)
      });
      
      const msgQuery = query(collection(db, "contacts", phone, "messages"), where("twilioSid", "==", twilioSid));
      const msgSnap = await getDocs(msgQuery);
      if (!msgSnap.empty) {
        await updateDoc(msgSnap.docs[0].ref, {
          status: "delivered",
          deliveredAt: timeString
        });
      }
      
      // 2. Simulate read status after another 3 seconds (75% read rate)
      if (Math.random() > 0.25) {
        setTimeout(async () => {
          try {
            const snap2 = await getDoc(recDocRef);
            if (!snap2.exists() || snap2.data().status !== "delivered") return;
            
            const timeStringRead = new Date().toLocaleTimeString("en-US", {
              timeZone: "Asia/Kolkata",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            });
            
            await updateDoc(recDocRef, {
              status: "read",
              readAt: timeStringRead
            });
            await updateDoc(campaignDocRef, {
              deliveredCount: increment(-1),
              readCount: increment(1)
            });
            
            const msgQuery2 = query(collection(db, "contacts", phone, "messages"), where("twilioSid", "==", twilioSid));
            const msgSnap2 = await getDocs(msgQuery2);
            if (!msgSnap2.empty) {
              await updateDoc(msgSnap2.docs[0].ref, {
                status: "read",
                readAt: timeStringRead
              });
            }
          } catch (err) {
            console.error("[Worker] Simulation callback read error:", err);
          }
        }, 3000);
      }
    } catch (err) {
      console.error("[Worker] Simulation callback delivered error:", err);
    }
  }, 3000);
}

// Single recipient processor
async function processRecipient(campaign: Campaign, phone: string, recipient: CampaignRecipient): Promise<boolean> {
  const recDocRef = doc(db, "campaigns", campaign.id, "recipients", phone);
  
  await updateDoc(recDocRef, { status: "sending" });
  
  const isSimulated = campaign.isSimulated !== false;
  
  // Get current local time for message logs
  const timeString = new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
  
  const compiledText = compileTemplateText(campaign.templateText, recipient.variables);
  
  if (isSimulated) {
    console.log(`[Worker] [SIMULATION] Sending to ${phone}: "${compiledText.substring(0, 30)}..."`);
    const isSuccessful = Math.random() > 0.15;
    const mockSid = `mock-sid-${Date.now()}`;
    
    if (isSuccessful) {
      await updateDoc(recDocRef, {
        status: "sent",
        twilioSid: mockSid,
        sentAt: timeString
      });
      await updateDoc(doc(db, "campaigns", campaign.id), {
        sentCount: increment(1)
      });
      
      await writeChatMessage(phone, compiledText, mockSid, "sent", timeString);
      simulateStatusCallbacks(campaign.id, phone, mockSid);
      return true;
    } else {
      const errorMsgs = [
        { code: "63024", msg: "Twilio rate limit exceeded" },
        { code: "63012", msg: "Message undeliverable - phone inactive" },
        { code: "63015", msg: "WhatsApp subscription mismatch / user blocked" }
      ];
      const err = errorMsgs[Math.floor(Math.random() * errorMsgs.length)];
      
      await updateDoc(recDocRef, {
        status: "failed",
        errorCode: err.code,
        errorMessage: err.msg,
        sentAt: timeString
      });
      await updateDoc(doc(db, "campaigns", campaign.id), {
        failedCount: increment(1)
      });
      
      await writeChatMessage(phone, compiledText, `failed-${Date.now()}`, "failed", timeString, err.code, err.msg);
      return false;
    }
  } else {
    // Real Twilio API Send
    console.log(`[Worker] [REAL TWILIO] Sending to ${phone}: Template SID ${campaign.templateSid}`);
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const senderNumber = process.env.TWILIO_SENDER_NUMBER || "whatsapp:+918890211444";
      
      if (!accountSid || !authToken) {
        throw new Error("Twilio credentials not configured in environment.");
      }
      
      const client = twilio(accountSid, authToken);
      const payload: any = {
        from: senderNumber,
        to: `whatsapp:${phone}`,
        contentSid: campaign.templateSid,
      };
      if (recipient.variables) {
        payload.contentVariables = JSON.stringify(recipient.variables);
      }
      
      const message = await client.messages.create(payload);
      
      await updateDoc(recDocRef, {
        status: "sent",
        twilioSid: message.sid,
        sentAt: timeString
      });
      await updateDoc(doc(db, "campaigns", campaign.id), {
        sentCount: increment(1)
      });
      
      await setDoc(doc(db, "campaign_messages", message.sid), {
        campaignId: campaign.id,
        phone: phone,
        timestamp: serverTimestamp()
      });
      
      await writeChatMessage(phone, compiledText, message.sid, "sent", timeString);
      return true;
    } catch (err: any) {
      console.error(`[Worker] Twilio send failed for ${phone}:`, err.message);
      
      await updateDoc(recDocRef, {
        status: "failed",
        errorCode: err.code === "63049" || err.errorCode === 63049 ? "63049" : "500",
        errorMessage: err.message || "Failed API request",
        sentAt: timeString
      });
      await updateDoc(doc(db, "campaigns", campaign.id), {
        failedCount: increment(1)
      });
      
      await writeChatMessage(phone, compiledText, `failed-${Date.now()}`, "failed", timeString, err.code === "63049" || err.errorCode === 63049 ? "63049" : "500", err.message || "Failed API request");
      return false;
    }
  }
}

// Campaign processing loop
const processingCampaigns = new Set<string>();

async function processCampaign(campaignId: string) {
  if (processingCampaigns.has(campaignId)) return;
  processingCampaigns.add(campaignId);
  
  console.log(`[Worker] Started campaign loop for: ${campaignId}`);
  
  try {
    let attemptsThisSession = 0;
    let failuresThisSession = 0;
    
    while (true) {
      const campRef = doc(db, "campaigns", campaignId);
      const campSnap = await getDoc(campRef);
      if (!campSnap.exists()) {
        console.log(`[Worker] Campaign ${campaignId} deleted. Stopping loop.`);
        break;
      }
      
      const campaign = campSnap.data() as Campaign;
      if (campaign.status !== "running") {
        console.log(`[Worker] Campaign ${campaignId} status is ${campaign.status}. Pausing loop.`);
        break;
      }
      
      // Check for failure thresholds
      if (campaign.stopOnSpam) {
        if (attemptsThisSession >= 10) {
          const failureRate = (failuresThisSession / attemptsThisSession) * 100;
          const limitPct = campaign.failureThreshold || 15;
          if (failureRate >= limitPct) {
            await updateDoc(campRef, { status: "paused" });
            console.log(`[Worker] Campaign ${campaignId} auto-paused: session failure rate is ${failureRate.toFixed(1)}% (Threshold: ${limitPct}%).`);
            break;
          }
        }
      }
      
      // Get next pending recipient
      const recRef = collection(db, "campaigns", campaignId, "recipients");
      const qPending = query(recRef, where("status", "==", "pending"), limit(1));
      const recSnap = await getDocs(qPending);
      
      if (recSnap.empty) {
        // Double check if any are still in sending state (failsafe)
        const qSending = query(recRef, where("status", "==", "sending"), limit(1));
        const sendingSnap = await getDocs(qSending);
        if (sendingSnap.empty) {
          await updateDoc(campRef, { status: "completed" });
          console.log(`[Worker] Campaign ${campaignId} has completed processing all recipients.`);
        } else {
          console.log(`[Worker] Campaign ${campaignId} has recipients in flight. Waiting...`);
        }
        break;
      }
      
      const recipientDoc = recSnap.docs[0];
      const recipientPhone = recipientDoc.id;
      const recipientData = recipientDoc.data() as CampaignRecipient;
      
      const success = await processRecipient(campaign, recipientPhone, recipientData);
      attemptsThisSession++;
      if (!success) {
        failuresThisSession++;
      }
      
      // Delay throttling
      const delayMs = (campaign.delaySeconds || 2) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } catch (err) {
    console.error(`[Worker] Error in processing campaign ${campaignId}:`, err);
  } finally {
    processingCampaigns.delete(campaignId);
    console.log(`[Worker] Exited campaign loop for: ${campaignId}`);
  }
}

// 2. Start running listener
console.log("[Worker] Starting campaign worker listener...");
const campaignsQuery = query(collection(db, "campaigns"), where("status", "==", "running"));
const unsubscribeCampaigns = onSnapshot(campaignsQuery, (snapshot) => {
  snapshot.forEach((doc) => {
    processCampaign(doc.id);
  });
}, (err) => {
  console.error("[Worker] Firestore campaigns snapshot listener error:", err);
});

// 3. Heartbeat writer (Every 5 seconds)
const heartbeatInterval = setInterval(async () => {
  try {
    await setDoc(doc(db, "settings", "worker_status"), {
      lastActive: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.error("[Worker] Heartbeat write failed:", err);
  }
}, 5000);

// Graceful shutdown handler
process.on("SIGINT", () => {
  console.log("[Worker] Shutting down campaign worker...");
  unsubscribeCampaigns();
  clearInterval(heartbeatInterval);
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[Worker] Shutting down campaign worker...");
  unsubscribeCampaigns();
  clearInterval(heartbeatInterval);
  process.exit(0);
});
