"use client";

import { useEffect, useState } from "react";
import Script from "next/script";

export default function InstallPage() {
  const [status, setStatus] = useState("Initializing installation...");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const authId = urlParams.get("AUTH_ID");
      const domain = urlParams.get("DOMAIN");
      if (authId) localStorage.setItem("bx24_auth_id", authId);
      if (domain) localStorage.setItem("bx24_domain", domain);
    }
  }, []);

  const handleSdkLoad = () => {
    setStatus("Bitrix24 SDK Loaded. Finishing installation...");
    const w = window as any;
    if (w.BX24) {
      try {
        w.BX24.init(() => {
          setStatus("Registering CRM Placements...");
          w.BX24.callMethod("placement.bind", {
            PLACEMENT: "CRM_LEAD_DETAIL_TAB",
            HANDLER: window.location.origin + "/",
            TITLE: "WhatsappLine",
            DESCRIPTION: "WhatsApp chat for this lead"
          }, () => {
            w.BX24.callMethod("placement.bind", {
              PLACEMENT: "CRM_CONTACT_DETAIL_TAB",
              HANDLER: window.location.origin + "/",
              TITLE: "WhatsappLine",
              DESCRIPTION: "WhatsApp chat for this contact"
            }, () => {
              setStatus("Completing installation with Bitrix24...");
              w.BX24.installFinish();
              setStatus("Installation completed successfully! CRM tabs registered.");
            });
          });
        });
      } catch (e) {
        console.error("Failed to complete installation", e);
        setStatus("Error completing installation. Please try again.");
      }
    } else {
      setStatus("Bitrix24 SDK not found. Retrying...");
    }
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      fontFamily: "system-ui, sans-serif",
      backgroundColor: "#f8fafc",
      color: "#1e293b",
      padding: "24px",
      textAlign: "center"
    }}>
      <Script 
        src="https://api.bitrix24.com/api/v1/" 
        strategy="afterInteractive"
        onLoad={handleSdkLoad}
      />

      <div style={{
        backgroundColor: "#fff",
        padding: "32px",
        borderRadius: "12px",
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
        maxWidth: "400px",
        width: "100%"
      }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>🔌</div>
        <h1 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "8px" }}>WhatsBit Integration</h1>
        <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 24px" }}>
          Connecting your WhatsApp CRM prototype to Bitrix24.
        </p>
        <div style={{
          padding: "12px",
          borderRadius: "8px",
          backgroundColor: "#f1f5f9",
          fontSize: "13px",
          fontWeight: "500",
          color: "#475569",
          border: "1px solid #e2e8f0"
        }}>
          {status}
        </div>
      </div>
    </div>
  );
}
