import { db } from "./lib/firebase";
import { collection, getDocs } from "firebase/firestore";

async function inspect() {
  const querySnapshot = await getDocs(collection(db, "contacts"));
  querySnapshot.forEach((doc) => {
    const id = doc.id;
    if (id.includes("9584012553")) {
      console.log(`ID: "${id}", length: ${id.length}, charCodes: ${JSON.stringify([...id].map(c => c.charCodeAt(0)))}`);
    }
  });
}

inspect().catch(console.error);
