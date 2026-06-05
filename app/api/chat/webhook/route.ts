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
        
        if (!querySnapshot.empty) {
          const docRef = querySnapshot.docs[0].ref;
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
      }, { merge: true });
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
