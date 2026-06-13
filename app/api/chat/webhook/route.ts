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

      // Autoresponder flow for Lead Qualification template
      const lowerBody = body.trim().toLowerCase();
      const isSetupPlant = lowerBody === "setup new plant" || lowerBody === "setup_new_plant" || lowerBody.includes("setup new plant") || lowerBody.includes("looking to setup a new plant");
      const isPlantExpansion = lowerBody === "plant expansion" || lowerBody === "plant_expansion" || lowerBody.includes("plant expansion") || lowerBody.includes("need help with expansion");
      const isSparesStones = lowerBody === "spares & stones" || lowerBody === "spares_and_stones" || lowerBody.includes("spares & stones") || lowerBody.includes("spares and stones") || lowerBody.includes("spares") || lowerBody.includes("stones");

      if (isSetupPlant || isPlantExpansion || isSparesStones) {
        try {
          // Fetch last messages to see if Welcome template was sent
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
          // Auto-respond if the last sent message was the welcome template or contained flour milling solutions
          const isWelcomeTemplate = lastSentMessage && (
            lastSentMessage.templateSid === "HX1ae93a6b279b8dd306b66b0b7693efe2" ||
            lastSentMessage.templateSid === "HX46c6463e02f78669aac9d85c160fb0ab" ||
            lastSentMessage.templateSid === "HX46c6463c02f78669aac9d83c160f0ab" ||
            (lastSentMessage.text && 
             lastSentMessage.text.toLowerCase().includes("flour milling solutions") && 
             lastSentMessage.text.toLowerCase().includes("what brings you here"))
          );

          if (isWelcomeTemplate) {
            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;
            const senderNumber = process.env.TWILIO_SENDER_NUMBER || "whatsapp:+918890211444";

            if (accountSid && authToken) {
              const client = twilio(accountSid, authToken);

              let responseTemplateSid = "";
              let responseTemplateText = "";
              let brochureTemplateSid = "";
              let brochureText = "";
              let brochureUrl = "";
              let brochureName = "";
              let choiceLabel = "";
              let inquiryNodeId = "";
              let brochureNodeId = "";

              if (isSetupPlant) {
                choiceLabel = "Setup New Plant";
                inquiryNodeId = "node-3a";
                brochureNodeId = "node-4a";
                responseTemplateSid = "HX2fd7981c6f7f4c0076b05ee4b5f66c67";
                responseTemplateText = "Great! Expansion is something we handle regularly. Whether you're scaling up your current capacity or adding new product lines, we have the right solutions.\n\nA few quick questions:\n✓ Current capacity?\n✓ Target expanded capacity?\n✓ Timeline for the expansion?\n✓ Product that you mill?";
                
                brochureTemplateSid = "HX0f7cdc84a9b825505fc6a3a608c2a3bc";
                brochureText = "Thank you for your interest in RS Choyal Group!\n\nHere's our company brochure with detailed specifications\n📄 https://cdn.clyrix.com/drive/rscg_company_profile.pdf\n\nAlso check out these quick videos to see our work:\n\n🎥 Company Overview: https://www.youtube.com/watch?v=DlEcmcDS598\n\n🎥 How We Setup Plants: https://www.youtube.com/watch?v=OETierqPRFA\n\n🎥 Milling Plant Process (Hindi): https://www.youtube.com/watch?v=MjUnwkiwAvM";
                brochureUrl = "https://cdn.clyrix.com/drive/rscg_company_profile.pdf";
                brochureName = "rscg_company_profile.pdf";
              } else if (isPlantExpansion) {
                choiceLabel = "Plant Expansion";
                inquiryNodeId = "node-3b";
                brochureNodeId = "node-4b";
                responseTemplateSid = "HXed74bae32850c134356bdfb56915be1e";
                responseTemplateText = "Great! Expansion is something we handle regularly. Whether you're scaling up your current capacity or adding new product lines, we have the right solutions.\n\nA few quick questions:\n✓ Current capacity?\n✓ Target expanded capacity?\n✓ Timeline for the expansion?\n✓ Product that you mill?";
                brochureText = "Here's our brochure and video overviews for expanding existing plants:\n🎥 Process Overview: https://www.youtube.com/watch?v=DlEcmcDS598\n🎥 Company Overview: https://www.youtube.com/watch?v=DlEcmcDS598";
                brochureUrl = "https://cdn.clyrix.com/drive/rscg_company_profile.pdf";
                brochureName = "rscg_company_profile.pdf";
              } else {
                choiceLabel = "Spares & Stones";
                inquiryNodeId = "node-3c";
                brochureNodeId = "node-4c";
                responseTemplateSid = "HXa5d6eeac6207c14c348c4d8c89b7adc0";
                responseTemplateText = "Perfect! We supply high-quality grinding stones and spare parts for ongoing maintenance and optimization.\n\nQuick info needed:\n✓ Which equipment/machine? (make/model)\n✓ Grinding stones, bearings, or other spares?\n✓ How soon do you need them?";
                brochureText = "Please find attached our stones & spares components specifications document for Choyal mills.";
                brochureUrl = "https://whatsbit.vercel.app/RS_Choyal_Stones_Catalogue.pdf";
                brochureName = "RS_Choyal_Stones_Catalogue.pdf";
              }

              console.log(`[Lead Qualification Autoresponder] Sending template ${responseTemplateSid} to ${fromPhone}`);
              const inquiryMessage = await client.messages.create({
                from: senderNumber,
                to: `whatsapp:${fromPhone}`,
                contentSid: responseTemplateSid
              });

              const inquiryTimeString = new Date().toLocaleTimeString("en-IN", {
                timeZone: tz,
                hour: "2-digit",
                minute: "2-digit",
                hour12: true
              });

              await addDoc(messagesRef, {
                text: responseTemplateText,
                isSent: true,
                time: inquiryTimeString,
                status: "sent",
                twilioSid: inquiryMessage.sid,
                timestamp: serverTimestamp(),
                senderName: "Automation Bot",
                templateSid: responseTemplateSid
              });

              // Send brochure/catalogue after 2 seconds
              setTimeout(async () => {
                try {
                  console.log(`[Lead Qualification Autoresponder] Sending brochure ${brochureUrl} to ${fromPhone}`);
                  let mediaMessage;
                  if (brochureTemplateSid) {
                    mediaMessage = await client.messages.create({
                      from: senderNumber,
                      to: `whatsapp:${fromPhone}`,
                      contentSid: brochureTemplateSid,
                      contentVariables: JSON.stringify({
                        "1": brochureUrl
                      })
                    });
                  } else {
                    mediaMessage = await client.messages.create({
                      from: senderNumber,
                      to: `whatsapp:${fromPhone}`,
                      body: brochureText,
                      mediaUrl: [brochureUrl]
                    });
                  }

                  const brochureTimeString = new Date().toLocaleTimeString("en-IN", {
                    timeZone: tz,
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true
                  });

                  await addDoc(messagesRef, {
                    text: brochureText,
                    isSent: true,
                    time: brochureTimeString,
                    status: "sent",
                    twilioSid: mediaMessage.sid,
                    timestamp: serverTimestamp(),
                    senderName: "Automation Bot",
                    mediaUrl: brochureUrl,
                    mediaType: "document",
                    templateSid: brochureTemplateSid || null
                  });

                  // Update contact preview
                  await setDoc(contactRef, {
                    preview: `📄 Document: ${brochureName}`,
                    time: brochureTimeString,
                    lastUpdated: serverTimestamp(),
                    unreadCount: 0
                  }, { merge: true });

                } catch (mediaErr) {
                  console.error("Error sending brochure in lead qual webhook:", mediaErr);
                }
              }, 2000);

              // Update contact preview with response template text
              await setDoc(contactRef, {
                preview: responseTemplateText.substring(0, 47) + "...",
                time: inquiryTimeString,
                lastUpdated: serverTimestamp(),
                unreadCount: 0
              }, { merge: true });

              // Log a run in flow_runs
              try {
                const runId = `lq_auto_${Date.now()}`;
                const contactSnap = await getDoc(contactRef);
                const contactName = contactSnap.exists() ? (contactSnap.data().name || fromPhone) : fromPhone;

                await setDoc(doc(db, "flow_runs", runId), {
                  id: runId,
                  flowId: "whatsapp-lead-qualification",
                  recipientName: contactName,
                  recipientPhone: fromPhone,
                  status: "paused",
                  startedAt: new Date().toISOString(),
                  steps: [
                    {
                      nodeId: "node-1",
                      nodeTitle: "Bitrix Lead Created",
                      timestamp: new Date().toISOString(),
                      status: "success",
                      description: `Triggered from WhatsApp response: "${body}".`
                    },
                    {
                      nodeId: "node-2",
                      nodeTitle: "Initial Lead Notification",
                      timestamp: new Date().toISOString(),
                      status: "success",
                      description: `Clicked option: "${choiceLabel}".`
                    },
                    {
                      nodeId: inquiryNodeId,
                      nodeTitle: isSetupPlant ? "Turnkey Plant Inquiry Response" : isPlantExpansion ? "Plant Expansion Inquiry Response" : "Spares & Stones Inquiry Response",
                      timestamp: new Date().toISOString(),
                      status: "success",
                      description: `Sent inquiry response template ${responseTemplateSid}.`
                    },
                    {
                      nodeId: brochureNodeId,
                      nodeTitle: isSetupPlant ? "Send Plant Brochure" : isPlantExpansion ? "Send Expansion Details & Brochure" : "Send Spares Catalogue",
                      timestamp: new Date(Date.now() + 2000).toISOString(),
                      status: "success",
                      description: `Sent ${brochureName} successfully.`
                    },
                    {
                      nodeId: isSetupPlant ? "node-5a" : isPlantExpansion ? "node-5b" : "node-5c",
                      nodeTitle: "Wait 4 Days",
                      timestamp: new Date(Date.now() + 2000).toISOString(),
                      status: "pending",
                      description: "Waiting for delay timer (4 days) to send follow-up."
                    }
                  ]
                });
              } catch (runErr) {
                console.error("Failed to log flow run:", runErr);
              }
            } else {
              console.warn("[Lead Qualification Autoresponder] Twilio credentials not configured. Skipping automated messages.");
            }
          }
        } catch (autoErr) {
          console.error("Error in Lead Qualification autoresponder:", autoErr);
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
