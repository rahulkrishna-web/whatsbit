import { db } from "./lib/firebase";
import { collection, getDocs } from "firebase/firestore";

async function search() {
  const contactIds = ["+916205806621", " 916205806621", "6205806621"];
  for (const id of contactIds) {
    console.log(`Checking contact: "${id}"`);
    try {
      const messagesSnapshot = await getDocs(collection(db, "contacts", id, "messages"));
      const msgs: any[] = [];
      messagesSnapshot.forEach(doc => {
        msgs.push({
          id: doc.id,
          ...doc.data()
        });
      });
      console.log(`Found ${msgs.length} messages:`);
      msgs.forEach(m => {
        console.log(`  - [${m.time}] [sent=${m.isSent}] text: "${m.text}"`);
      });
    } catch (err: any) {
      console.error(`Error checking "${id}":`, err.message);
    }
  }
}

search().catch(console.error);
