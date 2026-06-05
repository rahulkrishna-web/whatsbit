import { db } from "./lib/firebase";
import { collection, getDocs } from "firebase/firestore";

async function search() {
  const querySnapshot = await getDocs(collection(db, "contacts"));
  const results: any[] = [];
  querySnapshot.forEach((doc) => {
    results.push({ id: doc.id, ...doc.data() });
  });

  const punit = results.filter(r => r.id.includes("9584012553") || (r.name && r.name.toLowerCase().includes("punit")));
  console.log("Punit contacts in DB:");
  console.log(JSON.stringify(punit, null, 2));

  const shyam = results.filter(r => r.id.includes("909840899") || (r.name && r.name.toLowerCase().includes("shyam")));
  console.log("\nShyam contacts in DB:");
  console.log(JSON.stringify(shyam, null, 2));
}

search().catch(console.error);
