"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import styles from "./page.module.css";
import AutomationFlowBuilder from "./components/AutomationFlowBuilder";
import CampaignsDashboard from "./components/CampaignsDashboard";

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

function getCleanFileName(url: string): string {
  if (!url) return "document.pdf";
  try {
    const pathSeg = url.split("?")[0].split("/").pop() || "";
    const decoded = decodeURIComponent(pathSeg);
    const lastPart = decoded.split("/").pop() || "";
    
    let clean = lastPart.replace(/^attachments_/, "").replace(/^uploads_/, "");
    // Remove phone pattern prefix and timestamp
    clean = clean.replace(/^\+?\d+_[0-9]+_/, ""); 
    clean = clean.replace(/^[0-9]+_/, ""); 
    // Remove typical UUID prefix
    clean = clean.replace(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}_/, "");
    return clean || "document.pdf";
  } catch (e) {
    return "document.pdf";
  }
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
  deleteDoc,
  writeBatch,
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
  deliveredAt?: string;
  readAt?: string;
  templateSid?: string;
  linkOpenedAt?: any;
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
  labels?: string[];
  funnelStage?: string;
  isFavorite?: boolean;
  lastUpdated?: any;
  isMarketing?: boolean;
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
  },
  {
    id: "lead_qualification_welcome",
    name: "Welcome Flow",
    text: "Hi {{1}},\n\nThank you for your interest in flour milling solutions! 👋\n\nRS Choyal Group is a turnkey milling solutions provider with 60+ years of experience and 275+ successful projects across the globe.\n\nWhat brings you here?",
    templateSid: "HX46c6463e02f78669aac9d85c160fb0ab",
    buttons: ["Setup New Plant", "Plant Expansion", "Spares & Stones"]
  },
  {
    id: "missed_call",
    name: "Missed Call",
    text: "Hi {{1}},\n\nWe tried reaching you about your milling plant inquiry. 📞\n\nNo worries! Here are easier ways to connect:\n\n✓ Reply on WhatsApp \n✓ Call us at +91 92402 89259\n\nWhat works best for you?",
    templateSid: "HX3923a558bd905659e8030c0323066bc2",
    buttons: ["Chat Here", "Call"]
  },
  {
    id: "follow_up",
    name: "Follow up",
    text: "Hi {{Client Name}},\n\nHope you've had a chance to review the materials we shared! 👋\n\nI'm here to help with any questions about:\n- Plant design & customization for your needs\n- Investment & timeline details\n- Technical specifications\n- Next steps\n\nWhat would help you most right now?",
    templateSid: "HXd48310d1653f996f15a7a39f6a2803b5",
    buttons: ["Have Questions", "Call Me", "Chat Later", "Ready to Proceed"]
  },
  {
    id: "send_brochure",
    name: "Send Brochure",
    text: "Thank you for your interest in RS Choyal Group!\n\nHere's our company brochure with detailed specifications\n📄 {{1}}\n\nAlso check out these quick videos to see our work:\n\n🎥 Company Overview: https://www.youtube.com/watch?v=DlEcmcDS598\n\n🎥 How We Setup Plants: https://www.youtube.com/watch?v=OETierqPRFA\n\n🎥 Milling Plant Process (Hindi): https://www.youtube.com/watch?v=MjUnwkiwAvM",
    templateSid: "HX0f7cde84a9b825505fc6a3a608c2a3be",
    brochureLink: "https://cdn.clyrix.com/drive/rscg_company_profile.pdf"
  },
  {
    id: "detailed_quotation",
    name: "Detailed Quotation",
    text: "Hi {{Client Name}},\n\nThank you for sharing your requirements for a {{Plant Name}}!\n\nBased on our discussion, I've prepared a comprehensive quotation that includes:\n\n✅ Complete turnkey plant design for {{capacity}} TPD capacity\n✅ Equipment list with technical specifications\n✅ All applicable Choyal services for your plant\n\nPlease find attached our detailed quotation & technical proposal:\n📄 {{ quotation_pdf }}\n\nOur next steps typically include:\n🏗️ Technical discussion with our engineering team\n📈 Final proposal with timeline & payment schedule",
    templateSid: "HX58cd8aa67a890587d506da408de3f01e"
  }
];

