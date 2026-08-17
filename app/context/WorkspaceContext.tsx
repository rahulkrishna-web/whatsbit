"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

interface WorkspaceContextType {
  orgId: string | null;
  clyrixApiKey: string | null;
  setWorkspace: (orgId: string, apiKey: string) => void;
  logout: () => void;
  isConnecting: boolean;
  connectionError: string | null;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  orgId: null,
  clyrixApiKey: null,
  setWorkspace: () => {},
  logout: () => {},
  isConnecting: true,
  connectionError: null,
});

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [clyrixApiKey, setClyrixApiKey] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    const checkConnection = async () => {
      const storedKey = localStorage.getItem("clyrix_api_key");
      if (!storedKey) {
        setIsConnecting(false);
        return;
      }

      try {
        const clyrixUrl = process.env.NEXT_PUBLIC_CLYRIX_URL || "https://clyrix.com";
        const res = await fetch(`${clyrixUrl}/api/whatsbit/auth`, {
          headers: {
            "x-api-key": storedKey
          }
        });

        if (res.ok) {
          const data = await res.json();
          if (data.success && data.orgId) {
            localStorage.setItem("clyrix_org_id", data.orgId);
            setOrgId(data.orgId);
            setClyrixApiKey(storedKey);
          } else {
            setConnectionError("Invalid API Key or Workspace not found.");
            localStorage.removeItem("clyrix_api_key");
          }
        } else {
          setConnectionError("Failed to connect to Clyrix server.");
        }
      } catch (err: any) {
        setConnectionError("Network error checking API Key.");
      } finally {
        setIsConnecting(false);
      }
    };

    checkConnection();
  }, []);

  const setWorkspace = (newOrgId: string, newApiKey: string) => {
    localStorage.setItem("clyrix_api_key", newApiKey);
    localStorage.setItem("clyrix_org_id", newOrgId);
    setOrgId(newOrgId);
    setClyrixApiKey(newApiKey);
    setConnectionError(null);
  };

  const logout = () => {
    localStorage.removeItem("clyrix_api_key");
    localStorage.removeItem("clyrix_org_id");
    setOrgId(null);
    setClyrixApiKey(null);
  };

  return (
    <WorkspaceContext.Provider value={{ orgId, clyrixApiKey, setWorkspace, logout, isConnecting, connectionError }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => useContext(WorkspaceContext);

export const useApi = () => {
  const { clyrixApiKey } = useWorkspace();
  
  return async (path: string, options: RequestInit = {}) => {
    const clyrixUrl = process.env.NEXT_PUBLIC_CLYRIX_URL || "https://clyrix.com";
    const headers = {
      ...options.headers,
      "x-api-key": clyrixApiKey || ""
    };
    
    return fetch(`${clyrixUrl}${path}`, {
      ...options,
      headers
    });
  };
};
