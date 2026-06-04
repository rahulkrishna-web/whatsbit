"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./page.module.css";

function cleanPhone(phone: string): string {
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
}
import { db, storage } from "../lib/firebase";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  doc, 
  setDoc, 
  getDoc,
  addDoc, 
  updateDoc, 
  serverTimestamp 
} from "firebase/firestore";

type Message = {
  id: string;
  text: string;
  isSent: boolean;
  time: string;
  status: "sent" | "delivered" | "read" | "failed";
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  senderName?: string;
  errorCode?: string;
  errorMessage?: string;
  timestamp?: any;
};

type Contact = {
  id: string;
  name: string;
  avatar: string;
  time: string;
  preview: string;
  statusText: string;
  responsibleId?: string;
  unreadCount?: number;
  statusSelect?: string;
  label?: string;
};

const INITIAL_CONTACTS: Contact[] = [
  {
    id: "918839780947",
    name: "918839780947",
    avatar: "👤",
    time: "03/13/2026",
    preview: "Please tell us how we did. Just send 1 if you are satisfied...",
    statusText: "WhatsApp • Online",
    responsibleId: "anirrudh_sharma",
  },
  {
    id: "anirrudh_sharma",
    name: "Anirrudh Sharma",
    avatar: "RS",
    time: "11:53 AM",
    preview: "Project offer 1...nt.pdf",
    statusText: "WhatsApp • Offline",
    responsibleId: "pooja_lodhi",
  },
];

const INITIAL_MESSAGES: Record<string, Message[]> = {};

const PREDEFINED_TEMPLATES = [
  {
    id: "welcome_choyal",
    name: "RS Choyal Welcome",
    text: "Hello, Thank you for connecting with RS Choyal Group. Please let us know how we can assist you today?",
    templateSid: "HX68dfb84bba8143c63d42fb9d3a3a9af6",
  }
];

