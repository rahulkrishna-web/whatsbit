"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./page.module.css";

type Message = {
  id: string;
  text: string;
  isSent: boolean;
  time: string;
  status: "sent" | "delivered" | "read";
};

export default function ChatApp() {
  const [messages, setMessages] = useState<Message[]>([
    { id: "1", text: "Please tell us how we did. Just send 1 if you are satisfied...", isSent: false, time: "11:53 AM", status: "read" },
    { id: "2", text: "Scaling Your Flour Mill - Webinar Registration", isSent: false, time: "11:53 AM", status: "read" },
  ]);
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (!inputText.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      text: inputText,
      isSent: true,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: "sent",
    };

    setMessages((prev) => [...prev, newMessage]);
    setInputText("");

    // Simulate reply after 2 seconds
    setTimeout(() => {
      const replyMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "Thank you for reaching out! We've received your message and will get back to you shortly.",
        isSent: false,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: "read",
      };
      setMessages((prev) => [...prev, replyMessage]);
    }, 2000);
  };

  return (
    <div className={styles.appContainer}>
      {/* 1. CRM Sidebar */}
      <div className={styles.crmSidebar}>
        <div className={styles.crmHeader}>
          <div className={styles.crmAvatar}>N</div>
          <span>New company</span>
        </div>
        <ul className={styles.crmMenu}>
          <li className={styles.crmMenuItem}>Workday</li>
          <li className={styles.crmMenuItem}>Lunch</li>
          <li className={styles.crmMenuItem}>Settings</li>
        </ul>
        <ul className={styles.crmMenu} style={{ marginTop: '24px' }}>
          <li className={`${styles.crmMenuItem} ${styles.active}`}>
            All <span className={styles.badge}>1031</span>
          </li>
          <li className={styles.crmMenuItem}>
            Unprocessed <span className={styles.badge}>1031</span>
          </li>
          <li className={styles.crmMenuItem}>
            My <span className={styles.badge}>24</span>
          </li>
        </ul>
      </div>

      {/* 2. Chat List Pane */}
      <div className={styles.chatListPane}>
        <div className={styles.chatSearch}>
          <input
            type="text"
            placeholder="Search from URL or contacts..."
            className={styles.chatSearchInput}
          />
        </div>
        <div className={styles.contactList}>
          {/* Mock Contact */}
          <div className={`${styles.contactItem} ${styles.active}`}>
            <div className={styles.contactAvatar}>👤</div>
            <div className={styles.contactInfo}>
              <div className={styles.contactHeader}>
                <span className={styles.contactName}>918839780947</span>
                <span className={styles.contactTime}>03/13/2026</span>
              </div>
              <span className={styles.contactPreview}>Please tell us how we did. Just se...</span>
            </div>
          </div>
          <div className={styles.contactItem}>
            <div className={styles.contactAvatar}>RS</div>
            <div className={styles.contactInfo}>
              <div className={styles.contactHeader}>
                <span className={styles.contactName}>Anirrudh Sharma</span>
                <span className={styles.contactTime}>11:53 AM</span>
              </div>
              <span className={styles.contactPreview}>Project offer 1...nt.pdf</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Active Chat Pane */}
      <div className={styles.activeChatPane}>
        <div className={styles.chatHeader}>
          <div className={styles.chatHeaderLeft}>
            <div className={styles.contactAvatar} style={{ width: 40, height: 40, backgroundColor: '#cbd5e1' }}>
              👤
            </div>
            <div className={styles.chatHeaderInfo}>
              <span className={styles.chatHeaderName}>918839780947</span>
              <span className={styles.chatHeaderStatus}>WhatsApp • Online</span>
            </div>
          </div>
          <div className={styles.chatHeaderRight}>
            <button style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748b' }}>⋮</button>
          </div>
        </div>

        <div className={styles.messagesContainer}>
          <div style={{ textAlign: 'center', margin: '16px 0' }}>
            <span style={{ backgroundColor: '#fff', padding: '6px 12px', borderRadius: '16px', fontSize: '12px', color: '#64748b', boxShadow: '0 1px 1px rgba(0,0,0,0.05)' }}>
              Monday
            </span>
          </div>

          {messages.map((msg) => (
            <div key={msg.id} className={`${styles.messageWrapper} ${msg.isSent ? styles.sent : styles.received}`}>
              <div className={styles.messageBubble}>
                {msg.text}
                <div className={styles.messageFooter}>
                  <span className={styles.messageTime}>{msg.time}</span>
                  {msg.isSent && (
                    <span className={styles.messageStatus}>
                      {msg.status === "read" ? "✓✓" : "✓"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className={styles.chatInputArea}>
          <button style={{ border: 'none', background: 'none', fontSize: '20px', cursor: 'pointer' }}>📎</button>
          <input
            type="text"
            placeholder="Type a message..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            className={styles.chatInputField}
          />
          <button onClick={handleSend} disabled={!inputText.trim()} className={styles.sendButton}>
            <svg className={styles.sendIcon} viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
