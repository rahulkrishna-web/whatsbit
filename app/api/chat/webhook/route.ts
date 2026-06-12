import { NextResponse } from "next/server";
import { db } from "../../../../lib/firebase";
import { 
  doc, 
  getDoc, 
  setDoc, 
  addDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  updateDoc, 
  serverTimestamp,
  increment
} from "firebase/firestore";
import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import twilio from "twilio";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const data = Object.fromEntries(formData.entries());

    console.log("Twilio Webhook Received:", data);

    const messageSid = (data.MessageSid || data.SmsSid) as string;
    const messageStatus = data.MessageStatus as string; // sent, delivered, read, failed

    let tz = "Asia/Kolkata";
    try {
      const profileSnap = await getDoc(doc(db, "settings", "company_profile"));
      if (profileSnap.exists()) {
        tz = profileSnap.data().timeZone || "Asia/Kolkata";
      }
    } catch (e) {
      console.warn("Failed to load company timezone, using Asia/Kolkata", e);
    }

    // Robust helper to normalize phone numbers consistently
    const cleanPhone = (phone: string): string => {
      if (!phone) return "";
      let raw = phone.replace(/^whatsapp:/, "");
      let cleaned = raw.replace(/[^\d+]/g, "");
      if (/^\d{10}$/.test(cleaned)) {
        cleaned = "+91" + cleaned;
      }
      if (/^91\d{10}$/.test(cleaned)) {
        cleaned = "+" + cleaned;
      }
      if (/^[1-9]\d{10,14}$/.test(cleaned) && !cleaned.startsWith("+")) {
        cleaned = "+" + cleaned;
      }
      return cleaned;
    };

    // 1. Handle Message Status Callback
    if (messageStatus && messageSid) {
      const contactPhone = cleanPhone(data.To as string);
      if (contactPhone) {
        const messagesRef = collection(db, "contacts", contactPhone, "messages");
        const q = query(messagesRef, where("twilioSid", "==", messageSid));
        const querySnapshot = await getDocs(q);
        
        let statusVal: "sent" | "delivered" | "read" | "failed" = "sent";
        if (messageStatus === "read") {
          statusVal = "read";
        } else if (messageStatus === "delivered") {
          statusVal = "delivered";
        } else if (messageStatus === "failed" || messageStatus === "undelivered") {
          statusVal = "failed";
        }
        
        const timeString = new Date().toLocaleTimeString("en-US", {
          timeZone: tz,
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });

        if (!querySnapshot.empty) {
          const docRef = querySnapshot.docs[0].ref;
          
          const updatePayload: any = {
            status: statusVal
          };
          if (statusVal === "delivered") {
            updatePayload.deliveredAt = timeString;
          } else if (statusVal === "read") {
            updatePayload.readAt = timeString;
            const existingData = querySnapshot.docs[0].data();
            if (!existingData.deliveredAt) {
              updatePayload.deliveredAt = timeString;
            }
          }

          if (data.ErrorCode) {
            updatePayload.errorCode = String(data.ErrorCode);
          }
          if (data.ErrorMessage) {
            updatePayload.errorMessage = String(data.ErrorMessage);
          }
          
          await updateDoc(docRef, updatePayload);
        }

        // Handle campaigns integrations
        try {
          const campaignMsgRef = doc(db, "campaign_messages", messageSid);
          const campaignMsgSnap = await getDoc(campaignMsgRef);
          if (campaignMsgSnap.exists()) {
            const { campaignId, phone } = campaignMsgSnap.data();
            if (campaignId && phone) {
              const recipientRef = doc(db, "campaigns", campaignId, "recipients", phone);
              const recipientSnap = await getDoc(recipientRef);
              if (recipientSnap.exists()) {
                const recipientData = recipientSnap.data();
                const oldStatus = recipientData.status;
                
                // Update recipient status and logs
                const recipientUpdate: any = {
                  status: statusVal,
                };
                if (statusVal === "delivered") {
                  recipientUpdate.deliveredAt = timeString;
                } else if (statusVal === "read") {
                  recipientUpdate.readAt = timeString;
                  if (!recipientData.deliveredAt) {
                    recipientUpdate.deliveredAt = timeString;
                  }
                }
                if (data.ErrorCode) {
                  recipientUpdate.errorCode = String(data.ErrorCode);
                }
                if (data.ErrorMessage) {
                  recipientUpdate.errorMessage = String(data.ErrorMessage);
                }
                
                await updateDoc(recipientRef, recipientUpdate);
                
                // Adjust campaign counters
                if (oldStatus !== statusVal) {
                  const campaignRef = doc(db, "campaigns", campaignId);
                  const campaignUpdates: any = {};
                  
                  // Decrement old status counter
                  if (oldStatus === "sent") campaignUpdates.sentCount = increment(-1);
                  else if (oldStatus === "delivered") campaignUpdates.deliveredCount = increment(-1);
                  else if (oldStatus === "read") campaignUpdates.readCount = increment(-1);
                  else if (oldStatus === "failed") campaignUpdates.failedCount = increment(-1);
                  
                  // Increment new status counter
                  if (statusVal === "sent") campaignUpdates.sentCount = increment(1);
                  else if (statusVal === "delivered") campaignUpdates.deliveredCount = increment(1);
                  else if (statusVal === "read") campaignUpdates.readCount = increment(1);
                  else if (statusVal === "failed") campaignUpdates.failedCount = increment(1);
                  
                  await updateDoc(campaignRef, campaignUpdates);
                }
              }
            }
          }
        } catch (campaignErr) {
          console.error("Error updating campaign status from webhook:", campaignErr);
        }
      }
      return new NextResponse("<Response></Response>", {
        headers: { "Content-Type": "text/xml" }
      });
    }

    // 2. Handle Incoming Message
    const fromPhone = cleanPhone(data.From as string);
    const body = (data.Body || "") as string;

    // Check for incoming media from Twilio payload
    const numMedia = parseInt((data.NumMedia || "0") as string, 10);
    let mediaUrl = "";
    let mediaType: "image" | "video" | "document" | null = null;
    if (numMedia > 0) {
      const originalMediaUrl = data.MediaUrl0 as string;
      mediaUrl = originalMediaUrl;
      const mediaContentType = (data.MediaContentType0 || "") as string;
      if (mediaContentType.startsWith("image/")) {
        mediaType = "image";
      } else if (mediaContentType.startsWith("video/")) {
        mediaType = "video";
      } else {
        mediaType = "document";
      }

      // Download and save Twilio media locally to prevent auth issues in browser
      if (originalMediaUrl && fromPhone) {
        try {
          const credentials = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
          const res = await fetch(originalMediaUrl, {
            headers: {
              Authorization: `Basic ${credentials}`
            }
          });
          
          if (res.ok) {
            const contentType = res.headers.get("content-type") || mediaContentType || "";
            const buffer = Buffer.from(await res.arrayBuffer());
            
            let ext = "bin";
            if (contentType.includes("image/jpeg") || contentType.includes("image/jpg")) ext = "jpg";
            else if (contentType.includes("image/png")) ext = "png";
            else if (contentType.includes("image/gif")) ext = "gif";
            else if (contentType.includes("image/webp")) ext = "webp";
            else if (contentType.includes("video/mp4")) ext = "mp4";
            else if (contentType.includes("video/webm")) ext = "webm";
            else if (contentType.includes("audio/mpeg") || contentType.includes("audio/mp3")) ext = "mp3";
            else if (contentType.includes("audio/ogg")) ext = "ogg";
            else if (contentType.includes("audio/wav")) ext = "wav";
            else if (contentType.includes("audio/amr")) ext = "amr";
            else if (contentType.includes("audio/x-apple-asf") || contentType.includes("audio/m4a")) ext = "m4a";
            else if (contentType.includes("application/pdf")) ext = "pdf";
            
            const relativeDir = join("uploads", fromPhone);
            const uploadDir = join(process.cwd(), "public", relativeDir);
            
            await mkdir(uploadDir, { recursive: true });
            
            const filename = `${Date.now()}_incoming.${ext}`;
            const filePath = join(uploadDir, filename);
            await writeFile(filePath, buffer);
            
            const host = request.headers.get("host") || "";
            const protocol = request.headers.get("x-forwarded-proto") || "http";
            mediaUrl = `${protocol}://${host}/${relativeDir}/${filename}`;
            console.log("Downloaded and saved Twilio media locally to:", mediaUrl);
          } else {
            console.error("Failed to download Twilio media, status:", res.status);
          }
        } catch (err) {
          console.error("Error downloading Twilio media:", err);
        }
      }
    }

    if (fromPhone && (body || mediaUrl)) {
      const timeString = new Date().toLocaleTimeString("en-IN", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      });

      // Add message to subcollection contacts/{fromPhone}/messages
      const messagesRef = collection(db, "contacts", fromPhone, "messages");
      await addDoc(messagesRef, {
        text: body,
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || null,
        isSent: false,
        time: timeString,
        status: "read", // Incoming messages default to read status
        twilioSid: messageSid,
        timestamp: serverTimestamp(),
      });

      // Create or update the contact document
      const contactRef = doc(db, "contacts", fromPhone);
      let previewText = body;
      if (!body && mediaUrl) {
        previewText = mediaType === "image" ? "📷 Image" : mediaType === "video" ? "🎥 Video" : "📄 Document";
      }
      await setDoc(contactRef, {
        id: fromPhone,
        name: fromPhone, // Fallback to phone number as name initially
        preview: previewText.length > 50 ? previewText.substring(0, 47) + "..." : previewText,
        time: timeString,
        lastUpdated: serverTimestamp(),
        statusText: "WhatsApp • Online",
        unreadCount: increment(1),
        isMarketing: false, // Reset marketing flag on incoming replies
      }, { merge: true });

      // Autoresponder flow for Wondermill template
      const cleanedBody = body.trim().toLowerCase();
      if (cleanedBody === "ok" || cleanedBody === "yes") {
        try {
          // Fetch last messages to see if Wondermill template was sent
          const messagesSnap = await getDocs(messagesRef);
          const sentMessages = messagesSnap.docs
            .map((d) => ({ id: d.id, ...d.data() } as any))
            .filter((m) => m.isSent === true && m.timestamp)
            .sort((a, b) => {
              const aSec = a.timestamp?.seconds || 0;
              const bSec = b.timestamp?.seconds || 0;
              return bSec - aSec;
            });

          const lastSentMessage = sentMessages[0];
          if (lastSentMessage) {
            const lastSentText = lastSentMessage.text || "";
            const isWondermillTemplate = 
              lastSentMessage.templateSid === "Hxd796d76e1249f498e8767897e53ee385" ||
              (lastSentText.toLowerCase().includes("wondermill") && 
               lastSentText.toLowerCase().includes("please reply with") &&
               (lastSentText.toLowerCase().includes("ok") || lastSentText.toLowerCase().includes("yes")));

            if (isWondermillTemplate) {
              const accountSid = process.env.TWILIO_ACCOUNT_SID;
              const authToken = process.env.TWILIO_AUTH_TOKEN;
              const senderNumber = process.env.TWILIO_SENDER_NUMBER || "whatsapp:+918890211444";

              if (accountSid && authToken) {
                const client = twilio(accountSid, authToken);
                const brochureUrl = "https://cdn.clyrix.com/drive/wondermill_brochure.pdf";
                
                console.log(`[Autoresponder] Sending brochure to ${fromPhone}`);
                const mediaMessage = await client.messages.create({
                  from: senderNumber,
                  to: `whatsapp:${fromPhone}`,
                  body: "Here is the Wondermill brochure you requested.",
                  mediaUrl: [brochureUrl]
                });

                // Write the sent brochure to messages subcollection
                const brochureTimeString = new Date().toLocaleTimeString("en-IN", {
                  timeZone: tz,
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true
                });

                await addDoc(messagesRef, {
                  text: "Here is the Wondermill brochure you requested.",
                  isSent: true,
                  time: brochureTimeString,
                  status: "sent",
                  twilioSid: mediaMessage.sid,
                  timestamp: serverTimestamp(),
                  senderName: "Automation Bot",
                  mediaUrl: brochureUrl,
                  mediaType: "document"
                });

                // Update contact meta (reset unreadCount to 0 because we replied)
                await setDoc(contactRef, {
                  preview: "📄 Document: wondermill_brochure.pdf",
                  time: brochureTimeString,
                  lastUpdated: serverTimestamp(),
                  unreadCount: 0
                }, { merge: true });

                // Also log a run for this flow in flow_runs
                try {
                  const runId = `wondermill_auto_${Date.now()}`;
                  const contactSnap = await getDoc(contactRef);
                  const contactName = contactSnap.exists() ? (contactSnap.data().name || fromPhone) : fromPhone;
                  
                  await setDoc(doc(db, "flow_runs", runId), {
                    id: runId,
                    flowId: "wondermill-autoresponder",
                    recipientName: contactName,
                    recipientPhone: fromPhone,
                    status: "success",
                    startedAt: new Date().toISOString(),
                    completedAt: new Date().toISOString(),
                    steps: [
                      {
                        nodeId: "node-1",
                        nodeTitle: "Incoming WhatsApp Message",
                        timestamp: new Date().toISOString(),
                        status: "success",
                        description: `Received "${body}" from client.`
                      },
                      {
                        nodeId: "node-2",
                        nodeTitle: "Check Template Response",
                        timestamp: new Date().toISOString(),
                        status: "success",
                        description: "Verified response is 'ok'/'yes' to Wondermill template."
                      },
                      {
                        nodeId: "node-3",
                        nodeTitle: "Send Wondermill Brochure",
                        timestamp: new Date().toISOString(),
                        status: "success",
                        description: "Brochure PDF sent successfully via Twilio."
                      }
                    ]
                  });
                } catch (runErr) {
                  console.error("Failed to log flow run:", runErr);
                }
              } else {
                console.warn("[Autoresponder] Twilio credentials not configured. Skipping brochure sending.");
              }
            }
          }
        } catch (autoErr) {
          console.error("Error in Wondermill autoresponder:", autoErr);
        }
      }
    }

    // Return TwiML response to Twilio
    return new NextResponse("<Response></Response>", {
      headers: { "Content-Type": "text/xml" }
    });
  } catch (error: any) {
    console.error("Webhook processing error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
