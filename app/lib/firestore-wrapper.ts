import { 
  collection as _collection, 
  doc as _doc, 
  Firestore,
  CollectionReference,
  DocumentReference
} from "firebase/firestore";

export * from "firebase/firestore";

function getOrgId() {
  if (typeof window !== "undefined") {
    return window.localStorage.getItem("clyrix_org_id");
  }
  return null;
}

export function collection(dbOrRef: Firestore | CollectionReference | DocumentReference, path: string, ...pathSegments: string[]) {
  const orgId = getOrgId();
  
  // Check if first arg is Firestore instance (has type 'firestore')
  const isFirestore = (dbOrRef as any).type === "firestore" || (dbOrRef as any).app !== undefined;
  
  if (isFirestore && typeof path === "string" && orgId && !path.startsWith("organizations")) {
    return _collection(dbOrRef as Firestore, "organizations", orgId, path, ...pathSegments);
  }
  
  return _collection(dbOrRef as any, path, ...pathSegments);
}

export function doc(dbOrRef: Firestore | CollectionReference | DocumentReference, path?: string, ...pathSegments: string[]) {
  const orgId = getOrgId();
  
  const isFirestore = (dbOrRef as any).type === "firestore" || (dbOrRef as any).app !== undefined;
  
  if (isFirestore && typeof path === "string" && orgId && !path.startsWith("organizations")) {
    return _doc(dbOrRef as Firestore, "organizations", orgId, path, ...pathSegments);
  }
  
  // If no path is provided (e.g. doc(collectionRef))
  if (path === undefined) {
    return _doc(dbOrRef as CollectionReference);
  }
  
  return _doc(dbOrRef as any, path, ...pathSegments);
}