export default function ChatApp() {
  const [contacts, setContacts] = useState<Contact[]>(INITIAL_CONTACTS);
  const [activeChatId, setActiveChatId] = useState<string>("918839780947");
  const [allMessages, setAllMessages] = useState<Record<string, Message[]>>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMenuFilter, setActiveMenuFilter] = useState<string>("all");
  const [customLabels, setCustomLabels] = useState<{ id: string; name: string }[]>([]);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeLightboxImage, setActiveLightboxImage] = useState<string | null>(null);

  // Sync custom labels from Firestore
  useEffect(() => {
    const labelsRef = collection(db, "labels");
    const unsubscribe = onSnapshot(labelsRef, (snapshot) => {
      const list: { id: string; name: string }[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, name: doc.data().name });
      });
      
      if (list.length === 0) {
        // Seed default labels if empty
        const defaults = ["Workday", "Lunch", "Settings"];
        defaults.forEach(async (name) => {
          await addDoc(collection(db, "labels"), { name });
        });
      } else {
        setCustomLabels(list);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleCreateNewLabel = async () => {
    const name = prompt("Enter new label name:");
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    if (customLabels.some(l => l.name.toLowerCase() === cleanName.toLowerCase())) {
      alert("Label already exists!");
      return;
    }
    await addDoc(collection(db, "labels"), {
      name: cleanName,
    });
  };

  // Users for assignment
  const [users, setUsers] = useState<any[]>([
    { id: "anirrudh_sharma", name: "Anirrudh Sharma", avatar: "AS", color: "#10b981" },
    { id: "pooja_lodhi", name: "Pooja Lodhi", avatar: "PL", color: "#3b82f6" }
  ]);
  const [showAssignPopup, setShowAssignPopup] = useState(false);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [isSendingTemplate, setIsSendingTemplate] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const handleAddEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Initialize Bitrix24 SDK dynamically if inside iframe
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (window.self === window.top) {
        setIsAuthorized(false);
      } else {
        const script = document.createElement("script");
        script.src = "https://api.bitrix24.com/api/v1/";
        script.async = true;

        const timeoutId = setTimeout(() => {
          setIsAuthorized(false);
        }, 5000);

        script.onload = () => {
          const w = window as any;
          if (w.BX24) {
            try {
              w.BX24.init(() => {
                clearTimeout(timeoutId);
                w.BX24.fitWindow();
                setIsAuthorized(true);

                // Fetch current user (staff) details
                try {
                  w.BX24.callMethod("user.current", {}, (resUser: any) => {
                    if (!resUser.error()) {
                      const userData = resUser.data();
                      const fullName = `${userData.NAME || ""} ${userData.LAST_NAME || ""}`.trim() || `User #${userData.ID}`;
                      setCurrentUser({ id: userData.ID, name: fullName });
                    }
                  });
                } catch (userErr) {
                  console.error("Error fetching current user profile:", userErr);
                }

                // Detect if running inside a Lead/Contact Placement Tab
                try {
                  const info = w.BX24.placement.info();
                  if (info && info.options && info.options.ID) {
                    setIsSidebarOpen(false);
                    const entityId = info.options.ID;
                    const placementName = info.placement;
                    let apiMethod = "crm.lead.get";
                    if (placementName === "CRM_CONTACT_DETAIL_TAB" || placementName === "CRM_CONTACT_DETAIL_ACTIVITY") {
                      apiMethod = "crm.contact.get";
                    }

                    w.BX24.callMethod(apiMethod, { id: entityId }, async (result: any) => {
                      if (result.error()) {
                        console.error("Error fetching CRM entity details:", result.error());
                        return;
                      }

                      const entity = result.data();
                      let phone = "";
                      if (entity.PHONE && Array.isArray(entity.PHONE) && entity.PHONE.length > 0) {
                        phone = entity.PHONE[0].VALUE;
                      } else if (entity.PHONE && typeof entity.PHONE === "string") {
                        phone = entity.PHONE;
                      }

                      if (phone) {
                        const cleaned = cleanPhone(phone);
                        const firstName = entity.NAME || "";
                        const lastName = entity.LAST_NAME || "";
                        const fullName = `${firstName} ${lastName}`.trim() || `Lead #${entityId}`;

                        // Check/Create contact in Firestore
                        const contactRef = doc(db, "contacts", cleaned);
                        const contactSnap = await getDoc(contactRef);

                        if (!contactSnap.exists()) {
                          await setDoc(contactRef, {
                            id: cleaned,
                            name: fullName,
                            preview: "Phone: " + phone,
                            time: new Date().toLocaleTimeString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: true
                            }),
                            lastUpdated: serverTimestamp(),
                            statusText: "WhatsApp • Online",
                          });
                        }

                        // Switch to the loaded chat
                        setActiveChatId(cleaned);
                      }
                    });
                  }
                } catch (e) {
                  console.error("Error getting placement info:", e);
                }
              });
            } catch (e) {
              console.error("Failed to initialize Bitrix24 client SDK", e);
            }
          }
        };
        document.head.appendChild(script);
      }
    }
  }, []);

  // 1. Real-time Firestore listener for contacts list
  useEffect(() => {
    const q = query(collection(db, "contacts"), orderBy("lastUpdated", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: Contact[] = [];
      snapshot.forEach((doc) => {
        fetched.push({ id: doc.id, ...doc.data() } as Contact);
      });
      
      if (fetched.length > 0) {
        setContacts(fetched);
      } else {
        // Seed initial mock contacts if Firestore is completely empty
        INITIAL_CONTACTS.forEach(async (c) => {
          await setDoc(doc(db, "contacts", c.id), {
            ...c,
            lastUpdated: serverTimestamp(),
          });
        });
      }
    });

    return () => unsubscribe();
  }, []);

  // 2. Real-time Firestore listener for active chat messages
  useEffect(() => {
    if (!activeChatId) return;

    const messagesRef = collection(db, "contacts", activeChatId, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        msgs.push({
          id: doc.id,
          text: data.text || "",
          isSent: !!data.isSent,
          time: data.time || "",
          status: data.status || "sent",
          mediaUrl: data.mediaUrl || "",
          mediaType: data.mediaType || "",
          errorCode: data.errorCode || "",
          errorMessage: data.errorMessage || "",
          timestamp: data.timestamp,
          senderName: data.senderName || "",
        });
      });

      setAllMessages((prev) => ({
        ...prev,
        [activeChatId]: msgs,
      }));
    });

    return () => unsubscribe();
  }, [activeChatId]);

  // Load last active chat from localStorage on mount
  useEffect(() => {
    const savedActiveChat = localStorage.getItem("whatsbit_active_chat");
    if (savedActiveChat) {
      setActiveChatId(savedActiveChat);
    }
  }, []);

  // Save active chat to localStorage
  useEffect(() => {
    localStorage.setItem("whatsbit_active_chat", activeChatId);
  }, [activeChatId]);

  // Fetch live contacts and users from Bitrix24 and sync to Firestore
  useEffect(() => {
    const fetchBitrixContacts = () => {
      const w = window as any;
      if (w.BX24) {
        w.BX24.init(() => {
          // Fetch CRM contacts
          w.BX24.callMethod(
            "crm.contact.list",
            {
              order: { "DATE_CREATE": "DESC" },
              select: ["ID", "NAME", "LAST_NAME", "PHONE"]
            },
            (result: any) => {
              if (result.error()) {
                console.error("Error fetching Bitrix24 contacts:", result.error());
                return;
              }

              const data = result.data();
              if (Array.isArray(data) && data.length > 0) {
                const fetchedContacts: Contact[] = data.map((item: any) => {
                  const firstName = item.NAME || "";
                  const lastName = item.LAST_NAME || "";
                  const fullName = `${firstName} ${lastName}`.trim() || `Contact #${item.ID}`;
                  
                  // Extract first phone number
                  let phone = "";
                  if (Array.isArray(item.PHONE) && item.PHONE.length > 0) {
                    phone = item.PHONE[0].VALUE || "";
                  }
                  const cleanedPhone = phone ? cleanPhone(phone) : "";
                  
                  // Initials for avatar
                  const initials = fullName
                    .split(" ")
                    .map((n: string) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2) || "👤";

                  return {
                    id: cleanedPhone || item.ID, // Fallback to ID if no phone
                    name: fullName,
                    avatar: initials.match(/[a-zA-Z]/) ? initials : "👤",
                    time: "Today",
                    preview: "No messages yet",
                    statusText: "WhatsApp • Unsorted",
                    responsibleId: "anirrudh_sharma", // default
                  };
                });

                // Sync fetched Bitrix24 contacts to Firestore
                fetchedContacts.forEach(async (c) => {
                  const contactRef = doc(db, "contacts", c.id);
                  const docSnap = await getDoc(contactRef);
                  if (!docSnap.exists()) {
                    await setDoc(contactRef, {
                      id: c.id,
                      name: c.name,
                      avatar: c.avatar,
                      time: c.time,
                      preview: c.preview,
                      statusText: c.statusText,
                      responsibleId: c.responsibleId,
                      lastUpdated: serverTimestamp(),
                    });
                  } else {
                    await updateDoc(contactRef, {
                      name: c.name,
                      avatar: c.avatar,
                    });
                  }
                });

                // Auto-switch to first contact on initial view
                if (fetchedContacts.length > 0 && activeChatId === "918839780947") {
                  setActiveChatId(fetchedContacts[0].id);
                }
              }
            }
          );

          // Fetch active users/managers list from Bitrix24
          w.BX24.callMethod(
            "user.get",
            { ACTIVE: "Y" },
            (userResult: any) => {
              if (!userResult.error()) {
                const userData = userResult.data();
                if (Array.isArray(userData) && userData.length > 0) {
                  const colors = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];
                  const fetchedUsers = userData.map((u: any, index: number) => {
                    const initials = `${u.NAME || ""}${u.LAST_NAME || ""}`
                      .split("")
                      .filter((char, idx, arr) => idx === 0 || arr[idx - 1] === " ")
                      .join("")
                      .toUpperCase()
                      .slice(0, 2) || "U";
                    return {
                      id: u.ID,
                      name: `${u.NAME || ""} ${u.LAST_NAME || ""}`.trim(),
                      avatar: initials,
                      color: colors[index % colors.length]
                    };
                  });
                  setUsers(fetchedUsers);
                }
              }
            }
          );
        });
      }
    };

    const timer = setInterval(() => {
      const w = window as any;
      if (w.BX24) {
        clearInterval(timer);
        fetchBitrixContacts();
      }
    }, 500);

    return () => clearInterval(timer);
  }, [activeChatId]);

  // Listen for Escape key to close lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveLightboxImage(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const activeContact = contacts.find((c) => c.id === activeChatId) || (activeChatId ? {
    id: activeChatId,
    name: activeChatId,
    preview: "No messages yet",
    time: "",
    statusText: "WhatsApp • Online",
    avatar: undefined,
    responsibleId: undefined,
    statusSelect: undefined,
    label: undefined
  } as unknown as Contact : (contacts[0] || INITIAL_CONTACTS[0]));
  const messages = allMessages[activeChatId] || [];

  const is24HourWindowActive = () => {
    if (!messages || messages.length === 0) return false;
    
    // Find the last received message from the customer (inbound)
    const lastReceived = [...messages].reverse().find(m => !m.isSent);
    if (!lastReceived) return false;
    
    if (!lastReceived.timestamp) {
      return true;
    }
    
    const msgDate = lastReceived.timestamp.toDate 
      ? lastReceived.timestamp.toDate() 
      : new Date(lastReceived.timestamp.seconds * 1000);
      
    const differenceInMs = Date.now() - msgDate.getTime();
    const twentyFourHoursInMs = 24 * 60 * 60 * 1000;
    
    return differenceInMs < twentyFourHoursInMs;
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const getStatusLabel = (contact: Contact) => {
    if (contact.statusSelect) {
      switch (contact.statusSelect) {
        case "in_progress": return "In Progress";
        case "completed": return "Completed";
        case "unsorted": return "Unsorted";
      }
    }
    if (contact.statusText) {
      return contact.statusText.replace("WhatsApp • ", "");
    }
    return "Unsorted";
  };

  const groupMessagesByDate = (msgs: Message[]) => {
    const groups: { [key: string]: Message[] } = {};
    msgs.forEach((m) => {
      let dateStr = "Today";
      if (m.timestamp) {
        const date = m.timestamp.toDate ? m.timestamp.toDate() : new Date(m.timestamp.seconds * 1000);
        dateStr = date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
      }
      if (!groups[dateStr]) {
        groups[dateStr] = [];
      }
      groups[dateStr].push(m);
    });
    return groups;
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!activeChatId) return;
    const contactRef = doc(db, "contacts", activeChatId);
    let statusTextVal = "WhatsApp • Unsorted";
    if (newStatus === "in_progress") {
      statusTextVal = "WhatsApp • In Progress";
    } else if (newStatus === "completed") {
      statusTextVal = "WhatsApp • Completed";
    }

    await updateDoc(contactRef, {
      statusText: statusTextVal,
      statusSelect: newStatus,
    });
  };

  const handleLabelChange = async (newLabel: string) => {
    if (!activeChatId) return;
    const contactRef = doc(db, "contacts", activeChatId);
    await updateDoc(contactRef, {
      label: newLabel,
    });
  };

  const handleReassign = async (newUserId: string) => {
    const assignedUser = users.find(u => u.id === newUserId);
    const userName = assignedUser ? assignedUser.name : "Not chosen";
    
    // Update contact's responsible ID in Firestore
    const contactRef = doc(db, "contacts", activeChatId);
    await updateDoc(contactRef, { responsibleId: newUserId });

    // Add system notification to messages list in Firestore
    const messagesRef = collection(db, "contacts", activeChatId, "messages");
    await addDoc(messagesRef, {
      text: `Set responsible: 👤 ${userName}`,
      isSent: false,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      status: "read",
      timestamp: serverTimestamp(),
      twilioSid: `system-${Date.now()}`
    });

    setShowAssignPopup(false);
  };

  const handleSendTemplate = async (template: { name: string; text: string; templateSid: string }) => {
    setIsSendingTemplate(true);
    setShowTemplateDropdown(false);
    try {
      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: activeChatId,
          text: template.text,
          useTemplate: true,
          templateSid: template.templateSid,
          senderName: currentUser ? currentUser.name : "Staff",
        }),
      });
      const result = await response.json();
      if (!result.success) {
        console.error("Failed to send template via Twilio API:", result.error);
      }
    } catch (err) {
      console.error("Error calling send template API:", err);
    } finally {
      setIsSendingTemplate(false);
    }
  };

  const formatTimeIST = (msg: Message) => {
    if (msg.timestamp) {
      try {
        const date = msg.timestamp.toDate 
          ? msg.timestamp.toDate() 
          : new Date(msg.timestamp.seconds * 1000);
        
        if (!isNaN(date.getTime())) {
          return date.toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
          });
        }
      } catch (e) {
        // Ignore
      }
    }
    return msg.time;
  };

  const formatContactTimeIST = (contact: Contact & { lastUpdated?: any }) => {
    if (contact.lastUpdated) {
      try {
        const date = contact.lastUpdated.toDate 
          ? contact.lastUpdated.toDate() 
          : new Date(contact.lastUpdated.seconds * 1000);
        
        if (!isNaN(date.getTime())) {
          return date.toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
          });
        }
      } catch (e) {
        // Ignore
      }
    }
    return contact.time;
  };

  const formatBx24Error = (err: any): string => {
    if (!err) return "Unknown error";
    if (err.ex && err.ex.error_description) return err.ex.error_description;
    if (err.ex && err.ex.error) return err.ex.error;
    if (err.status) return "HTTP Status: " + err.status;
    return err.toString() || "Request failed";
  };

  const registerPlacements = () => {
    const w = window as any;
    if (w.BX24) {
      try {
        w.BX24.init(() => {
          // 1. Get all currently registered placements to clean up stale duplicates
          w.BX24.callMethod("placement.get", {}, (resGet: any) => {
            if (resGet.error()) {
              console.error("Error getting placements:", resGet.error());
              alert("Sync placement check failed: " + formatBx24Error(resGet.error()) + "\nWill try to register directly.");
              bindNewPlacements();
              return;
            }
            
            const list = resGet.data();
            if (Array.isArray(list) && list.length > 0) {
              let unbindCount = 0;
              list.forEach((item: any) => {
                w.BX24.callMethod("placement.unbind", {
                  PLACEMENT: item.placement,
                  HANDLER: item.handler
                }, (resUnbind: any) => {
                  unbindCount++;
                  if (resUnbind.error()) {
                    console.error("Failed to unbind old placement:", resUnbind.error());
                  }
                  if (unbindCount === list.length) {
                    bindNewPlacements();
                  }
                });
              });
            } else {
              bindNewPlacements();
            }
          });
        });
      } catch (e) {
        alert("Error during placement sync: " + e);
      }
    } else {
      alert("Please open this app inside Bitrix24 to register buttons.");
    }
  };

  const bindNewPlacements = () => {
    const w = window as any;
    w.BX24.callMethod("placement.bind", {
      PLACEMENT: "CRM_LEAD_DETAIL_TAB",
      HANDLER: window.location.origin + "/",
      TITLE: "WhatsappLine",
      DESCRIPTION: "WhatsApp chat for this lead"
    }, (res1: any) => {
      if (res1.error()) {
        alert("Failed to bind CRM_LEAD_DETAIL_TAB:\n" + formatBx24Error(res1.error()));
        return;
      }
      w.BX24.callMethod("placement.bind", {
        PLACEMENT: "CRM_CONTACT_DETAIL_TAB",
        HANDLER: window.location.origin + "/",
        TITLE: "WhatsappLine",
        DESCRIPTION: "WhatsApp chat for this contact"
      }, (res2: any) => {
        if (res2.error()) {
          alert("Failed to bind CRM_CONTACT_DETAIL_TAB:\n" + formatBx24Error(res2.error()));
          return;
        }
        w.BX24.callMethod("placement.bind", {
          PLACEMENT: "CRM_LEAD_DETAIL_ACTIVITY",
          HANDLER: window.location.origin + "/",
          TITLE: "WhatsappLine Dialog",
          DESCRIPTION: "WhatsApp chat for this lead"
        }, (res3: any) => {
          if (res3.error()) {
            alert("Failed to bind CRM_LEAD_DETAIL_ACTIVITY:\n" + formatBx24Error(res3.error()));
            return;
          }
          w.BX24.callMethod("placement.bind", {
            PLACEMENT: "CRM_CONTACT_DETAIL_ACTIVITY",
            HANDLER: window.location.origin + "/",
            TITLE: "WhatsappLine Dialog",
            DESCRIPTION: "WhatsApp chat for this contact"
          }, (res4: any) => {
            if (res4.error()) {
              alert("Failed to bind CRM_CONTACT_DETAIL_ACTIVITY:\n" + formatBx24Error(res4.error()));
              return;
            }
            alert("WhatsappLine CRM placements synced successfully under 'WhatsappLine' and 'WhatsappLine Dialog'!");
          });
        });
      });
    });
  };

  const handleSend = async () => {
    if (!inputText.trim() && !selectedFile) return;

    const messageText = inputText;
    const fileToSend = selectedFile;
    
    setUploadError(null); // Clear any previous error before starting

    if (fileToSend) {
      setUploading(true);
      const useLocalUpload = process.env.NEXT_PUBLIC_USE_LOCAL_UPLOAD === "true";

      if (useLocalUpload) {
        try {
          const formData = new FormData();
          formData.append("file", fileToSend);
          formData.append("contactId", activeChatId);

          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/chat/upload", true);
          
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const progress = (event.loaded / event.total) * 100;
              setUploadProgress(Math.round(progress));
            }
          };

          xhr.onload = async () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const result = JSON.parse(xhr.responseText);
                if (result.success) {
                  const downloadURL = result.url;
                  let mediaType = "document";
                  if (fileToSend.type.startsWith("image/")) mediaType = "image";
                  else if (fileToSend.type.startsWith("video/")) mediaType = "video";
                  
                  const response = await fetch("/api/chat/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      contactId: activeChatId,
                      text: messageText,
                      mediaUrl: downloadURL,
                      mediaType: mediaType,
                      senderName: currentUser ? currentUser.name : "Staff",
                    }),
                  });
                  const sendResult = await response.json();
                  if (sendResult.success) {
                    setSelectedFile(null);
                    setInputText("");
                  } else {
                    setUploadError(sendResult.error || "Failed to send message via Twilio API");
                  }
                } else {
                  setUploadError(result.error || "Local upload failed");
                }
              } catch (err: any) {
                setUploadError("Failed to parse local upload response: " + err.message);
              }
            } else {
              setUploadError(`Local upload failed with status code: ${xhr.status}`);
            }
            setUploading(false);
            setUploadProgress(0);
          };

          xhr.onerror = () => {
            setUploadError("Network error occurred during local upload");
            setUploading(false);
            setUploadProgress(0);
          };

          xhr.send(formData);
        } catch (err: any) {
          console.error("Error in local upload flow:", err);
          setUploadError(err.message || "Failed to initiate local upload");
          setUploading(false);
          setUploadProgress(0);
        }
      } else {
        // Firebase Cloud Storage upload flow
        try {
          const storageRef = ref(storage, `attachments/${activeChatId}/${Date.now()}_${fileToSend.name}`);
          const uploadTask = uploadBytesResumable(storageRef, fileToSend);
          
          uploadTask.on('state_changed', 
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(Math.round(progress));
            }, 
            (error) => {
              console.error("Upload failed:", error);
              setUploadError(error.message || "Upload failed. Storage rules may be blocking access.");
              setUploading(false);
              setUploadProgress(0);
            }, 
            async () => {
              try {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                let mediaType = "document";
                if (fileToSend.type.startsWith("image/")) mediaType = "image";
                else if (fileToSend.type.startsWith("video/")) mediaType = "video";
                
                const response = await fetch("/api/chat/send", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    contactId: activeChatId,
                    text: messageText,
                    mediaUrl: downloadURL,
                    mediaType: mediaType,
                    senderName: currentUser ? currentUser.name : "Staff",
                  }),
                });
                const result = await response.json();
                if (result.success) {
                  setSelectedFile(null); // Only clear on success
                  setInputText(""); // Only clear on success
                } else {
                  setUploadError(result.error || "Failed to send message via Twilio API");
                }
              } catch (err: any) {
                console.error("Error calling send message API:", err);
                setUploadError(err.message || "Failed to send message via Twilio API");
              } finally {
                setUploading(false);
                setUploadProgress(0);
              }
            }
          );
        } catch (err: any) {
          console.error("Error in upload flow:", err);
          setUploadError(err.message || "Failed to initiate upload");
          setUploading(false);
          setUploadProgress(0);
        }
      }
    } else {
      // Text-only message flow
      setInputText(""); // Clear input early for responsive feel
      const isWelcomeTemplate = messageText.toLowerCase().includes("welcome") || messageText.toLowerCase().includes("choyal");

      try {
        const response = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId: activeChatId,
            text: messageText,
            useTemplate: isWelcomeTemplate,
            senderName: currentUser ? currentUser.name : "Staff",
          }),
        });
        const result = await response.json();
        if (!result.success) {
          console.error("Failed to send message via Twilio API:", result.error);
        }
      } catch (err) {
        console.error("Error calling send message API:", err);
      }
    }
  };

  // Dynamic counts calculation
  const allCount = contacts.length;
  const unprocessedCount = contacts.filter(c => c.statusSelect === undefined || c.statusSelect === "unsorted").length;
  const myCount = contacts.filter(c => c.responsibleId === "anirrudh_sharma").length;

  const filteredContacts = contacts.filter((c) => {
    const matchesSearch = 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.preview.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase());
      
    if (!matchesSearch) return false;

    if (activeMenuFilter === "unprocessed") {
      return c.statusSelect === undefined || c.statusSelect === "unsorted";
    }
    if (activeMenuFilter === "my") {
      return c.responsibleId === "anirrudh_sharma";
    }
    
    // Dynamic match for custom labels
    const isCustomFilter = customLabels.some(lbl => lbl.name.toLowerCase() === activeMenuFilter);
    if (isCustomFilter) {
      return c.label === activeMenuFilter;
    }
    
    return true; // "all"
  });

  if (isAuthorized === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0f172a', color: '#f8fafc', fontFamily: 'sans-serif' }}>
        <div style={{ width: '40px', height: '40px', border: '4px solid #334155', borderTop: '4px solid #3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
        <p style={{ marginTop: '16px', fontSize: '14px', opacity: 0.8 }}>Connecting to Bitrix24...</p>
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        `}} />
      </div>
    );
  }

  if (isAuthorized === false) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0f172a', color: '#f8fafc', padding: '24px', fontFamily: 'sans-serif', textAlign: 'center' }}>
        <div style={{ background: '#ef444415', border: '1px solid #ef444430', borderRadius: '12px', padding: '32px', maxWidth: '480px' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '16px', display: 'inline-block' }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>Access Denied</h2>
          <p style={{ fontSize: '14px', color: '#94a3b8', lineHeight: 1.5, marginBottom: '16px' }}>
            This application is secure and can only be accessed within your Bitrix24 portal. Direct external access is restricted.
          </p>
          <div style={{ fontSize: '12px', color: '#64748b', borderTop: '1px solid #334155', paddingTop: '16px' }}>
            App ID: WhatsappLine • Status: Secured
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.appContainer}>
      {/* VSCode-style slim Activity Bar */}
      <div className={styles.activityBar}>
        <div className={styles.activityBarTop}>
          <div className={styles.activityLogo} title="WhatsappLine">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="#00a884">
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.513 2.262 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.665.988 3.3.15 5.367.15 5.068 0 9.197-4.127 9.2-9.197.002-2.457-.962-4.767-2.715-6.523C16.69 1.83 14.383.867 11.92.867c-5.071 0-9.2 4.127-9.202 9.2-.001 1.942.508 3.834 1.474 5.513l-.993 3.63 3.448-.926z"/>
            </svg>
          </div>
          <button 
            className={`${styles.activityButton} ${isSidebarOpen ? styles.activityButtonActive : ""}`} 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title="Toggle Sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </button>
        </div>

        <div className={styles.activityBarBottom}>
          <button 
            onClick={registerPlacements} 
            className={styles.activityButton}
            title="Sync CRM Placements"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
          </button>
        </div>
      </div>

      {/* 1. CRM Sidebar */}
      {isSidebarOpen && (
        <div className={styles.crmSidebar}>
          <div className={styles.crmHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className={styles.crmAvatar}>N</div>
              <span>New company</span>
            </div>
          </div>
          <ul className={styles.crmMenu}>
            {customLabels.map((lbl) => {
              const key = lbl.name.toLowerCase();
              const count = contacts.filter(c => c.label === key).length;
              return (
                <li 
                  key={lbl.id}
                  onClick={() => setActiveMenuFilter(key)}
                  className={`${styles.crmMenuItem} ${activeMenuFilter === key ? styles.crmMenuItemActive : ""}`}
                >
                  {lbl.name} <span className={styles.badge}>{count}</span>
                </li>
              );
            })}
            {/* Add Label Button */}
            <li 
              onClick={handleCreateNewLabel}
              className={styles.crmMenuItem}
              style={{ color: '#2563eb', fontWeight: '600', justifyContent: 'center', gap: '6px', borderTop: '1px dashed #e2e8f0', marginTop: '4px' }}
            >
              ➕ Add Label
            </li>
          </ul>
          <ul className={styles.crmMenu} style={{ marginTop: '24px' }}>
            <li 
              onClick={() => setActiveMenuFilter("all")}
              className={`${styles.crmMenuItem} ${activeMenuFilter === "all" ? styles.crmMenuItemActive : ""}`}
            >
              All <span className={styles.badge}>{allCount}</span>
            </li>
            <li 
              onClick={() => setActiveMenuFilter("unprocessed")}
              className={`${styles.crmMenuItem} ${activeMenuFilter === "unprocessed" ? styles.crmMenuItemActive : ""}`}
            >
              Unprocessed <span className={styles.badge}>{unprocessedCount}</span>
            </li>
            <li 
              onClick={() => setActiveMenuFilter("my")}
              className={`${styles.crmMenuItem} ${activeMenuFilter === "my" ? styles.crmMenuItemActive : ""}`}
            >
              My <span className={styles.badge}>{myCount}</span>
            </li>
          </ul>
        </div>
      )}

      {/* 2. Chat List Pane */}
      {isSidebarOpen && (
        <div className={styles.chatListPane}>
          <div className={styles.chatSearch}>
            <input
              type="text"
              placeholder="Search from URL or contacts..."
              className={styles.chatSearchInput}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className={styles.contactList}>
            {filteredContacts.map((contact) => {
              const isActive = contact.id === activeChatId;
              return (
                <div
                  key={contact.id}
                  className={`${styles.contactItem} ${isActive ? styles.contactItemActive : ""}`}
                  onClick={() => setActiveChatId(contact.id)}
                >
                  <div className={styles.contactAvatar}>{contact.avatar}</div>
                  <div className={styles.contactInfo}>
                    <div className={styles.contactHeader}>
                      <span className={styles.contactName}>{contact.name}</span>
                      <span className={styles.contactTime}>{formatContactTimeIST(contact)}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '500', marginBottom: '2px' }}>{contact.id}</div>
                    <span className={styles.contactPreview}>
                      {contact.preview && contact.preview.startsWith("Phone:") ? "No messages yet" : contact.preview}
                    </span>
                  </div>
                </div>
              );
            })}
            {(() => {
              const cleanedQuery = searchQuery.replace(/[^\d+]/g, "");
              const isNumeric = /^\+?\d{8,15}$/.test(cleanedQuery);
              const exists = contacts.some(c => c.id === cleanedQuery || c.id.replace(/[^\d+]/g, "") === cleanedQuery);
              if (isNumeric && !exists) {
                return (
                  <div
                    className={styles.contactItem}
                    style={{ 
                      border: '1px dashed #10b981', 
                      backgroundColor: '#f0fdf4', 
                      margin: '8px', 
                      borderRadius: '8px',
                      cursor: 'pointer',
                      padding: '12px'
                    }}
                    onClick={() => {
                      setActiveChatId(cleanedQuery);
                      setSearchQuery("");
                    }}
                  >
                    <div className={styles.contactAvatar} style={{ backgroundColor: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 'bold' }}>
                      +
                    </div>
                    <div className={styles.contactInfo}>
                      <div className={styles.contactHeader}>
                        <span className={styles.contactName} style={{ color: '#15803d', fontWeight: '600' }}>Start chat with:</span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#166534', marginTop: '2px', fontWeight: '500' }}>{cleanedQuery}</div>
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </div>
        </div>
      )}

      {/* 3. Active Chat Pane */}
      <div className={styles.activeChatPane}>
        <div className={styles.chatHeader}>
          <div className={styles.chatHeaderLeft}>
            <div className={styles.contactAvatar} style={{ width: 40, height: 40, backgroundColor: '#cbd5e1' }}>
              {activeContact.avatar}
            </div>
            <div className={styles.chatHeaderInfo}>
              <span className={styles.chatHeaderName}>{activeContact.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                <span style={{ fontSize: '12px', fontWeight: '500', color: '#64748b' }}>{activeContact.id}</span>
                <span style={{ fontSize: '10px', color: '#cbd5e1' }}>|</span>
                <span style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: 
                    activeContact.statusSelect === 'completed' ? '#ecfdf5' : 
                    activeContact.statusSelect === 'in_progress' ? '#eff6ff' : '#f1f5f9',
                  color: 
                    activeContact.statusSelect === 'completed' ? '#047857' : 
                    activeContact.statusSelect === 'in_progress' ? '#1d4ed8' : '#475569',
                }}>
                  {getStatusLabel(activeContact)}
                </span>
              </div>
            </div>
          </div>

          <div className={styles.chatHeaderRight}>
            {/* Status Dropdown */}
            <select 
              className={styles.statusSelect} 
              value={activeContact.statusSelect || "unsorted"}
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              <option value="unsorted">Unsorted</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>

            {/* Label Dropdown */}
            <select 
              className={styles.statusSelect} 
              style={{ backgroundColor: '#f3e8ff', color: '#6b21a8', border: '1px solid #d8b4fe' }}
              value={activeContact.label || ""}
              onChange={(e) => handleLabelChange(e.target.value)}
            >
              <option value="">No Label</option>
              {customLabels.map((lbl) => (
                <option key={lbl.id} value={lbl.name.toLowerCase()}>{lbl.name}</option>
              ))}
            </select>

            {/* Responsible Person Selector */}
            <div style={{ position: "relative" }}>
              <button 
                onClick={() => setShowAssignPopup(!showAssignPopup)}
                className={styles.responsibleBadgeButton}
              >
                {activeContact.responsibleId && users.find(u => u.id === activeContact.responsibleId) ? (
                  <div 
                    className={styles.responsibleAvatar} 
                    style={{ backgroundColor: users.find(u => u.id === activeContact.responsibleId)?.color || "#10b981" }}
                  >
                    {users.find(u => u.id === activeContact.responsibleId)?.avatar}
                  </div>
                ) : (
                  <div 
                    className={styles.responsibleAvatar} 
                    style={{ backgroundColor: "#cbd5e1" }}
                    title="No responsible person assigned"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                  </div>
                )}
                <span className={styles.caret}>▼</span>
              </button>

              {showAssignPopup && (
                <div className={styles.assignPopup}>
                  <div className={styles.popupField}>
                    <label>Level</label>
                    <select className={styles.popupSelect}>
                      <option>Not chosen</option>
                      <option>High Priority</option>
                      <option>Medium Priority</option>
                      <option>Low Priority</option>
                    </select>
                  </div>
                  
                  <div className={styles.popupField}>
                    <label>Responsible</label>
                    <select 
                      value={activeContact.responsibleId || ""} 
                      onChange={(e) => handleReassign(e.target.value)}
                      className={styles.popupSelect}
                    >
                      <option value="">Not chosen</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.popupField}>
                    <label>Producer</label>
                    <select className={styles.popupSelect}>
                      <option>Not chosen</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.popupField}>
                    <label>Accomplices</label>
                    <select className={styles.popupSelect}>
                      <option>Not chosen</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.popupField}>
                    <label>Auditor</label>
                    <select className={styles.popupSelect}>
                      <option>Not chosen</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <button style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748b' }}>⋮</button>
          </div>
        </div>

        <div className={styles.messagesContainer}>
          {Object.entries(groupMessagesByDate(messages)).map(([dateStr, dayMessages]) => (
            <div key={dateStr} style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
              <div style={{ textAlign: 'center', margin: '16px 0' }}>
                <span style={{ backgroundColor: '#fff', padding: '6px 12px', borderRadius: '16px', fontSize: '12px', color: '#64748b', boxShadow: '0 1px 1px rgba(0,0,0,0.05)' }}>
                  {dateStr}
                </span>
              </div>

              {dayMessages.map((msg) => {
                const isSystem = msg.text.startsWith("Set responsible:") || msg.id.startsWith("system-");
                if (isSystem) {
                  return (
                    <div key={msg.id} style={{ textAlign: 'center', margin: '12px 0' }}>
                      <span style={{ backgroundColor: '#fff', padding: '6px 12px', borderRadius: '16px', fontSize: '12px', color: '#64748b', boxShadow: '0 1px 1px rgba(0,0,0,0.05)' }}>
                        {msg.text} <span style={{ fontSize: '10px', marginLeft: '6px', opacity: 0.8 }}>{formatTimeIST(msg)}</span>
                      </span>
                    </div>
                  );
                }
                return (
                  <div key={msg.id} className={`${styles.messageWrapper} ${msg.isSent ? styles.sent : styles.received}`}>
                    <div className={styles.messageBubble}>
                      {msg.mediaUrl && (
                        <div style={{ marginBottom: '8px' }}>
                          {msg.mediaType === "image" || (!msg.mediaType && (msg.mediaUrl.match(/\.(jpeg|jpg|gif|png|webp)/i) || msg.mediaUrl.includes("api.twilio.com"))) ? (
                            <img 
                              src={msg.mediaUrl} 
                              alt="Attachment" 
                              style={{ maxWidth: "100%", maxHeight: "240px", borderRadius: "8px", display: "block", objectFit: "cover", cursor: "pointer" }} 
                              onClick={() => setActiveLightboxImage(msg.mediaUrl || null)}
                            />
                          ) : msg.mediaType === "video" || (!msg.mediaType && msg.mediaUrl.match(/\.(mp4|webm|ogg)/i)) ? (
                            <video 
                              src={msg.mediaUrl} 
                              controls 
                              style={{ maxWidth: "100%", maxHeight: "240px", borderRadius: "8px", display: "block" }} 
                            />
                          ) : msg.mediaType === "audio" || (!msg.mediaType && msg.mediaUrl.match(/\.(mp3|wav|ogg|m4a|aac|amr)/i)) ? (
                            <audio 
                              src={msg.mediaUrl} 
                              controls 
                              style={{ maxWidth: "100%", display: "block", marginTop: "4px" }} 
                            />
                          ) : (
                            <a 
                              href={msg.mediaUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '10px 12px',
                                background: 'rgba(0,0,0,0.06)',
                                borderRadius: '8px',
                                textDecoration: 'none',
                                color: 'inherit',
                                fontSize: '13px',
                                fontWeight: '500'
                              }}
                            >
                              📄 View Document
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto' }}>
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                            </a>
                          )}
                        </div>
                      )}
                      {msg.text && <div>{msg.text}</div>}
                      {msg.isSent && msg.senderName && (
                        <div style={{ 
                          fontSize: '10px', 
                          opacity: 0.7, 
                          textAlign: 'right', 
                          marginTop: '4px',
                          fontStyle: 'italic',
                          color: '#475569'
                        }}>
                          Sent by {msg.senderName}
                        </div>
                      )}
                      <div className={styles.messageFooter}>
                        <span className={styles.messageTime}>{formatTimeIST(msg)}</span>
                        {msg.isSent && (
                          <span className={styles.messageStatus} style={{ color: msg.status === "failed" ? "#ef4444" : undefined }}>
                            {msg.status === "failed" ? (
                              "⚠️ Failed"
                            ) : msg.status === "read" ? (
                              "✓✓"
                            ) : (
                              "✓"
                            )}
                          </span>
                        )}
                      </div>
                      {msg.status === "failed" && msg.errorMessage && (
                        <div style={{ color: "#ef4444", fontSize: "10px", marginTop: "6px", borderTop: "1px dashed rgba(239, 68, 68, 0.3)", paddingTop: "4px" }}>
                          Twilio Error: {msg.errorMessage} {msg.errorCode ? `(Code ${msg.errorCode})` : ""}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Selected File Attachment Preview */}
        {selectedFile && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '10px 16px',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            borderBottom: '1px solid #e2e8f0',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '24px' }}>
                  {selectedFile.type.startsWith("image/") ? "🖼️" : selectedFile.type.startsWith("video/") ? "🎥" : "📄"}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#1e293b' }}>
                    {selectedFile.name}
                  </span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>
              </div>
              
              {uploading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '100px', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#3b82f6', transition: 'width 0.1s ease-out' }}></div>
                  </div>
                  <span style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 'bold' }}>{uploadProgress}%</span>
                </div>
              ) : (
                <button 
                  onClick={() => {
                    setSelectedFile(null);
                    setUploadError(null);
                  }} 
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '18px', padding: '4px' }}
                >
                  ✕
                </button>
              )}
            </div>
            {uploadError && (
              <div style={{
                color: '#ef4444',
                fontSize: '12px',
                fontWeight: '500',
                background: '#fef2f2',
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #fca5a5'
              }}>
                ⚠️ {uploadError}. Please ensure Firebase Storage is enabled in Console and rules are public.
              </div>
            )}
          </div>
        )}

        <div className={styles.chatInputArea} style={!is24HourWindowActive() ? { backgroundColor: '#f8fafc', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'stretch' } : {}}>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            accept="image/*,video/*,application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setSelectedFile(file);
                setUploadError(null);
              }
            }}
          />
          {!is24HourWindowActive() ? (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center', 
              padding: '24px 20px', 
              width: '100%', 
              textAlign: 'center',
              backgroundColor: '#fff',
              borderRadius: '12px',
              border: '1px dashed #cbd5e1',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              margin: '8px 0'
            }}>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>💬</div>
              <div style={{ 
                fontSize: '14px', 
                color: '#475569', 
                fontWeight: '500', 
                marginBottom: '16px' 
              }}>
                Choose a message template to initiate a conversation with this contact.
              </div>
              
              <div style={{ position: 'relative' }}>
                <button 
                  onClick={() => setShowTemplateDropdown(!showTemplateDropdown)} 
                  disabled={isSendingTemplate}
                  style={{ 
                    border: 'none', 
                    background: '#10b981',
                    color: '#fff',
                    padding: '10px 24px',
                    borderRadius: '24px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: isSendingTemplate ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    outline: 'none',
                    boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.2), 0 2px 4px -1px rgba(16, 185, 129, 0.1)',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#059669')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#10b981')}
                >
                  {isSendingTemplate ? (
                    <>
                      <span className={styles.spinner}></span>
                      Sending Template...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13"></line>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                      </svg>
                      Select Template <span style={{ fontSize: '8px' }}>▼</span>
                    </>
                  )}
                </button>

                {showTemplateDropdown && (
                  <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 8px)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '320px',
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                    padding: '8px',
                    zIndex: 100,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', padding: '6px 8px', textTransform: 'uppercase', textAlign: 'left' }}>
                      Select WhatsApp Template
                    </div>
                    {PREDEFINED_TEMPLATES.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        onClick={() => handleSendTemplate(tmpl)}
                        style={{
                          border: 'none',
                          background: 'none',
                          textAlign: 'left',
                          padding: '10px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          color: '#1e293b',
                          transition: 'background-color 0.2s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        title={tmpl.text}
                      >
                        <div style={{ fontWeight: '600', marginBottom: '2px', color: '#0f172a' }}>{tmpl.name}</div>
                        <div style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {tmpl.text}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <button 
                onClick={() => fileInputRef.current?.click()} 
                style={{ border: 'none', background: 'none', fontSize: '20px', cursor: 'pointer' }}
              >
                📎
              </button>

              {/* Emoji Trigger Button */}
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <button 
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)} 
                  style={{ border: 'none', background: 'none', fontSize: '20px', cursor: 'pointer', padding: '0 4px' }}
                  title="Add emoji"
                >
                  😀
                </button>
                {showEmojiPicker && (
                  <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 12px)',
                    left: '-10px',
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    boxShadow: '0 -10px 15px -3px rgba(0, 0, 0, 0.1), 0 -4px 6px -2px rgba(0, 0, 0, 0.05)',
                    padding: '12px',
                    zIndex: 100,
                    width: '260px',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', textAlign: 'left' }}>
                      Emojis
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(7, 1fr)',
                      gap: '6px',
                      maxHeight: '160px',
                      overflowY: 'auto',
                    }}>
                      {['😊', '😂', '🥰', '😍', '🥺', '😉', '😎', '👍', '🙌', '❤️', '🔥', '👏', '🎉', '🤔', '😢', '😡', '🚀', '👀', '💬', '📅', '📍', '✉️', '📞', '💡', '🔒', '✅', '❌', '➕', '➖', '❓', '❗️', '🤝', '💯', '✨', '⭐', '🌈', '☀️', '☕', '🍕', '🎉', '🎁', '💼', '💻', '📱', '🔒', '🔑'].map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => handleAddEmoji(emoji)}
                          style={{
                            border: 'none',
                            background: 'none',
                            fontSize: '20px',
                            cursor: 'pointer',
                            padding: '4px',
                            borderRadius: '6px',
                            transition: 'background-color 0.1s',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Templates Trigger Button */}
              <div style={{ position: "relative" }}>
                <button 
                  onClick={() => setShowTemplateDropdown(!showTemplateDropdown)} 
                  disabled={isSendingTemplate}
                  style={{ 
                    border: '1px solid #cbd5e1', 
                    background: '#f8fafc', 
                    color: '#475569',
                    padding: '6px 12px',
                    borderRadius: '16px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: isSendingTemplate ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    outline: 'none',
                    opacity: isSendingTemplate ? 0.7 : 1
                  }}
                >
                  {isSendingTemplate ? (
                    <>
                      <span className={styles.spinner}></span>
                      Sending...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#64748b' }}>
                        <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
                        <line x1="16" y1="8" x2="2" y2="22" />
                        <line x1="17.5" y1="15" x2="9" y2="15" />
                      </svg>
                      Templates <span style={{ fontSize: '8px' }}>▼</span>
                    </>
                  )}
                </button>

                {showTemplateDropdown && (
                  <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 8px)',
                    left: 0,
                    width: '280px',
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 -10px 15px -3px rgba(0, 0, 0, 0.1), 0 -4px 6px -2px rgba(0, 0, 0, 0.05)',
                    padding: '8px',
                    zIndex: 100,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', padding: '4px 8px', textTransform: 'uppercase', textAlign: 'left' }}>
                      Select WhatsApp Template
                    </div>
                    {PREDEFINED_TEMPLATES.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        onClick={() => handleSendTemplate(tmpl)}
                        style={{
                          border: 'none',
                          background: 'none',
                          textAlign: 'left',
                          padding: '8px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          color: '#1e293b',
                          transition: 'background-color 0.2s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        title={tmpl.text}
                      >
                        <div style={{ fontWeight: '600', marginBottom: '2px' }}>{tmpl.name}</div>
                        <div style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {tmpl.text}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <input
                type="text"
                placeholder="Type a message..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                className={styles.chatInputField}
              />
              <button onClick={handleSend} disabled={!inputText.trim() && !selectedFile} className={styles.sendButton}>
                <svg className={styles.sendIcon} viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Lightbox / Image Modal Popup */}
      {activeLightboxImage && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(11, 20, 26, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={() => setActiveLightboxImage(null)}
        >
          {/* Close button */}
          <button 
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'none',
              border: 'none',
              color: '#f1f5f9',
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.08)',
              transition: 'background-color 0.2s',
            }}
            onClick={() => setActiveLightboxImage(null)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          
          <img 
            src={activeLightboxImage} 
            alt="Enlarged Attachment" 
            style={{
              maxWidth: '90%',
              maxHeight: '90%',
              objectFit: 'contain',
              borderRadius: '8px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