export default function ChatApp() {
  const [contacts, setContacts] = useState<Contact[]>(INITIAL_CONTACTS);
  const [activeChatId, setActiveChatId] = useState<string>("918839780947");
  const [allMessages, setAllMessages] = useState<Record<string, Message[]>>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMenuFilter, setActiveMenuFilter] = useState<string>("all");
  const [activeView, setActiveView] = useState<"chat" | "automations" | "settings" | "campaigns" | "ai">("chat");
  const [companyName, setCompanyName] = useState("RS Choyal");
  const [logoUrl, setLogoUrl] = useState("/rschoyal-logo.svg");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiRestrictedNumbers, setAiRestrictedNumbers] = useState("");
  const [aiSystemInstruction, setAiSystemInstruction] = useState("You are a helpful customer support assistant for RS Choyal Group.");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiSaveLoading, setAiSaveLoading] = useState(false);
  const [timeZone, setTimeZone] = useState("Asia/Kolkata");
  const [hideCompanyName, setHideCompanyName] = useState(false);
  const [logoHeight, setLogoHeight] = useState(30);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [editName, setEditName] = useState("RS Choyal");
  const [editLogo, setEditLogo] = useState("/rschoyal-logo.svg");
  const [editTZ, setEditTZ] = useState("Asia/Kolkata");
  const [editHideCompanyName, setEditHideCompanyName] = useState(false);
  const [editLogoHeight, setEditLogoHeight] = useState(30);

  const [templates, setTemplates] = useState(PREDEFINED_TEMPLATES);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [promptTemplate, setPromptTemplate] = useState<{ id?: string; name: string; text: string; templateSid: string; brochureLink?: string; buttons?: string[] } | null>(null);
  const [promptedName, setPromptedName] = useState("");

  const [showVariablePrompt, setShowVariablePrompt] = useState(false);
  const [promptedVariables, setPromptedVariables] = useState<Record<string, string>>({});
  const [modalUploading, setModalUploading] = useState(false);
  const [modalUploadProgress, setModalUploadProgress] = useState(0);

  const getTemplateVariables = (text: string): string[] => {
    if (!text) return [];
    const regex = /\{\{\s*([a-zA-Z0-9_\-\s]+)\s*\}\}/g;
    const variables: string[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      const varName = match[1].trim();
      if (!variables.includes(varName)) {
        variables.push(varName);
      }
    }
    return variables;
  };

  useEffect(() => {
    async function loadLiveTemplates() {
      try {
        const res = await fetch("/api/twilio/templates");
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.templates) {
            setTemplates((prev) =>
              prev.map((pt) => {
                const live = data.templates.find((lt: any) => lt.sid === pt.templateSid);
                if (live && live.body) {
                  let liveText = live.body;
                  if (pt.brochureLink) {
                    liveText = liveText.replace("{{1}}", pt.brochureLink);
                  }
                  return {
                    ...pt,
                    text: liveText,
                  };
                }
                return pt;
              })
            );
          }
        }
      } catch (err) {
        console.warn("Failed to load live templates, using fallbacks:", err);
      }
    }
    loadLiveTemplates();
  }, []);

  useEffect(() => {
    setEditName(companyName);
  }, [companyName]);

  useEffect(() => {
    setEditLogo(logoUrl);
  }, [logoUrl]);

  useEffect(() => {
    setEditTZ(timeZone);
  }, [timeZone]);

  useEffect(() => {
    setEditHideCompanyName(hideCompanyName);
  }, [hideCompanyName]);

  useEffect(() => {
    setEditLogoHeight(logoHeight);
  }, [logoHeight]);
  const [customLabels, setCustomLabels] = useState<{ id: string; name: string; parentId?: string | null; order?: number }[]>([]);
  const [showLabelDropdown, setShowLabelDropdown] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; isAdmin: boolean } | null>(null);
  const [allowedStaffIds, setAllowedStaffIds] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stagedMediaUrl, setStagedMediaUrl] = useState<string | null>(null);
  const [stagedMediaType, setStagedMediaType] = useState<string | null>(null);
  const [stagedFileName, setStagedFileName] = useState<string | null>(null);
  const [activeDocumentUrl, setActiveDocumentUrl] = useState<string | null>(null);
  const [activeDocumentName, setActiveDocumentName] = useState<string | null>(null);

  // Clean, deduplicate and sort contacts list in memory in real-time
  const sortedContacts = useMemo(() => {
    const map = new Map<string, Contact>();
    
    contacts.forEach((c) => {
      const cleanId = cleanPhone(c.id);
      if (!cleanId) return;
      
      const existing = map.get(cleanId);
      if (!existing) {
        map.set(cleanId, { ...c, id: cleanId });
      } else {
        // Resolve timestamps safely to decide which is more recent
        const getTimestamp = (contact: Contact) => {
          if (!contact.lastUpdated) return 0;
          if (typeof (contact.lastUpdated as any).toDate === 'function') {
            return (contact.lastUpdated as any).toDate().getTime();
          }
          if ((contact.lastUpdated as any).seconds) {
            return (contact.lastUpdated as any).seconds * 1000;
          }
          const parsed = Date.parse(contact.lastUpdated as any);
          return isNaN(parsed) ? 0 : parsed;
        };
        
        const currentTs = getTimestamp(c);
        const existingTs = getTimestamp(existing);
        
        if (currentTs > existingTs) {
          // If the new one has a more recent update, merge and keep the clean ID
          map.set(cleanId, {
            ...existing,
            ...c,
            id: cleanId
          });
        } else {
          // Keep existing, but make sure name is updated if the older one didn't have it
          if (!existing.name || existing.name === existing.id) {
            existing.name = c.name;
          }
        }
      }
    });
    
    return Array.from(map.values()).sort((a, b) => {
      const getTimestamp = (contact: Contact) => {
        if (!contact.lastUpdated) return 0;
        if (typeof (contact.lastUpdated as any).toDate === 'function') {
          return (contact.lastUpdated as any).toDate().getTime();
        }
        if ((contact.lastUpdated as any).seconds) {
          return (contact.lastUpdated as any).seconds * 1000;
        }
        const parsed = Date.parse(contact.lastUpdated as any);
        return isNaN(parsed) ? 0 : parsed;
      };
      return getTimestamp(b) - getTimestamp(a);
    });
  }, [contacts]);

  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedGroupParticipants, setSelectedGroupParticipants] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeLightboxImage, setActiveLightboxImage] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState<number>(1);

  useEffect(() => {
    const labelsRef = collection(db, "labels");
    const unsubscribe = onSnapshot(labelsRef, (snapshot) => {
      const list: { id: string; name: string; parentId?: string | null; order?: number }[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        list.push({ 
          id: doc.id, 
          name: data.name,
          parentId: data.parentId || null,
          order: data.order !== undefined ? data.order : 0
        });
      });
      
      if (list.length === 0) {
        const defaults = ["High Priority", "Warm Leads", "Follow Up Required", "Technical Support"];
        const batch = writeBatch(db);
        defaults.forEach((name, index) => {
          const newDocRef = doc(collection(db, "labels"));
          batch.set(newDocRef, {
            name,
            parentId: null,
            order: index
          });
        });
        batch.commit();
      } else {
        // Sort by order
        list.sort((a, b) => (a.order || 0) - (b.order || 0));
        setCustomLabels(list);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleCreateNewLabel = async () => {
    const name = prompt("Enter new label name:");
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    if (customLabels.some(l => l.name.toLowerCase() === cleanName.toLowerCase() && !l.parentId)) {
      alert("Label already exists at the root level!");
      return;
    }
    
    // Find root siblings to determine order
    const siblings = customLabels.filter(l => !l.parentId);
    const maxOrder = siblings.reduce((max, s) => Math.max(max, s.order || 0), 0);

    await addDoc(collection(db, "labels"), {
      name: cleanName,
      parentId: null,
      order: maxOrder + 1
    });
  };

  const handleCreateSublabel = async (parentId: string, parentName: string) => {
    const name = prompt(`Enter sublabel name for "${parentName}":`);
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    if (customLabels.some(l => l.name.toLowerCase() === cleanName.toLowerCase() && l.parentId === parentId)) {
      alert("Sublabel already exists under this parent!");
      return;
    }
    
    const siblings = customLabels.filter(l => l.parentId === parentId);
    const maxOrder = siblings.reduce((max, s) => Math.max(max, s.order || 0), 0);

    await addDoc(collection(db, "labels"), {
      name: cleanName,
      parentId,
      order: maxOrder + 1
    });
  };

  const handleDeleteLabelAndDescendants = async (labelId: string, labelName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete the label "${labelName}" and all of its sublabels?`)) return;
    
    // Find all descendants recursively
    const getDescendantIds = (id: string): string[] => {
      const children = customLabels.filter(l => l.parentId === id);
      return [
        id,
        ...children.flatMap(c => getDescendantIds(c.id))
      ];
    };

    const idsToDelete = getDescendantIds(labelId);
    
    try {
      for (const id of idsToDelete) {
        await deleteDoc(doc(db, "labels", id));
      }
      setActiveMenuFilter("all");
    } catch (err) {
      console.error("Error deleting labels:", err);
    }
  };

  const handleLabelDrop = async (draggedId: string, targetId: string | null) => {
    if (draggedId === targetId) return;

    // Find dragged label
    const dragged = customLabels.find(l => l.id === draggedId);
    if (!dragged) return;

    if (targetId === null) {
      // Move to root level
      const rootSiblings = customLabels.filter(l => !l.parentId);
      const maxOrder = rootSiblings.reduce((max, s) => Math.max(max, s.order || 0), 0);
      const labelRef = doc(db, "labels", draggedId);
      await updateDoc(labelRef, {
        parentId: null,
        order: maxOrder + 1
      });
      return;
    }

    const target = customLabels.find(l => l.id === targetId);
    if (!target) return;

    // Check if dropping on a sibling (same parent) -> Reorder!
    if (dragged.parentId === target.parentId) {
      const labelRef = doc(db, "labels", draggedId);
      const targetRef = doc(db, "labels", targetId);
      // Swap their orders:
      const tempOrder = dragged.order || 0;
      await updateDoc(labelRef, { order: target.order || 0 });
      await updateDoc(targetRef, { order: tempOrder });
      return;
    }

    // Different parent -> Nest dragged under target!
    // Validate depth: dragged label and its subtree cannot exceed 3 levels total
    const getSubtreeDepth = (id: string): number => {
      const children = customLabels.filter(l => l.parentId === id);
      if (children.length === 0) return 1;
      return 1 + Math.max(...children.map(c => getSubtreeDepth(c.id)));
    };

    const getParentDepth = (parentId: string | null): number => {
      if (!parentId) return 0;
      const parent = customLabels.find(l => l.id === parentId);
      if (!parent) return 0;
      return 1 + getParentDepth(parent.parentId || null);
    };

    const draggedSubtreeDepth = getSubtreeDepth(draggedId);
    const targetParentDepth = getParentDepth(targetId);

    if (targetParentDepth + draggedSubtreeDepth > 3) {
      alert("Maximum nesting depth of 3 levels exceeded.");
      return;
    }

    const labelRef = doc(db, "labels", draggedId);
    const siblings = customLabels.filter(l => l.parentId === targetId);
    const maxOrder = siblings.reduce((max, s) => Math.max(max, s.order || 0), 0);
    await updateDoc(labelRef, {
      parentId: targetId,
      order: maxOrder + 1
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
                      const isAdmin = userData.ADMIN === true;
                      setCurrentUser({ id: userData.ID, name: fullName, isAdmin });
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
                              timeZone: timeZone,
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

  // Access control check for automations tab
  useEffect(() => {
    const accessDocRef = doc(db, "settings", "automations_access");
    const unsub = onSnapshot(accessDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setAllowedStaffIds(docSnap.data().allowedUserIds || []);
      } else {
        // Seed default access config (User ID "1" is standard, and all portal administrators)
        setDoc(accessDocRef, {
          allowedUserIds: ["1"],
          allowAllAdmins: true
        });
      }
    });
    return () => unsub();
  }, []);

  // Load and subscribe to company profile settings
  useEffect(() => {
    const profileDocRef = doc(db, "settings", "company_profile");
    const unsub = onSnapshot(profileDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setCompanyName(data.companyName || "RS Choyal");
        setLogoUrl(data.logoUrl || "/rschoyal-logo.svg");
        setTimeZone(data.timeZone || "Asia/Kolkata");
        setHideCompanyName(!!data.hideCompanyName);
        setLogoHeight(typeof data.logoHeight === "number" ? data.logoHeight : 30);
      } else {
        // Seed default profile settings
        setDoc(profileDocRef, {
          companyName: "RS Choyal",
          logoUrl: "/rschoyal-logo.svg",
          timeZone: "Asia/Kolkata",
          hideCompanyName: false,
          logoHeight: 30,
        });
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    async function loadAIConfig() {
      try {
        const snap = await getDoc(doc(db, "settings", "ai_config"));
        if (snap.exists()) {
          const data = snap.data();
          setAiEnabled(data.enabled === true);
          setAiRestrictedNumbers(Array.isArray(data.restrictedNumbers) ? data.restrictedNumbers.join("\n") : "");
          setAiSystemInstruction(data.systemInstruction || "You are a helpful customer support assistant for RS Choyal Group.");
          setAiApiKey(data.apiKey || "");
        }
      } catch (err) {
        console.error("Failed to load AI Config:", err);
      }
    }
    loadAIConfig();
  }, []);

  const handleSaveAIConfig = async () => {
    setAiSaveLoading(true);
    const numbersArray = aiRestrictedNumbers
      .split("\n")
      .map(num => num.trim())
      .filter(num => num.length > 0);

    try {
      await setDoc(doc(db, "settings", "ai_config"), {
        enabled: aiEnabled,
        restrictedNumbers: numbersArray,
        systemInstruction: aiSystemInstruction,
        apiKey: aiApiKey,
        updatedAt: serverTimestamp(),
      });
      alert("AI Configuration saved successfully!");
    } catch (err) {
      console.error("Failed to save AI Config:", err);
      alert("Error saving AI Configuration: " + (err as Error).message);
    } finally {
      setAiSaveLoading(false);
    }
  };

  const handleSaveSettings = async (name: string, logo: string, tz: string, hideName: boolean, logoHeightVal: number) => {
    setSettingsLoading(true);
    try {
      const profileDocRef = doc(db, "settings", "company_profile");
      await setDoc(profileDocRef, {
        companyName: name,
        logoUrl: logo,
        timeZone: tz,
        hideCompanyName: hideName,
        logoHeight: logoHeightVal,
      });
      alert("Settings saved successfully!");
    } catch (e: any) {
      alert("Error saving settings: " + e.message);
    } finally {
      setSettingsLoading(false);
    }
  };

  const isAutomationAllowed = useMemo(() => {
    if (!currentUser) return false;
    if (currentUser.id === "5336") return true; // Superadmin bypass
    if (currentUser.isAdmin) return true; // Portal administrators always allowed
    return allowedStaffIds.includes(currentUser.id);
  }, [currentUser, allowedStaffIds]);

  const renderAccessRestricted = () => (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flex: 1, background: '#090d16', color: '#f8fafc', padding: '24px', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <div style={{ background: '#1e293b70', border: '1px solid #334155', borderRadius: '16px', padding: '40px', maxWidth: '440px', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '20px', display: 'inline-block' }}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '12px' }}>Workflow Editor Restricted</h2>
        <p style={{ fontSize: '14px', color: '#94a3b8', lineHeight: 1.6, marginBottom: '24px' }}>
          Access to edit automations and view campaign runs is restricted to managers and administrators.
        </p>
        <div style={{ fontSize: '12px', color: '#64748b', borderTop: '1px solid #334155', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div>Current User: <strong>{currentUser?.name || "Staff Member"}</strong></div>
          <div>User ID: <code>{currentUser?.id}</code> • Role: {currentUser?.id === "5336" ? "Superadmin" : currentUser?.isAdmin ? "Admin" : "Staff"}</div>
        </div>
      </div>
    </div>
  );

  // 1. Real-time Firestore listener for contacts list
  useEffect(() => {
    const contactsRef = collection(db, "contacts");
    const unsubscribe = onSnapshot(contactsRef, (snapshot) => {
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
    }, (error) => {
      console.error("Contacts onSnapshot error:", error);
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
          deliveredAt: data.deliveredAt || "",
          readAt: data.readAt || "",
          linkOpenedAt: data.linkOpenedAt || null,
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

  const activeContact = sortedContacts.find((c) => c.id === activeChatId) || (activeChatId ? {
    id: activeChatId,
    name: activeChatId,
    preview: "No messages yet",
    time: "",
    statusText: "WhatsApp • Online",
    avatar: undefined,
    responsibleId: undefined,
    statusSelect: undefined,
    label: undefined
  } as unknown as Contact : (sortedContacts[0] || INITIAL_CONTACTS[0]));
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

  const createShortLink = async (longUrl: string): Promise<string> => {
    const handle = Math.random().toString(36).substring(2, 8);
    const docRef = doc(db, "short_links", handle);
    await setDoc(docRef, {
      originalUrl: longUrl,
      createdAt: serverTimestamp(),
    });
    return `${window.location.origin}/link/${handle}`;
  };

  const handleCustomLinkAlias = async (varName: string, currentLink: string) => {
    const urlParts = currentLink.split("/link/");
    if (urlParts.length < 2) return;
    const origin = urlParts[0];
    const currentHandle = urlParts[1];
    
    const customAlias = prompt("Enter a custom link alias (alphanumeric, e.g. choyal-quote):", currentHandle);
    if (!customAlias) return;
    
    const cleanAlias = customAlias.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!cleanAlias) {
      alert("Invalid alias. Only lowercase letters, numbers, dashes, and underscores are allowed.");
      return;
    }
    
    if (cleanAlias === currentHandle) return;
    
    try {
      const docRef = doc(db, "short_links", cleanAlias);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        alert("This alias is already in use. Please try another one.");
        return;
      }
      
      const currentRef = doc(db, "short_links", currentHandle);
      const currentSnap = await getDoc(currentRef);
      if (!currentSnap.exists()) {
        alert("Error: Original link reference not found.");
        return;
      }
      
      const originalUrl = currentSnap.data().originalUrl;
      
      await setDoc(docRef, {
        originalUrl,
        createdAt: serverTimestamp(),
        isCustom: true
      });
      
      const newLink = `${origin}/link/${cleanAlias}`;
      setPromptedVariables(prev => ({
        ...prev,
        [varName]: newLink
      }));
    } catch (err: any) {
      alert("Failed to customize alias: " + err.message);
    }
  };

  const uploadFileForVariable = async (file: File): Promise<string> => {
    setModalUploading(true);
    setModalUploadProgress(0);

    const useLocalUpload = process.env.NEXT_PUBLIC_USE_LOCAL_UPLOAD === "true";

    return new Promise((resolve, reject) => {
      if (useLocalUpload) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("contactId", activeChatId);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/chat/upload", true);
        
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100;
            setModalUploadProgress(Math.round(progress));
          }
        };

        xhr.onload = async () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const result = JSON.parse(xhr.responseText);
              if (result.success) {
                const shortUrl = await createShortLink(result.url);
                resolve(shortUrl);
              } else {
                reject(new Error(result.error || "Local upload failed"));
              }
            } catch (err: any) {
              reject(new Error("Failed to parse local upload response: " + err.message));
            } finally {
              setModalUploading(false);
              setModalUploadProgress(0);
            }
          } else {
            setModalUploading(false);
            setModalUploadProgress(0);
            reject(new Error(`Local upload failed with status code: ${xhr.status}`));
          }
        };

        xhr.onerror = () => {
          setModalUploading(false);
          setModalUploadProgress(0);
          reject(new Error("Network error occurred during local upload"));
        };

        xhr.send(formData);
      } else {
        try {
          const cleanName = getCleanFileName(file.name);
          const storageRef = ref(storage, `attachments_${activeChatId}_${Date.now()}_${cleanName}`);
          
          const metadata = {
            contentDisposition: `inline; filename="${cleanName}"`,
            contentType: file.type
          };

          const uploadTask = uploadBytesResumable(storageRef, file, metadata);
          
          uploadTask.on('state_changed', 
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setModalUploadProgress(Math.round(progress));
            }, 
            (error) => {
              console.error("Upload failed:", error);
              setModalUploading(false);
              setModalUploadProgress(0);
              reject(error);
            }, 
            async () => {
              try {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                const shortUrl = await createShortLink(downloadURL);
                resolve(shortUrl);
              } catch (err: any) {
                reject(err);
              } finally {
                setModalUploading(false);
                setModalUploadProgress(0);
              }
            }
          );
        } catch (err: any) {
          setModalUploading(false);
          setModalUploadProgress(0);
          reject(err);
        }
      }
    });
  };

  const executeSendTemplate = async (
    template: { name: string; text: string; templateSid: string }, 
    variables: Record<string, string>
  ) => {
    setIsSendingTemplate(true);
    const contentVariables: Record<string, string> = {};
    let textWithVars = template.text;
    let mediaUrlToSend: string | undefined;
    let mediaTypeToSend: string | undefined;

    if (template.templateSid === "HX0f7cde84a9b825505fc6a3a608c2a3be" && !variables["1"]) {
      const brochureUrl = "https://cdn.clyrix.com/drive/rscg_company_profile.pdf";
      contentVariables["1"] = brochureUrl;
      textWithVars = textWithVars.replace(/\{\{[^}]+\}\}/g, brochureUrl);
      mediaUrlToSend = brochureUrl;
      mediaTypeToSend = "application/pdf";
    } else {
      Object.entries(variables).forEach(([key, val]) => {
        contentVariables[key] = val;
        const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, 'g');
        textWithVars = textWithVars.replace(regex, val);

        const isMedia = key.toLowerCase().includes("pdf") || key.toLowerCase().includes("url") || key.toLowerCase().includes("link") || key.toLowerCase().includes("file") || key === "1";
        if (isMedia && val && val.startsWith("http")) {
          mediaUrlToSend = val;
          mediaTypeToSend = val.toLowerCase().includes(".pdf") ? "application/pdf" : "image";
        }
      });
    }

    try {
      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: activeChatId,
          text: textWithVars,
          useTemplate: true,
          templateSid: template.templateSid,
          contentVariables,
          senderName: currentUser ? currentUser.name : "Staff",
          mediaUrl: mediaUrlToSend,
          mediaType: mediaTypeToSend,
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

  const handleConfirmVariables = async () => {
    if (!promptTemplate) return;
    setShowVariablePrompt(false);

    // If we updated the customer name and the current contact name is a phone number (or empty), update it
    const activeContact = sortedContacts.find((c) => c.id === activeChatId) || contacts.find((c) => c.id === activeChatId);
    const hasName = activeContact && !/^\+?\d+$/.test(activeContact.name.replace(/\s+/g, ""));
    const enteredName = promptedVariables["Client Name"] || promptedVariables["1"] || "";
    if (enteredName.trim() && !hasName) {
      const finalName = enteredName.trim();
      try {
        const contactRef = doc(db, "contacts", activeChatId);
        await updateDoc(contactRef, { name: finalName });
        setContacts((prevContacts) =>
          prevContacts.map((c) => (c.id === activeChatId ? { ...c, name: finalName } : c))
        );
      } catch (e) {
        console.error("Failed to update contact name in Firestore:", e);
      }
    }

    await executeSendTemplate(promptTemplate, promptedVariables);
    setPromptTemplate(null);
    setPromptedVariables({});
  };

  const handleSendTemplate = async (template: { id?: string; name: string; text: string; templateSid: string; brochureLink?: string; buttons?: string[] }) => {
    setShowTemplateDropdown(false);

    // Find active contact's name
    const activeContact = sortedContacts.find((c) => c.id === activeChatId) || contacts.find((c) => c.id === activeChatId);
    let clientName = "";
    if (activeContact) {
      const isPhone = /^\+?\d+$/.test(activeContact.name.replace(/\s+/g, ""));
      clientName = isPhone ? "" : activeContact.name;
    }

    const vars = getTemplateVariables(template.text);
    const isBrochure = template.templateSid === "HX0f7cde84a9b825505fc6a3a608c2a3be";

    // Case 1: No variables or brochure template (auto-filled)
    if (vars.length === 0 || isBrochure) {
      const variablesMap: Record<string, string> = {};
      if (isBrochure) {
        const brochureUrl = template.brochureLink || "https://cdn.clyrix.com/drive/rscg_company_profile.pdf";
        variablesMap["1"] = brochureUrl;
      }
      await executeSendTemplate(template, variablesMap);
      return;
    }

    // Case 2: Only 1 variable and it is clientName, and we have it prefilled
    if (vars.length === 1 && (vars[0] === "1" || vars[0] === "Client Name") && clientName) {
      await executeSendTemplate(template, { [vars[0]]: clientName });
      return;
    }

    // Case 3: Need user input (either multiple variables or nameless simple template)
    const initialVars: Record<string, string> = {};
    vars.forEach(v => {
      if (v === "1" || v === "Client Name") {
        initialVars[v] = clientName;
      } else {
        initialVars[v] = "";
      }
    });

    setPromptTemplate(template);
    setPromptedVariables(initialVars);
    setShowVariablePrompt(true);
  };

  const getMediaUrl = (url?: string) => {
    if (!url) return "";
    if (url.includes("api.twilio.com")) {
      return `/api/chat/media-proxy?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  const openLightbox = (url: string) => {
    setZoomScale(1);
    setActiveLightboxImage(url);
  };

  const formatTimeIST = (msg: Message) => {
    if (msg.timestamp) {
      try {
        const date = msg.timestamp.toDate 
          ? msg.timestamp.toDate() 
          : new Date(msg.timestamp.seconds * 1000);
        
        if (!isNaN(date.getTime())) {
          return date.toLocaleTimeString("en-IN", {
            timeZone: timeZone,
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

  const formatLinkOpenedTime = (openedAt: any) => {
    if (openedAt) {
      try {
        const date = openedAt.toDate 
          ? openedAt.toDate() 
          : new Date(openedAt.seconds * 1000);
        
        if (!isNaN(date.getTime())) {
          return date.toLocaleString("en-IN", {
            timeZone: timeZone,
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
          });
        }
      } catch (e) {
        // Ignore
      }
    }
    return "";
  };

  const formatContactTimeIST = (contact: Contact & { lastUpdated?: any }) => {
    if (contact.lastUpdated) {
      try {
        const date = contact.lastUpdated.toDate 
          ? contact.lastUpdated.toDate() 
          : new Date(contact.lastUpdated.seconds * 1000);
        
        if (!isNaN(date.getTime())) {
          return date.toLocaleTimeString("en-IN", {
            timeZone: timeZone,
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

  const handleUploadFile = async (fileToSend: File) => {
    setSelectedFile(fileToSend);
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

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
                let mediaType: "document" | "image" | "video" | "audio" = "document";
                if (fileToSend.type.startsWith("image/")) mediaType = "image";
                else if (fileToSend.type.startsWith("video/")) mediaType = "video";
                
                setStagedMediaUrl(downloadURL);
                setStagedMediaType(mediaType);
                setStagedFileName(fileToSend.name);
              } else {
                setUploadError(result.error || "Local upload failed");
                setSelectedFile(null);
              }
            } catch (err: any) {
              setUploadError("Failed to parse local upload response: " + err.message);
              setSelectedFile(null);
            }
          } else {
            setUploadError(`Local upload failed with status code: ${xhr.status}`);
            setSelectedFile(null);
          }
          setUploading(false);
          setUploadProgress(0);
        };

        xhr.onerror = () => {
          setUploadError("Network error occurred during local upload");
          setSelectedFile(null);
          setUploading(false);
          setUploadProgress(0);
        };

        xhr.send(formData);
      } catch (err: any) {
        console.error("Error in local upload flow:", err);
        setUploadError(err.message || "Failed to initiate local upload");
        setSelectedFile(null);
        setUploading(false);
        setUploadProgress(0);
      }
    } else {
      // Firebase Cloud Storage upload flow
      try {
        const cleanName = getCleanFileName(fileToSend.name);
        const storageRef = ref(storage, `attachments_${activeChatId}_${Date.now()}_${cleanName}`);
        
        const metadata = {
          contentDisposition: `inline; filename="${cleanName}"`,
          contentType: fileToSend.type
        };

        const uploadTask = uploadBytesResumable(storageRef, fileToSend, metadata);
        
        uploadTask.on('state_changed', 
          (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            setUploadProgress(Math.round(progress));
          }, 
          (error) => {
            console.error("Upload failed:", error);
            setUploadError(error.message || "Upload failed. Storage rules may be blocking access.");
            setSelectedFile(null);
            setUploading(false);
            setUploadProgress(0);
          }, 
          async () => {
            try {
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              let mediaType: "document" | "image" | "video" | "audio" = "document";
              if (fileToSend.type.startsWith("image/")) mediaType = "image";
              else if (fileToSend.type.startsWith("video/")) mediaType = "video";
              
              setStagedMediaUrl(downloadURL);
              setStagedMediaType(mediaType);
              setStagedFileName(fileToSend.name);
            } catch (err: any) {
              console.error("Error getting download URL:", err);
              setUploadError(err.message || "Failed to get download URL");
              setSelectedFile(null);
            } finally {
              setUploading(false);
              setUploadProgress(0);
            }
          }
        );
      } catch (err: any) {
        console.error("Error in upload flow:", err);
        setUploadError(err.message || "Failed to initiate upload");
        setSelectedFile(null);
        setUploading(false);
        setUploadProgress(0);
      }
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() && !stagedMediaUrl) return;

    const messageText = inputText;
    const mediaUrlToSend = stagedMediaUrl;
    const mediaTypeToSend = stagedMediaType;

    // Reset input fields immediately to prevent double sending
    setInputText("");
    setSelectedFile(null);
    setStagedMediaUrl(null);
    setStagedMediaType(null);
    setStagedFileName(null);
    setUploadError(null);
    setUploadProgress(0);

    if (mediaUrlToSend) {
      try {
        const response = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId: activeChatId,
            text: messageText,
            mediaUrl: mediaUrlToSend,
            mediaType: mediaTypeToSend,
            senderName: currentUser ? currentUser.name : "Staff",
          }),
        });
        const result = await response.json();
        if (!result.success) {
          setUploadError(result.error || "Failed to send message via Twilio API");
        }
      } catch (err: any) {
        console.error("Error calling send message API:", err);
        setUploadError(err.message || "Failed to send message via Twilio API");
      }
    } else {
      // Text-only message flow
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
  // Dynamic counts calculation
  const allCount = sortedContacts.filter(c => !c.isMarketing).length;
  const unprocessedCount = sortedContacts.filter(c => !c.isMarketing && (!c.labels || c.labels.length === 0)).length;
  const myCount = sortedContacts.filter(c => !c.isMarketing && currentUser && c.responsibleId === currentUser.id).length;
  const favoritesCount = sortedContacts.filter(c => !c.isMarketing && c.isFavorite).length;
  const channelsGroupsCount = sortedContacts.filter(c => !c.isMarketing && c.id.includes("group")).length || 2;
  const marketingCount = sortedContacts.filter(c => c.isMarketing === true).length;

  const getLabelContactCount = (lblId: string, lblName: string) => {
    const nameLower = lblName.toLowerCase();
    return sortedContacts.filter(c => 
      !c.isMarketing && (
        (c.labels && c.labels.includes(lblId)) || 
        (c.label === nameLower)
      )
    ).length;
  };

  const getLabelsByParentId = (parentId: string | null) => {
    return customLabels
      .filter(l => l.parentId === parentId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  };

  const getLabelLevel = (lbl: { id: string; name: string; parentId?: string | null; order?: number }): number => {
    if (!lbl.parentId) return 1;
    const parent = customLabels.find(l => l.id === lbl.parentId);
    if (!parent) return 1;
    if (!parent.parentId) return 2;
    return 3;
  };

  const renderLabelTree = (parentId: string | null, depth: number = 0) => {
    const list = getLabelsByParentId(parentId);
    return list.map((lbl) => {
      const labelKey = `label:${lbl.name.toLowerCase()}`;
      const count = getLabelContactCount(lbl.id, lbl.name);
      const isSelected = activeMenuFilter === labelKey;
      
      return (
        <div key={lbl.id} style={{ display: 'flex', flexDirection: 'column' }}>
          <li 
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", lbl.id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const draggedId = e.dataTransfer.getData("text/plain");
              await handleLabelDrop(draggedId, lbl.id);
            }}
            onClick={() => setActiveMenuFilter(labelKey)}
            className={`${styles.crmMenuItem} ${isSelected ? styles.crmMenuItemActive : ""}`}
            style={{ 
              paddingLeft: `${16 + depth * 16}px`,
              borderLeft: isSelected ? '3px solid #2563eb' : 'none',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'grab'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ 
                width: '6px', 
                height: '6px', 
                borderRadius: '50%', 
                backgroundColor: depth === 0 ? '#3b82f6' : depth === 1 ? '#a855f7' : '#ec4899' 
              }}></span>
              <span style={{ fontSize: '13px' }}>{lbl.name}</span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
              <span className={styles.badge}>{count}</span>
              
              {/* Add child button if depth < 2 (levels 1 and 2) */}
              {depth < 2 && (
                <button 
                  onClick={() => handleCreateSublabel(lbl.id, lbl.name)}
                  style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', padding: '2px' }}
                  title="Add Sublabel"
                >
                  +
                </button>
              )}

              {/* Delete button */}
              <button 
                onClick={(e) => handleDeleteLabelAndDescendants(lbl.id, lbl.name, e)}
                className={styles.deleteLabelButton}
                title="Delete Label"
              >
                ×
              </button>
            </div>
          </li>
          {renderLabelTree(lbl.id, depth + 1)}
        </div>
      );
    });
  };

  const filteredContacts = sortedContacts.filter((c) => {
    const matchesSearch = 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.preview.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase());
      
    if (!matchesSearch) return false;

    if (activeMenuFilter === "marketing") {
      return c.isMarketing === true;
    }

    if (c.isMarketing === true) {
      return false;
    }

    if (activeMenuFilter === "unprocessed") {
      return !c.labels || c.labels.length === 0;
    }
    if (activeMenuFilter === "my") {
      return currentUser ? c.responsibleId === currentUser.id : false;
    }
    if (activeMenuFilter === "favorites") {
      return c.isFavorite === true;
    }
    if (activeMenuFilter === "channels_groups") {
      return false;
    }
    
    // Check if filtering by custom labels
    if (activeMenuFilter.startsWith("label:")) {
      const labelName = activeMenuFilter.replace("label:", "");
      const matchingLabel = customLabels.find(l => l.name.toLowerCase() === labelName);
      if (matchingLabel) {
        // Find descendants recursively
        const getDescendantIds = (id: string): string[] => {
          const children = customLabels.filter(l => l.parentId === id);
          return [id, ...children.flatMap(c => getDescendantIds(c.id))];
        };
        const allowedIds = getDescendantIds(matchingLabel.id);
        return (
          (c.labels && c.labels.some(id => allowedIds.includes(id))) || 
          (c.label === labelName)
        );
      }
      return c.label === labelName;
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

  const renderSettingsView = () => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: '#090d16', color: '#f8fafc', padding: '32px', fontFamily: 'sans-serif', overflowY: 'auto' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div style={{ borderBottom: '1px solid #1e293b', paddingBottom: '16px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#f8fafc', margin: 0 }}>⚙️ System Settings</h2>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>
              Configure your company profile, branding assets, and scheduling time zone.
            </p>
          </div>

          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Company Name */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#cbd5e1' }}>Company Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                style={{
                  width: '100%',
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  color: '#f8fafc',
                  fontSize: '14px',
                  outline: 'none',
                }}
                placeholder="e.g. RS Choyal Group"
              />
            </div>

            {/* Logo URL */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#cbd5e1' }}>Company Logo URL</label>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <input
                  type="text"
                  value={editLogo}
                  onChange={(e) => setEditLogo(e.target.value)}
                  style={{
                    flex: 1,
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    color: '#f8fafc',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                  placeholder="e.g. /rschoyal-logo.svg or https://domain.com/logo.png"
                />
                <div style={{ 
                  width: '50px', 
                  height: '40px', 
                  background: '#1e293b', 
                  borderRadius: '6px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  border: '1px solid #334155',
                  padding: '4px',
                  overflow: 'hidden'
                }}>
                  {editLogo ? (
                    <img src={editLogo} alt="Preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }} />
                  ) : (
                    <span style={{ fontSize: '10px', color: '#64748b' }}>None</span>
                  )}
                </div>
              </div>
            </div>

            {/* Time Zone */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#cbd5e1' }}>Default Time Zone</label>
              <select
                value={editTZ}
                onChange={(e) => setEditTZ(e.target.value)}
                style={{
                  width: '100%',
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  color: '#f8fafc',
                  fontSize: '14px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST - UTC+5:30)</option>
                <option value="UTC">Coordinated Universal Time (UTC)</option>
                <option value="America/New_York">America/New_York (EST/EDT)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
              </select>
              <p style={{ fontSize: '11px', color: '#64748b', margin: 0 }}>
                Used to determine delivery timestamps for outbound chat notifications and automation steps.
              </p>
            </div>

            {/* Hide Company Name Option */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                id="hideCompanyName"
                checked={editHideCompanyName}
                onChange={(e) => setEditHideCompanyName(e.target.checked)}
                style={{
                  width: '18px',
                  height: '18px',
                  accentColor: '#10b981',
                  cursor: 'pointer'
                }}
              />
              <label htmlFor="hideCompanyName" style={{ fontSize: '13px', fontWeight: 600, color: '#cbd5e1', cursor: 'pointer' }}>
                Hide company name text in sidebar header
              </label>
            </div>

            {/* Logo Height Option */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#cbd5e1' }}>Logo Height (px)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="number"
                  min="16"
                  max="120"
                  value={editLogoHeight}
                  onChange={(e) => setEditLogoHeight(parseInt(e.target.value) || 30)}
                  style={{
                    width: '100px',
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    color: '#f8fafc',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                />
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Adjust logo vertical height. Default is 30px.
                </span>
              </div>
            </div>

            {/* Save Button */}
            <button
              onClick={() => handleSaveSettings(editName, editLogo, editTZ, editHideCompanyName, editLogoHeight)}
              disabled={settingsLoading}
              style={{
                width: '100%',
                background: '#10b981',
                color: 'white',
                border: 'none',
                padding: '12px',
                borderRadius: '8px',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '14px',
                marginTop: '8px',
                transition: 'opacity 0.2s',
                opacity: settingsLoading ? 0.7 : 1,
              }}
            >
              {settingsLoading ? "Saving Profile..." : "Save Configuration"}
            </button>
          </div>

          {/* CRM Placement Admin Tools Section */}
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#f8fafc', margin: 0 }}>CRM Placement Administrator Tools</h3>
            <p style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5, margin: 0 }}>
              If you have added new layouts or tabs inside your Bitrix24 portal, re-run the layout binding mapping sequence to refresh placements.
            </p>
            <button
              onClick={registerPlacements}
              style={{
                background: '#334155',
                color: '#cbd5e1',
                border: 'none',
                padding: '10px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                alignSelf: 'flex-start',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#475569')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#334155')}
            >
              🔄 Re-register CRM Placements
            </button>
          </div>

        </div>
      </div>
    );
  };

  const renderAIConfigView = () => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: '#090d16', color: '#f8fafc', padding: '32px', fontFamily: 'sans-serif', overflowY: 'auto' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div style={{ borderBottom: '1px solid #1e293b', paddingBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #ec4899 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 0 20px rgba(139, 92, 246, 0.4)'
            }}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M12 2C12 2 12 8 18 12C12 12 12 18 12 22C12 22 12 16 6 12C12 12 12 2 12 2Z"></path>
              </svg>
            </div>
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#f8fafc', margin: 0 }}>Gemini AI Chatbot</h2>
              <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
                Enable and configure generative AI responses powered by Google Gemini.
              </p>
            </div>
          </div>

          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Enable Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b', paddingBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '14px', fontWeight: 600, color: '#cbd5e1' }}>Enable AI Chatbot</label>
                <p style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', margin: 0 }}>
                  Automatically respond to incoming customer messages when active.
                </p>
              </div>
              <button
                onClick={() => setAiEnabled(!aiEnabled)}
                style={{
                  width: '50px',
                  height: '26px',
                  borderRadius: '13px',
                  background: aiEnabled ? '#10b981' : '#334155',
                  position: 'relative',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                  padding: 0,
                }}
              >
                <div style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: '3px',
                  left: aiEnabled ? '27px' : '3px',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                }} />
              </button>
            </div>

            {/* Restricted Phone Numbers */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#cbd5e1' }}>Restricted Phone Numbers</label>
                <span style={{ fontSize: '11px', color: '#64748b' }}>One number per line</span>
              </div>
              <textarea
                value={aiRestrictedNumbers}
                onChange={(e) => setAiRestrictedNumbers(e.target.value)}
                placeholder="e.g.&#10;+916205006621&#10;+918890211444"
                rows={4}
                style={{
                  width: '100%',
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: '#f8fafc',
                  fontSize: '13px',
                  outline: 'none',
                  fontFamily: 'monospace',
                  resize: 'vertical',
                }}
              />
              <p style={{ fontSize: '11px', color: '#64748b', margin: 0 }}>
                The AI chatbot will ONLY respond to messages received from these specific phone numbers.
              </p>
            </div>

            {/* System Instruction / Persona */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#cbd5e1' }}>System Instruction / AI Persona</label>
              <textarea
                value={aiSystemInstruction}
                onChange={(e) => setAiSystemInstruction(e.target.value)}
                placeholder="Describe how the AI should behave, e.g., 'You are a helpful customer support assistant...'"
                rows={5}
                style={{
                  width: '100%',
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: '#f8fafc',
                  fontSize: '13px',
                  outline: 'none',
                  lineHeight: '1.5',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* API Key Override */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#cbd5e1' }}>Gemini API Key (Optional)</label>
              <input
                type="password"
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                placeholder="Leave blank to use system default credential"
                style={{
                  width: '100%',
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: '#f8fafc',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
              <p style={{ fontSize: '11px', color: '#64748b', margin: 0 }}>
                Overrides the default project API key if provided. Credentials are encrypted and stored securely.
              </p>
            </div>

            {/* Save Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button
                onClick={handleSaveAIConfig}
                disabled={aiSaveLoading}
                style={{
                  background: '#4f46e5',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: aiSaveLoading ? 0.7 : 1,
                  transition: 'background 0.2s',
                  boxShadow: '0 4px 6px -1px rgba(79, 70, 229, 0.2)',
                }}
                onMouseEnter={(e) => {
                  if (!aiSaveLoading) e.currentTarget.style.background = '#4338ca';
                }}
                onMouseLeave={(e) => {
                  if (!aiSaveLoading) e.currentTarget.style.background = '#4f46e5';
                }}
              >
                {aiSaveLoading ? 'Saving Configuration...' : 'Save AI Settings'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

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
          {/* Chat View Tab */}
          <button 
            className={`${styles.activityButton} ${activeView === "chat" ? styles.activityButtonActive : ""}`} 
            onClick={() => {
              setActiveView("chat");
              setIsSidebarOpen(true);
            }}
            title="Chat & CRM"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </button>

          {/* Automations Tab */}
          <button 
            className={`${styles.activityButton} ${activeView === "automations" ? styles.activityButtonActive : ""}`} 
            onClick={() => {
              setActiveView("automations");
            }}
            title="Workflows & Automations"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15"></line>
              <circle cx="18" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <path d="M18 9a9 9 0 0 1-9 9"></path>
            </svg>
          </button>

          {/* Campaigns Tab */}
          <button 
            className={`${styles.activityButton} ${activeView === "campaigns" ? styles.activityButtonActive : ""}`} 
            onClick={() => {
              setActiveView("campaigns");
            }}
            title="Marketing Campaigns"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
            </svg>
          </button>

          {/* AI Tab */}
          <button 
            className={`${styles.activityButton} ${activeView === "ai" ? styles.activityButtonActive : ""}`} 
            onClick={() => {
              setActiveView("ai");
            }}
            title="Gemini AI Chatbot"
            style={{
              color: activeView === "ai" ? "#4f46e5" : "inherit"
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M12 2C12 2 12 8 18 12C12 12 12 18 12 22C12 22 12 16 6 12C12 12 12 2 12 2Z"></path>
            </svg>
          </button>
        </div>

        <div className={styles.activityBarBottom}>
          <button 
            onClick={() => setActiveView("settings")} 
            className={`${styles.activityButton} ${activeView === "settings" ? styles.activityButtonActive : ""}`}
            title="System Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        </div>
      </div>

      {activeView === "chat" ? (
        <>
          {/* 1. CRM Sidebar */}
          {isSidebarOpen && (
        <div className={styles.crmSidebar}>
          {/* Top Logo Header */}
          <div className={styles.crmHeader} style={{ display: 'flex', alignItems: 'center', width: '100%', borderBottom: '1px solid #f1f5f9', paddingBottom: '16px', gap: '8px' }}>
            {logoUrl && (
              <img 
                src={logoUrl} 
                alt={companyName} 
                style={{ height: `${logoHeight}px`, width: "auto", display: "block", maxHeight: `${logoHeight}px`, objectFit: "contain" }} 
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            )}
            {!hideCompanyName && (
              <span style={{ fontSize: "14px", fontWeight: "bold", color: "#1e293b" }}>{companyName}</span>
            )}
          </div>

          {/* System Filters */}
          <ul className={styles.crmMenu} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
            <li 
              onClick={() => setActiveMenuFilter("all")}
              className={`${styles.crmMenuItem} ${activeMenuFilter === "all" ? styles.crmMenuItemActive : ""}`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                All
              </span>
              <span className={styles.badge}>{allCount}</span>
            </li>
            
            <li 
              onClick={() => setActiveMenuFilter("unprocessed")}
              className={`${styles.crmMenuItem} ${activeMenuFilter === "unprocessed" ? styles.crmMenuItemActive : ""}`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                </svg>
                Unprocessed
              </span>
              <span className={styles.badge}>{unprocessedCount}</span>
            </li>

            <li 
              onClick={() => setActiveMenuFilter("my")}
              className={`${styles.crmMenuItem} ${activeMenuFilter === "my" ? styles.crmMenuItemActive : ""}`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                Assigned to me
              </span>
              <span className={styles.badge}>{myCount}</span>
            </li>

            <li 
              onClick={() => setActiveMenuFilter("favorites")}
              className={`${styles.crmMenuItem} ${activeMenuFilter === "favorites" ? styles.crmMenuItemActive : ""}`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
                Favorites
              </span>
              {favoritesCount > 0 && <span className={styles.badge}>{favoritesCount}</span>}
            </li>

            <li 
              onClick={() => setActiveMenuFilter("marketing")}
              className={`${styles.crmMenuItem} ${activeMenuFilter === "marketing" ? styles.crmMenuItemActive : ""}`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19l7-2v-8l-7-2v12zM3 9h4v6H3zM7 11c1 0 2 1 2 2v2M21 13v-2"/>
                </svg>
                Marketing
              </span>
              {marketingCount > 0 && <span className={styles.badge}>{marketingCount}</span>}
            </li>

            <li 
              onClick={() => setActiveMenuFilter("channels_groups")}
              className={`${styles.crmMenuItem} ${activeMenuFilter === "channels_groups" ? styles.crmMenuItemActive : ""}`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                Channels and groups
              </span>
              <span className={styles.badge}>{channelsGroupsCount}</span>
            </li>

          </ul>

          {/* Custom Labels Section */}
          <div 
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={async (e) => {
              e.preventDefault();
              const draggedId = e.dataTransfer.getData("text/plain");
              await handleLabelDrop(draggedId, null);
            }}
            style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginTop: '24px', 
              padding: '8px', 
              borderBottom: '1px solid #f1f5f9',
              backgroundColor: '#f8fafc',
              borderRadius: '6px',
              cursor: 'default'
            }}
            title="Drop labels here to move them to the root level"
          >
            <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                <line x1="7" y1="7" x2="7.01" y2="7"></line>
              </svg>
              Labels
            </span>
            <button 
              onClick={handleCreateNewLabel}
              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', padding: '2px' }}
              title="Add Root Label"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
          <ul className={styles.crmMenu} style={{ marginTop: '8px' }}>
            {renderLabelTree(null, 0)}
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
          <div className={styles.contactList} key={activeMenuFilter + "_" + searchQuery}>
            {filteredContacts.map((contact) => {
              const isActive = contact.id === activeChatId;
              return (
                <div
                  key={contact.id}
                  className={`${styles.contactItem} ${isActive ? styles.contactItemActive : ""}`}
                  onClick={() => {
                    setActiveChatId(contact.id);
                  }}
                >
                  <div className={styles.contactAvatar}>{contact.avatar}</div>
                  <div className={styles.contactInfo}>
                    <span className={styles.contactName}>{contact.name}</span>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '500', margin: '2px 0' }}>{contact.id}</div>
                    <span className={styles.contactPreview}>
                      {contact.preview && contact.preview.startsWith("Phone:") ? "No messages yet" : contact.preview}
                    </span>
                  </div>
                  <div className={styles.contactMeta}>
                    <span className={styles.contactTime}>{formatContactTimeIST(contact)}</span>
                    {(contact.unreadCount || 0) > 0 ? (
                      <span className={styles.unreadBadge}>
                        {contact.unreadCount}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {(() => {
              const cleanedQuery = searchQuery.replace(/[^\d+]/g, "");
              const isNumeric = /^\+?\d{8,15}$/.test(cleanedQuery);
              const exists = sortedContacts.some(c => c.id === cleanedQuery || c.id.replace(/[^\d+]/g, "") === cleanedQuery);
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
                      <span className={styles.contactName} style={{ color: '#15803d', fontWeight: '600' }}>Start chat with:</span>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className={styles.chatHeaderName}>{activeContact.name}</span>
                <button 
                  onClick={async () => {
                    const contactRef = doc(db, "contacts", activeContact.id);
                    await updateDoc(contactRef, {
                      isFavorite: !activeContact.isFavorite
                    });
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '18px',
                    color: activeContact.isFavorite ? '#eab308' : '#cbd5e1',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'color 0.2s',
                  }}
                  title={activeContact.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                >
                  ★
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', fontWeight: '500', color: '#64748b' }}>{activeContact.id}</span>
                {(() => {
                  const assignedIds = activeContact.labels || [];
                  const assigned = customLabels.filter(l => assignedIds.includes(l.id));
                  if (assigned.length === 0) return null;
                  return (
                    <>
                      <span style={{ fontSize: '10px', color: '#cbd5e1' }}>|</span>
                      {assigned.map(lbl => (
                        <span 
                          key={lbl.id} 
                          style={{
                            fontSize: '10px',
                            fontWeight: '600',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: '#f3e8ff',
                            color: '#6b21a8'
                          }}
                        >
                          {lbl.name}
                        </span>
                      ))}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

          <div className={styles.chatHeaderRight}>
            {/* Labels Multi-Select Popover */}
            <div style={{ position: 'relative' }}>
              <button 
                onClick={() => setShowLabelDropdown(!showLabelDropdown)}
                className={styles.statusSelect}
                style={{ 
                  backgroundColor: '#f3e8ff', 
                  color: '#6b21a8', 
                  border: '1px solid #d8b4fe',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '500',
                  minHeight: '34px'
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                  <line x1="7" y1="7" x2="7.01" y2="7"></line>
                </svg>
                {(() => {
                  const assignedIds = activeContact.labels || [];
                  const assigned = customLabels.filter(l => assignedIds.includes(l.id));
                  if (assigned.length === 0) return "Labels";
                  if (assigned.length === 1) return assigned[0].name;
                  return `${assigned.length} Labels`;
                })()}
              </button>

              {showLabelDropdown && (
                <>
                  <div 
                    onClick={() => setShowLabelDropdown(false)}
                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
                  />
                  <div 
                    style={{ 
                      position: 'absolute', 
                      top: '100%', 
                      right: 0, 
                      marginTop: '4px',
                      backgroundColor: 'white', 
                      border: '1px solid #e2e8f0', 
                      borderRadius: '8px', 
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)', 
                      padding: '8px',
                      zIndex: 1000,
                      minWidth: '200px',
                      maxHeight: '300px',
                      overflowY: 'auto'
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', padding: '4px 8px', textTransform: 'uppercase' }}>Select Labels</div>
                    {customLabels.map((lbl) => {
                      const isAssigned = (activeContact.labels || []).includes(lbl.id);
                      return (
                        <div 
                          key={lbl.id}
                          onClick={async () => {
                            const currentLabels = activeContact.labels || [];
                            let newLabels: string[];
                            if (currentLabels.includes(lbl.id)) {
                              newLabels = currentLabels.filter(id => id !== lbl.id);
                            } else {
                              newLabels = [...currentLabels, lbl.id];
                            }
                            const contactRef = doc(db, "contacts", activeContact.id);
                            await updateDoc(contactRef, {
                              labels: newLabels
                            });
                          }}
                          style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px', 
                            padding: '6px 8px', 
                            cursor: 'pointer',
                            borderRadius: '4px',
                            backgroundColor: isAssigned ? '#f5f3ff' : 'transparent',
                            transition: 'background-color 0.15s'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isAssigned ? '#ede9fe' : '#f8fafc'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isAssigned ? '#f5f3ff' : 'transparent'; }}
                        >
                          <input 
                            type="checkbox" 
                            checked={isAssigned}
                            onChange={() => {}} // handled by div click
                            style={{ cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '13px', color: '#334155' }}>{lbl.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

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
                const mediaUrl = msg.mediaUrl || "";
                const templateConfig = msg.templateSid 
                  ? templates.find(t => t.templateSid === msg.templateSid)
                  : null;
                return (
                  <div key={msg.id} className={`${styles.messageWrapper} ${msg.isSent ? styles.sent : styles.received}`}>
                    <div className={styles.messageBubble}>
                      {msg.mediaUrl && (
                        <div style={{ marginBottom: '8px' }}>
                          {msg.mediaType === "image" || (!msg.mediaType && (mediaUrl.match(/\.(jpeg|jpg|gif|png|webp)/i) || mediaUrl.includes("api.twilio.com"))) ? (
                            <img 
                              src={getMediaUrl(mediaUrl)} 
                              alt="Attachment" 
                              style={{ maxWidth: "100%", maxHeight: "240px", borderRadius: "8px", display: "block", objectFit: "cover", cursor: "pointer" }} 
                              onClick={() => openLightbox(getMediaUrl(mediaUrl))}
                            />
                          ) : msg.mediaType === "video" || (!msg.mediaType && mediaUrl.match(/\.(mp4|webm|ogg)/i)) ? (
                            <video 
                              src={getMediaUrl(mediaUrl)} 
                              controls 
                              style={{ maxWidth: "100%", maxHeight: "240px", borderRadius: "8px", display: "block" }} 
                            />
                          ) : msg.mediaType === "audio" || (!msg.mediaType && mediaUrl.match(/\.(mp3|wav|ogg|m4a|aac|amr)/i)) ? (
                            <audio 
                              src={getMediaUrl(mediaUrl)} 
                              controls 
                              style={{ maxWidth: "100%", display: "block", marginTop: "4px" }} 
                            />
                          ) : (
                            <div 
                              onClick={() => {
                                const isPdf = mediaUrl.toLowerCase().match(/\.pdf(\?|$)/i);
                                if (isPdf) {
                                  setActiveDocumentUrl(getMediaUrl(mediaUrl));
                                  setActiveDocumentName(getCleanFileName(mediaUrl));
                                } else {
                                  window.open(getMediaUrl(mediaUrl), '_blank');
                                }
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '12px',
                                background: 'rgba(255, 255, 255, 0.9)',
                                border: '1px solid #e2e8f0',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                minWidth: '240px',
                                maxWidth: '320px',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = '#cbd5e1';
                                e.currentTarget.style.backgroundColor = '#f1f5f9';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = '#e2e8f0';
                                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
                              }}
                            >
                              {/* Stylized PDF/Doc Icon */}
                              <div style={{
                                width: '40px',
                                height: '48px',
                                background: mediaUrl.toLowerCase().match(/\.pdf(\?|$)/i) ? '#fee2e2' : '#e0f2fe',
                                borderRadius: '6px',
                                border: `1px solid ${mediaUrl.toLowerCase().match(/\.pdf(\?|$)/i) ? '#fca5a5' : '#bae6fd'}`,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                position: 'relative',
                                flexShrink: 0
                              }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={mediaUrl.toLowerCase().match(/\.pdf(\?|$)/i) ? '#ef4444' : '#0284c7'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                </svg>
                                <span style={{
                                  position: 'absolute',
                                  bottom: '3px',
                                  background: mediaUrl.toLowerCase().match(/\.pdf(\?|$)/i) ? '#ef4444' : '#0284c7',
                                  color: '#fff',
                                  fontSize: '8px',
                                  fontWeight: 'bold',
                                  padding: '1px 3px',
                                  borderRadius: '2px',
                                  textTransform: 'uppercase',
                                  lineHeight: 1
                                }}>
                                  {mediaUrl.toLowerCase().match(/\.pdf(\?|$)/i) ? 'PDF' : 'DOC'}
                                </span>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
                                <span style={{ 
                                  fontSize: '13px', 
                                  fontWeight: '600', 
                                  color: '#1e293b',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis'
                                }}>
                                  {getCleanFileName(mediaUrl)}
                                </span>
                                <span style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  {mediaUrl.toLowerCase().match(/\.pdf(\?|$)/i) ? 'Click to view inline' : 'Click to download'}
                                </span>
                              </div>
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                            </div>
                          )}
                        </div>
                      )}
                      {msg.text && <MessageTextContent text={msg.text} />}
                      {msg.isSent && (
                        <div style={{ 
                          fontSize: '10px', 
                          opacity: 0.7, 
                          textAlign: 'right', 
                          marginTop: '4px',
                          fontStyle: 'italic',
                          color: '#475569',
                          lineHeight: '1.3'
                        }}>
                          {msg.senderName && <div>Sent by {msg.senderName}</div>}
                          {msg.deliveredAt && <div>Delivered: {msg.deliveredAt}</div>}
                          {msg.readAt && <div>Read: {msg.readAt}</div>}
                          {msg.linkOpenedAt && (
                            <div style={{ color: "#00a884", fontWeight: 600 }}>
                              Link opened: {formatLinkOpenedTime(msg.linkOpenedAt)}
                            </div>
                          )}
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
                    {templateConfig?.buttons && (
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '8px',
                        marginTop: '4px',
                        marginBottom: '8px',
                        width: '100%',
                        justifyContent: msg.isSent ? 'flex-end' : 'flex-start'
                      }}>
                        {templateConfig.buttons.map((btnText, i) => (
                          <div
                            key={i}
                            style={{
                              backgroundColor: '#fff',
                              border: '1px solid #e2e8f0',
                              borderRadius: '18px',
                              padding: '6px 14px',
                              fontSize: '12px',
                              fontWeight: '500',
                              color: '#0284c7',
                              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                              cursor: 'pointer',
                              userSelect: 'none',
                              transition: 'all 0.2s ease',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#f0f9ff';
                              e.currentTarget.style.borderColor = '#bae6fd';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = '#fff';
                              e.currentTarget.style.borderColor = '#e2e8f0';
                            }}
                          >
                            {btnText}
                          </div>
                        ))}
                      </div>
                    )}
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
                    setStagedMediaUrl(null);
                    setStagedMediaType(null);
                    setStagedFileName(null);
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
                handleUploadFile(file);
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
                    {templates.map((tmpl) => (
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
                onClick={() => !uploading && fileInputRef.current?.click()} 
                disabled={uploading}
                style={{ border: 'none', background: 'none', fontSize: '20px', cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.5 : 1 }}
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
                    {templates.map((tmpl) => (
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
                placeholder={uploading ? "Uploading attachment..." : "Type a message..."}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !uploading && handleSend()}

                disabled={uploading}
                className={styles.chatInputField}
                style={uploading ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
              />
              <button 
                onClick={handleSend} 
                disabled={uploading || (!inputText.trim() && !stagedMediaUrl)} 
                className={styles.sendButton}
                style={uploading || (!inputText.trim() && !stagedMediaUrl) ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
              >
                {uploading ? (
                  <span className={styles.spinner} style={{ borderColor: '#fff', borderTopColor: 'transparent', width: '16px', height: '16px', display: 'inline-block' }}></span>
                ) : (
                  <svg className={styles.sendIcon} viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
                  </svg>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Template Variables Config Modal */}
      {showVariablePrompt && promptTemplate && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(15, 23, 42, 0.6)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
        }}>
          <div style={{
            backgroundColor: "#fff",
            borderRadius: "16px",
            width: "900px",
            maxWidth: "95%",
            maxHeight: "90vh",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
            overflow: "hidden"
          }}>
            {/* Modal Header */}
            <div style={{
              padding: "18px 24px",
              borderBottom: "1px solid #f1f5f9",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#0f172a" }}>
                  Configure Template Variables
                </h3>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                  Template: <span style={{ fontWeight: 600, color: "#475569" }}>{promptTemplate.name}</span>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowVariablePrompt(false);
                  setPromptTemplate(null);
                  setPromptedVariables({});
                }}
                style={{
                  border: "none",
                  background: "none",
                  fontSize: "20px",
                  cursor: "pointer",
                  color: "#94a3b8",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                &times;
              </button>
            </div>

            {/* Modal Body */}
            <div style={{
              display: "flex",
              flex: 1,
              overflow: "hidden",
            }}>
              {/* Left Column: Form Inputs */}
              <div style={{
                flex: 1,
                padding: "24px",
                overflowY: "auto",
                borderRight: "1px solid #f1f5f9",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}>
                <div style={{ fontSize: "13px", color: "#475569", fontWeight: 500, marginBottom: "4px" }}>
                  Fill in the variables required for this template:
                </div>
                {getTemplateVariables(promptTemplate.text).map((varName) => {
                  const isMedia = varName.toLowerCase().includes("pdf") || varName.toLowerCase().includes("url") || varName.toLowerCase().includes("link") || varName.toLowerCase().includes("file");
                  return (
                    <div key={varName} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569" }}>
                        {varName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </label>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <input
                          type="text"
                          value={promptedVariables[varName] || ""}
                          onChange={(e) => setPromptedVariables(prev => ({ ...prev, [varName]: e.target.value }))}
                          placeholder={`Enter ${varName.replace(/_/g, ' ')}`}
                          style={{
                            flex: 1,
                            padding: "10px 12px",
                            borderRadius: "8px",
                            border: "1px solid #cbd5e1",
                            fontSize: "14px",
                            outline: "none",
                          }}
                        />
                        {isMedia && (
                          <div style={{ position: "relative" }}>
                            <input
                              type="file"
                              accept=".pdf,image/*"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  try {
                                    const uploadedUrl = await uploadFileForVariable(file);
                                    setPromptedVariables(prev => ({ ...prev, [varName]: uploadedUrl }));
                                  } catch (err: any) {
                                    alert("Upload failed: " + err.message);
                                  }
                                }
                              }}
                              style={{ display: "none" }}
                              id={`file-upload-${varName}`}
                            />
                            <button
                              type="button"
                              onClick={() => document.getElementById(`file-upload-${varName}`)?.click()}
                              disabled={modalUploading}
                              style={{
                                padding: "10px 14px",
                                borderRadius: "8px",
                                border: "1px solid #cbd5e1",
                                backgroundColor: "#f8fafc",
                                color: "#475569",
                                fontSize: "13px",
                                fontWeight: 500,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#64748b" }}>
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="17 8 12 3 7 8"></polyline>
                                <line x1="12" y1="3" x2="12" y2="15"></line>
                              </svg>
                              {modalUploading ? "Uploading..." : "Upload File"}
                            </button>
                          </div>
                        )}
                      </div>
                      {promptedVariables[varName] && promptedVariables[varName].includes("/link/") && (
                        <button
                          type="button"
                          onClick={() => handleCustomLinkAlias(varName, promptedVariables[varName])}
                          style={{
                            alignSelf: "flex-start",
                            fontSize: "11px",
                            color: "#00a884",
                            backgroundColor: "transparent",
                            border: "none",
                            cursor: "pointer",
                            padding: "2px 0",
                            fontWeight: 500,
                            textDecoration: "underline",
                            marginTop: "2px"
                          }}
                        >
                          Customize link handle
                        </button>
                      )}
                    </div>
                  );
                })}
                {modalUploading && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748b" }}>
                      <span>Uploading file to cloud storage...</span>
                      <span>{modalUploadProgress}%</span>
                    </div>
                    <div style={{ height: "4px", backgroundColor: "#e2e8f0", borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${modalUploadProgress}%`, backgroundColor: "#00a884", transition: "width 0.2s" }} />
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Live WhatsApp-style Preview */}
              <div style={{
                flex: 1,
                padding: "24px",
                backgroundColor: "#efeae2",
                backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                overflowY: "auto",
              }}>
                <div style={{ fontSize: "11px", fontWeight: 600, color: "#54656f", backgroundColor: "#fff", padding: "4px 8px", borderRadius: "6px", boxShadow: "0 1px 1px rgba(0,0,0,0.06)", marginBottom: "16px", textTransform: "uppercase" }}>
                  Message Preview
                </div>
                <div style={{
                  backgroundColor: "#d9fdd3",
                  borderRadius: "8px",
                  padding: "12px",
                  maxWidth: "420px",
                  boxShadow: "0 1px 0.5px rgba(0,0,0,0.13)",
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  alignSelf: "flex-end"
                }}>
                  {/* WhatsApp speech bubble tail */}
                  <div style={{
                    position: "absolute",
                    top: 0,
                    right: "-8px",
                    width: 0,
                    height: 0,
                    borderTop: "8px solid #d9fdd3",
                    borderRight: "8px solid transparent",
                  }} />

                  <div style={{ 
                    fontSize: "14.2px", 
                    color: "#111b21", 
                    whiteSpace: "pre-wrap", 
                    lineHeight: "1.4",
                    wordBreak: "break-word"
                  }}>
                    {(() => {
                      const text = promptTemplate.text;
                      const parts: React.ReactNode[] = [];
                      const regex = /(\{\{\s*([a-zA-Z0-9_\-\s]+)\s*\}\})/g;
                      let lastIndex = 0;
                      let match;
                      
                      while ((match = regex.exec(text)) !== null) {
                        const startIndex = match.index;
                        const varName = match[2].trim();
                        
                        // Push text before match
                        if (startIndex > lastIndex) {
                          parts.push(text.substring(lastIndex, startIndex));
                        }
                        
                        // Highlight filled or unfilled variable
                        const value = promptedVariables[varName];
                        if (value && value.trim()) {
                          parts.push(
                            <span key={startIndex} style={{
                              backgroundColor: "rgba(0, 168, 132, 0.15)",
                              borderBottom: "2px solid #00a884",
                              color: "#00a884",
                              fontWeight: "600",
                              padding: "0 2px",
                              borderRadius: "2px"
                            }}>
                              {value}
                            </span>
                          );
                        } else {
                          parts.push(
                            <span key={startIndex} style={{
                              backgroundColor: "rgba(239, 68, 68, 0.15)",
                              borderBottom: "2px solid #ef4444",
                              color: "#ef4444",
                              fontWeight: "600",
                              padding: "0 2px",
                              borderRadius: "2px"
                            }}>
                              [{varName}]
                            </span>
                          );
                        }
                        
                        lastIndex = regex.lastIndex;
                      }
                      
                      if (lastIndex < text.length) {
                        parts.push(text.substring(lastIndex));
                      }
                      
                      return parts.length > 0 ? parts : text;
                    })()}
                  </div>

                  <div style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: "4px",
                    marginTop: "2px"
                  }}>
                    <span style={{ fontSize: "11px", color: "#667781" }}>
                      {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <svg viewBox="0 0 16 15" width="16" height="15" fill="#53bdeb">
                      <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033L5.438 7.525a.36.36 0 0 0-.51.01l-.46.478a.362.362 0 0 0 .007.512l3.411 3.238c.143.136.376.13.513-.013l6.56-7.424a.372.372 0 0 0-.057-.51zm-4.218 0l-.478-.372a.365.365 0 0 0-.51.063L4.446 9.879a.32.32 0 0 1-.484.033L1.218 7.525a.36.36 0 0 0-.51.01l-.46.478a.362.362 0 0 0 .007.512l3.411 3.238c.143.136.376.13.513-.013l6.56-7.424a.372.372 0 0 0-.057-.51z" />
                    </svg>
                  </div>
                </div>

                {/* Quick Reply Buttons Preview */}
                {promptTemplate.buttons && promptTemplate.buttons.length > 0 && (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginTop: '8px',
                    width: '100%',
                    maxWidth: "420px",
                    justifyContent: 'flex-end',
                    alignSelf: 'flex-end'
                  }}>
                    {promptTemplate.buttons.map((btnText, i) => (
                      <div
                        key={i}
                        style={{
                          backgroundColor: '#fff',
                          border: '1px solid #e2e8f0',
                          borderRadius: '18px',
                          padding: '6px 14px',
                          fontSize: '12px',
                          fontWeight: '500',
                          color: '#0284c7',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                        {btnText}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: "16px 24px",
              borderTop: "1px solid #f1f5f9",
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              backgroundColor: "#f8fafc",
            }}>
              <button
                onClick={() => {
                  setShowVariablePrompt(false);
                  setPromptTemplate(null);
                  setPromptedVariables({});
                }}
                style={{
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#fff",
                  color: "#475569",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmVariables}
                disabled={modalUploading}
                style={{
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: "#00a884",
                  color: "#fff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: modalUploading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  opacity: modalUploading ? 0.7 : 1,
                  boxShadow: "0 2px 4px rgba(0, 168, 132, 0.2)"
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
                Send Message
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox / Image Modal Popup */}
      {activeLightboxImage && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(11, 20, 26, 0.95)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            overflow: 'auto',
            padding: '20px',
          }}
          onClick={() => setActiveLightboxImage(null)}
        >
          {/* Zoom controls */}
          <div 
            style={{
              position: 'absolute',
              top: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              backdropFilter: 'blur(8px)',
              padding: '6px 16px',
              borderRadius: '20px',
              zIndex: 10001,
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              style={{ background: 'none', border: 'none', color: '#f1f5f9', cursor: 'pointer', fontSize: '20px', padding: '4px 8px', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}
              onClick={() => setZoomScale(prev => Math.max(0.5, prev - 0.25))}
              title="Zoom Out"
            >
              −
            </button>
            <span style={{ color: '#f1f5f9', fontSize: '14px', fontWeight: '500', minWidth: '45px', textAlign: 'center', fontFamily: 'sans-serif' }}>
              {Math.round(zoomScale * 100)}%
            </span>
            <button 
              style={{ background: 'none', border: 'none', color: '#f1f5f9', cursor: 'pointer', fontSize: '20px', padding: '4px 8px', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}
              onClick={() => setZoomScale(prev => Math.min(4, prev + 0.25))}
              title="Zoom In"
            >
              +
            </button>
            <div style={{ width: '1px', height: '16px', backgroundColor: 'rgba(255,255,255,0.2)', margin: '0 4px' }}></div>
            <button 
              style={{ background: 'none', border: 'none', color: '#f1f5f9', cursor: 'pointer', fontSize: '15px', padding: '4px 8px', display: 'flex', alignItems: 'center' }}
              onClick={() => setZoomScale(1)}
              title="Reset Zoom"
            >
              ↺
            </button>
          </div>

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
              zIndex: 10002,
            }}
            onClick={() => setActiveLightboxImage(null)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          
          <div 
            style={{ 
              display: 'inline-block',
              transition: 'transform 0.2s ease-in-out',
              transform: `scale(${zoomScale})`,
              transformOrigin: 'center',
              cursor: zoomScale > 1 ? 'grab' : 'zoom-in',
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (zoomScale === 1) {
                setZoomScale(2);
              } else {
                setZoomScale(1);
              }
            }}
          >
            <img 
              src={activeLightboxImage} 
              alt="Enlarged Attachment" 
              style={{
                maxWidth: '90vw',
                maxHeight: '85vh',
                objectFit: 'contain',
                borderRadius: '8px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'block',
              }}
              draggable={false}
            />
          </div>
        </div>
      )}

      {/* Inline Document / PDF Modal Popup */}
      {activeDocumentUrl && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(11, 20, 26, 0.85)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 10000,
            padding: '24px',
            boxSizing: 'border-box'
          }}
          onClick={() => {
            setActiveDocumentUrl(null);
            setActiveDocumentName(null);
          }}
        >
          <div 
            style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              height: '100%',
              maxWidth: '1000px',
              margin: '0 auto',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15), 0 10px 10px -5px rgba(0,0,0,0.04)',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 24px',
              borderBottom: '1px solid #e2e8f0',
              background: '#f8fafc'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                <span style={{ fontSize: '20px' }}>📄</span>
                <span style={{ fontSize: '15px', fontWeight: '600', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activeDocumentName || "Document Viewer"}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <a 
                  href={activeDocumentUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '13px',
                    color: '#2563eb',
                    textDecoration: 'none',
                    fontWeight: '500',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                    background: '#fff',
                    transition: 'all 0.15s'
                  }}
                >
                  Open in New Tab
                </a>
                <button 
                  onClick={() => {
                    setActiveDocumentUrl(null);
                    setActiveDocumentName(null);
                  }}
                  style={{
                    border: 'none',
                    background: '#f1f5f9',
                    color: '#64748b',
                    fontSize: '18px',
                    cursor: 'pointer',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s'
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body (Iframe) */}
            <div style={{ flex: 1, position: 'relative', background: '#f1f5f9' }}>
              <iframe 
                src={`${activeDocumentUrl}#toolbar=1`}
                width="100%" 
                height="100%" 
                style={{ border: 'none' }}
                title="Document Viewer"
              />
            </div>
          </div>
        </div>
      )}
        </>
      ) : activeView === "automations" ? (
        isAutomationAllowed ? (
          <AutomationFlowBuilder currentUser={currentUser} />
        ) : (
          renderAccessRestricted()
        )
      ) : activeView === "campaigns" ? (
        isAutomationAllowed ? (
          <CampaignsDashboard currentUser={currentUser} />
        ) : (
          renderAccessRestricted()
        )
      ) : activeView === "ai" ? (
        renderAIConfigView()
      ) : (
        renderSettingsView()
      )}
    </div>
  );
}

function getYouTubeId(url: string): string | null {
  try {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  } catch (e) {
    return null;
  }
}

function LinkPreviewCard({ url }: { url: string }) {
  const [metadata, setMetadata] = useState<{ title?: string; description?: string; image?: string; error?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/chat/link-preview?url=${encodeURIComponent(url)}`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (active && data.success) {
          setMetadata({
            title: data.title,
            description: data.description,
            image: data.image,
          });
        } else if (active) {
          setMetadata({ error: true });
        }
      })
      .catch(() => {
        if (active) setMetadata({ error: true });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [url]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        background: 'rgba(255, 255, 255, 0.5)',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        maxWidth: '360px',
        fontSize: '12px',
        color: '#64748b',
        marginTop: '4px'
      }}>
        <div style={{ width: '12px', height: '12px', border: '2px solid #cbd5e1', borderTop: '2px solid #64748b', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
        <span>Loading preview...</span>
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        `}} />
      </div>
    );
  }

  if (!metadata || metadata.error || (!metadata.title && !metadata.image)) {
    return null;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        backgroundColor: '#fff',
        overflow: 'hidden',
        maxWidth: '360px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
        textDecoration: 'none',
        transition: 'transform 0.2s, box-shadow 0.2s',
        marginTop: '4px'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.06)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.04)';
      }}
    >
      {metadata.image && (
        <div style={{ width: '100%', height: '160px', overflow: 'hidden', position: 'relative', borderBottom: '1px solid #f1f5f9' }}>
          <img
            src={metadata.image}
            alt="Link preview thumbnail"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      )}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {metadata.title && (
          <div style={{
            fontSize: '13px',
            fontWeight: '600',
            color: '#1e293b',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            lineHeight: '1.3'
          }}>
            {metadata.title}
          </div>
        )}
        {metadata.description && (
          <div style={{
            fontSize: '11px',
            color: '#64748b',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            lineHeight: '1.3'
          }}>
            {metadata.description}
          </div>
        )}
        <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px', wordBreak: 'break-all' }}>
          {new URL(url).hostname}
        </div>
      </div>
    </a>
  );
}

function MessageTextContent({ text }: { text: string }) {
  if (!text) return null;

  const URL_REGEX = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(URL_REGEX);
  const urls = text.match(URL_REGEX) || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
        {parts.map((part, index) => {
          if (part.match(URL_REGEX)) {
            return (
              <a
                key={index}
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#0284c7', textDecoration: 'underline', wordBreak: 'break-all' }}
              >
                {part}
              </a>
            );
          }
          return part;
        })}
      </div>

      {urls.map((url, index) => {
        const youtubeId = getYouTubeId(url);
        if (youtubeId) {
          return (
            <div key={index} style={{ marginTop: '4px', width: '100%', maxWidth: '360px', overflow: 'hidden', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <iframe
                width="100%"
                height="200"
                src={`https://www.youtube.com/embed/${youtubeId}`}
                title="YouTube video player"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                style={{ border: 'none', display: 'block' }}
              />
            </div>
          );
        }

        return <LinkPreviewCard key={index} url={url} />;
      })}
    </div>
  );
}
