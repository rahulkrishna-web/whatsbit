import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp, doc, updateDoc, query, where, getDocs, increment, setDoc } from "firebase/firestore";

export async function POST(req: NextRequest) {
  try {
    // Twilio sends data as application/x-www-form-urlencoded
    const formData = await req.formData();
    const data = Object.fromEntries(formData.entries());

    const messageStatus = data.MessageStatus as string;
    const messageSid = data.MessageSid as string;
    const from = data.From as string;
    const body = data.Body as string;
    const numMedia = parseInt((data.NumMedia as string) || "0");
    
    // Handle Delivery Status Callbacks (sent, delivered, read, failed)
    if (messageStatus && messageSid) {
      const to = data.To as string;
      if (!to) return NextResponse.json({ success: true });
      
      const contactId = to.replace("whatsapp:", "");
      
      const msgQuery = query(
        collection(db, "contacts", contactId, "messages"),
        where("twilioSid", "==", messageSid)
      );
      const msgSnap = await getDocs(msgQuery);
      
      if (!msgSnap.empty) {
        const msgRef = msgSnap.docs[0].ref;
        const updateData: any = { status: messageStatus };
        
        const timeString = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });
        
        if (messageStatus === "delivered") {
          updateData.deliveredAt = timeString;
        } else if (messageStatus === "read") {
          updateData.readAt = timeString;
        } else if (messageStatus === "failed") {
          updateData.errorCode = data.ErrorCode;
          updateData.errorMessage = data.ErrorMessage;
        }
        
        await updateDoc(msgRef, updateData);
      }
      
      return NextResponse.json({ success: true });
    }
    
    // Handle Incoming Messages (replies from customers)
    if (body !== undefined && from) {
      const contactId = from.replace("whatsapp:", "");
      const profileName = (data.ProfileName as string) || contactId;
      
      const msgData: any = {
        text: body,
        isSent: false,
        time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }),
        timestamp: serverTimestamp(),
        twilioSid: messageSid,
        senderName: profileName
      };
      
      if (numMedia > 0) {
        msgData.mediaUrl = data.MediaUrl0;
        msgData.mediaType = data.MediaContentType0;
      }
      
      // Add the message to the chat history
      await addDoc(collection(db, "contacts", contactId, "messages"), msgData);
      
      // Update the contact's preview in the sidebar
      const contactRef = doc(db, "contacts", contactId);
      
      // We use setDoc with merge: true to create the contact if they don't exist yet
      await setDoc(contactRef, {
        id: contactId,
        name: profileName,
        preview: numMedia > 0 ? "Media file" : body.substring(0, 47) + (body.length > 47 ? "..." : ""),
        time: msgData.time,
        lastUpdated: serverTimestamp(),
        unreadCount: increment(1),
        statusText: "WhatsApp • Online"
      }, { merge: true });
      
      return NextResponse.json({ success: true });
    }
    
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Error processing Twilio webhook:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
