import { db } from "./lib/firebase";
import { collection, getDocs } from "firebase/firestore";

async function check() {
  const querySnapshot = await getDocs(collection(db, "contacts"));
  const results: any[] = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    results.push({
      id: doc.id,
      name: data.name,
      preview: data.preview,
      time: data.time,
      unreadCount: data.unreadCount,
      lastUpdated: data.lastUpdated ? (data.lastUpdated.toDate ? data.lastUpdated.toDate().toISOString() : data.lastUpdated) : null
    });
  });
  
  // Sort by lastUpdated desc
  results.sort((a, b) => {
    if (!a.lastUpdated) return 1;
    if (!b.lastUpdated) return -1;
    return b.lastUpdated.localeCompare(a.lastUpdated);
  });
  
  console.log("TOP 15 RECENT CONTACTS:");
  console.log(JSON.stringify(results.slice(0, 15), null, 2));

  console.log("\nSEARCH FOR 6205806621 CONTACTS:");
  const search = results.filter(r => r.id.includes("6205806621") || (r.name && r.name.includes("John")));
  console.log(JSON.stringify(search, null, 2));
}

check().catch(console.error);
