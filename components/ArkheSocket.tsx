// components/ArkheSocket.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';

const WS_URL = 'wss://ws.arkhe.network/v1/stream';

interface SocketContextType {
  phaseData: any;
  govData: any;
  tzinorData: any;
  isConnected: boolean;
}

const ArkheSocketContext = createContext<SocketContextType>({} as any);

export const ArkheSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [phaseData, setPhaseData] = useState(null);
  const [govData, setGovData] = useState(null);
  const [tzinorData, setTzinorData] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setIsConnected(true);
      // Inscreve-se em todos os tópicos
      ws.send(JSON.stringify({ type: "SUBSCRIBE", data: { topics: ["phase", "governance", "tzinor"] } }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch(msg.type) {
        case "PHASE_UPDATE":
          setPhaseData(msg.data);
          break;
        case "GOV_VOTE_CAST":
        case "GOV_PROPOSAL_NEW":
          setGovData(msg.data);
          break;
        case "TZINOR_COLLAPSE":
          setTzinorData(msg.data);
          console.log("🜏 MENSAGEM DO FUTURO DETECTADA:", msg.data);
          break;
      }
    };

    ws.onclose = () => setIsConnected(false);

    return () => ws.close();
  }, []);

  return (
    <ArkheSocketContext.Provider value={{ phaseData, govData, tzinorData, isConnected }}>
      {children}
    </ArkheSocketContext.Provider>
  );
};

export const useArkheSocket = () => useContext(ArkheSocketContext);
