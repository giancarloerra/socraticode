// sdk/arkhe-ws-client.ts
export interface ClientConfig {
  url: string;
  tdxQuote: string;
  enclaveKey: string;
  phase: {
    voyager: number;
    solar: number;
    lunar: number;
  };
  binaryPreferred?: boolean;
  autoReconnect?: boolean;
  heartbeatInterval?: number;
}

export interface PhaseFrame {
  timestamp: Date;
  voyagerRad: number;
  solarAttos: number;
  lunarRad: number;
  globalOmega: number;
  blockHeight: number;
  nodeCount: number;
}

export interface WSMessage {
  topic: string;
  data: any;
}

export interface TzinorData {
  channel_id: string;
  status: string;
  payload: any;
  commitment_hex: string;
}

export type MessageHandler = (data: any) => void;

export class ArkheWSClient {
  private ws: WebSocket | null = null;
  private config: ClientConfig;
  private reconnectAttempts = 0;
  private maxReconnect = 10;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private coherence = 0;
  private lastPong = Date.now();
  private heartbeatTimer?: any;

  constructor(config: ClientConfig) {
    this.config = {
      binaryPreferred: true,
      autoReconnect: true,
      heartbeatInterval: 30000,
      ...config,
    };
  }

  async connect(): Promise<void> {
    const url = this.buildAuthenticatedURL();

    this.ws = new WebSocket(url, [
      'arkhe-phase',
      'arkhe-gov',
      'arkhe-tzinor',
    ]);

    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.emit('connected', { coherence: this.coherence });
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.handleBinaryFrame(event.data);
      } else {
        this.handleJSONMessage(JSON.parse(event.data));
      }
    };

    this.ws.onclose = (event) => {
      this.stopHeartbeat();
      this.emit('disconnected', { code: event.code, reason: event.reason });

      if (this.config.autoReconnect && this.reconnectAttempts < this.maxReconnect) {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        setTimeout(() => this.connect(), delay);
        this.reconnectAttempts++;
      }
    };

    this.ws.onerror = (error) => {
      this.emit('error', error);
    };
  }

  private handleBinaryFrame(buffer: ArrayBuffer): void {
    const view = new DataView(buffer);
    const timestamp = Number(view.getBigInt64(0)) / 1e6; // ns → ms

    const frame: PhaseFrame = {
      timestamp: new Date(timestamp),
      voyagerRad: view.getFloat64(8),
      solarAttos: view.getFloat64(16),
      lunarRad: view.getFloat64(24),
      globalOmega: view.getFloat64(32),
      blockHeight: view.getUint32(40),
      nodeCount: view.getUint8(44),
    };

    this.coherence = frame.globalOmega;
    this.emit('phase', frame);

    // Alerta de decoherência
    if (this.coherence < 0.9) {
      this.emit('decoherence', {
        coherence: this.coherence,
        threshold: 0.9,
        severity: this.coherence < 0.85 ? 'critical' : 'warning'
      });
    }
  }

  private handleJSONMessage(msg: WSMessage): void {
    switch (msg.topic) {
      case 'governance':
        this.emit('proposal', msg.data);
        break;
      case 'tzinor':
        this.handleTzinorMessage(msg.data);
        break;
      case 'error':
        this.emit('error', new Error(msg.data.message));
        break;
      case 'PONG':
        this.lastPong = Date.now();
        break;
    }
  }

  private handleTzinorMessage(data: TzinorData): void {
    // Tzinor só é visível se coerência >= 0.99
    if (this.coherence < 0.99) {
      this.emit('tzinor:denied', {
        reason: 'INSUFFICIENT_COHERENCE',
        required: 0.99,
        current: this.coherence
      });
      return;
    }

    this.emit('tzinor', {
      channelId: data.channel_id,
      status: data.status,
      payload: data.status === 'COLLAPSED' ? data.payload : null,
      commitment: data.commitment_hex,
    });
  }

  private send(msg: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  subscribe(topics: string[]): void {
    this.send({
      type: 'SUBSCRIBE',
      data: { topics },
    });
  }

  vote(proposalId: string, option: 'YES' | 'NO' | 'ABSTAIN', zkProof: string): void {
    this.send({
      type: 'VOTE',
      data: {
        proposal_id: proposalId,
        option,
        zk_proof: zkProof,
        timestamp: Date.now() * 1e6, // nanosec
      },
    });
  }

  sendTzinor(channelId: string, content: string, arrivalTime: Date): void {
    this.send({
      type: 'TZINOR_SEND',
      data: {
        channel_id: channelId,
        content,
        arrival_time: arrivalTime.toISOString(),
        coherence_req: 0.99,
      },
    });
  }

  private buildAuthenticatedURL(): string {
    const params = new URLSearchParams();

    // Headers de autenticação como query params (WebSocket limitation)
    params.set('x_arkhe_tdx_quote', this.config.tdxQuote);
    params.set('x_arkhe_phase_voyager', this.config.phase.voyager.toString());
    params.set('x_arkhe_phase_solar', this.config.phase.solar.toString());
    params.set('x_arkhe_phase_lunar', this.config.phase.lunar.toString());
    params.set('x_arkhe_enclave_key', this.config.enclaveKey);
    params.set('x_arkhe_nonce', this.generateNonce());
    params.set('x_arkhe_signature', "dummy_signature");

    return `${this.config.url}?${params.toString()}`;
  }

  private generateNonce(): string {
    return Math.random().toString(36).substring(2);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastPong > this.config.heartbeatInterval! * 2) {
        this.ws?.close(1001, 'Heartbeat timeout');
        return;
      }
      this.send({ type: 'PING', timestamp: Date.now() });
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
  }

  private emit(event: string, data: any): void {
    this.handlers.get(event)?.forEach(h => h(data));
  }

  on(event: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    return () => this.handlers.get(event)?.delete(handler);
  }

  close(): void {
    this.config.autoReconnect = false;
    this.ws?.close(1000, 'Client disconnect');
  }
}
