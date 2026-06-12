import { db } from "./lib/firebase";
import { collection, doc, getDocs, setDoc, deleteDoc, addDoc } from "firebase/firestore";

function cleanPhone(phone: string): string {
  if (!phone) return "";
  let raw = phone.replace(/^whatsapp:/, "");
  let cleaned = raw.replace(/[^\d+]/g, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 5) return "";

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
}

async function merge() {
  console.log("Starting duplicate contact merge in Firestore...");
  const contactsSnapshot = await getDocs(collection(db, "contacts"));
  
  for (const contactDoc of contactsSnapshot.docs) {
    const rawId = contactDoc.id;
    const cleanId = cleanPhone(rawId);
    
    if (!cleanId) {
      console.log(`Skipping invalid phone document: ${rawId}`);
      continue;
    }
    
    if (rawId !== cleanId) {
      console.log(`\nMerging raw ID [${rawId}] -> cleaned ID [${cleanId}]...`);
      
      // Get all messages from raw subcollection
      const rawMessagesRef = collection(db, "contacts", rawId, "messages");
      const rawMessagesSnap = await getDocs(rawMessagesRef);
      console.log(`Found ${rawMessagesSnap.size} messages under [${rawId}] to move.`);
      
      const cleanMessagesRef = collection(db, "contacts", cleanId, "messages");
      
      for (const msgDoc of rawMessagesSnap.docs) {
        const msgData = msgDoc.data();
        
        // Write message to the cleaned subcollection
        await addDoc(cleanMessagesRef, msgData);
        // Delete message from raw subcollection
        await deleteDoc(doc(db, "contacts", rawId, "messages", msgDoc.id));
      }
      
      // Update/merge contact metadata if necessary
      const rawData = contactDoc.data();
      const cleanContactRef = doc(db, "contacts", cleanId);
      
      await setDoc(cleanContactRef, {
        id: cleanId,
        name: rawData.name && rawData.name !== rawId ? rawData.name : cleanId,
        preview: rawData.preview || "",
        time: rawData.time || "",
        lastUpdated: rawData.lastUpdated || null,
        statusText: rawData.statusText || "WhatsApp • Online",
        unreadCount: rawData.unreadCount || 0,
      }, { merge: true });
      
      // Delete raw contact document
      await deleteDoc(doc(db, "contacts", rawId));
      console.log(`Successfully merged and deleted raw ID [${rawId}].`);
    }
  }
  console.log("\nMerge complete!");
}

merge().catch(console.error);
