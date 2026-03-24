// src/lib/arkhe-ws.ts
export enum ArkheSubprotocol {
  Phase = 'arkhe-phase',
  Gov = 'arkhe-gov',
  Tzinor = 'arkhe-tzinor',
}

export interface TzinorMessage {
  originTime: Date;
  arrivalTime: Date;
  state: 'POTENTIAL' | 'COLLAPSED' | 'RETRACTED';
  payload: Uint8Array;
}

export interface ArkheWSConfig {
  url: string;
  enclaveKey: Uint8Array;
  tdxQuote: Uint8Array;
  phase: {
    voyager: number;
    solar: number;
    lunar: number;
  };
  onCoherenceDrop?: (oldCoh: number, newCoh: number) => void;
  onTzinorMessage?: (msg: TzinorMessage) => void;
}

export class ArkheWebSocket {
  private ws: WebSocket | null = null;
  private config: ArkheWSConfig;
  private reconnectAttempts = 0;
  private maxReconnect = 5;
  private coherence = 0;
  private sequence = 0;

  constructor(config: ArkheWSConfig) {
    this.config = config;
  }

  async connect(protocol: ArkheSubprotocol = ArkheSubprotocol.Phase): Promise<void> {
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const nonceHex = Array.from(nonce).map(b => b.toString(16).padStart(2, '0')).join('');

    const headers = {
      'X-Arkhe-TDX-Quote': btoa(String.fromCharCode(...this.config.tdxQuote)),
      'X-Arkhe-Phase-Voyager': this.config.phase.voyager.toString(),
      'X-Arkhe-Phase-Solar': this.config.phase.solar.toString(),
      'X-Arkhe-Phase-Lunar': this.config.phase.lunar.toString(),
      'X-Arkhe-Enclave-Key': Array.from(this.config.enclaveKey).map(b => b.toString(16).padStart(2, '0')).join(''),
      'X-Arkhe-Nonce': nonceHex,
      'X-Arkhe-Signature': "dummy_signature", // In real world, sign the message
    };

    const url = new URL(this.config.url);
    Object.entries(headers).forEach(([k, v]) => url.searchParams.set(k, v));

    this.ws = new WebSocket(url.toString(), [protocol]);

    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      console.log('🜏 Arkhe WS connected:', protocol);
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data, protocol);
    };

    this.ws.onclose = (event) => {
      if (!event.wasClean && this.reconnectAttempts < this.maxReconnect) {
        setTimeout(() => this.connect(protocol), 1000 * Math.pow(2, this.reconnectAttempts));
        this.reconnectAttempts++;
      }
    };
  }

  private handleMessage(data: ArrayBuffer | string, protocol: ArkheSubprotocol): void {
    if (protocol === ArkheSubprotocol.Phase && data instanceof ArrayBuffer) {
      this.handlePhaseFrame(data);
    } else if (protocol === ArkheSubprotocol.Gov && typeof data === 'string') {
      this.handleGovMessage(JSON.parse(data));
    } else if (protocol === ArkheSubprotocol.Tzinor && data instanceof ArrayBuffer) {
      this.handleTzinorFrame(data);
    }
  }

  private handlePhaseFrame(buffer: ArrayBuffer): void {
    const view = new DataView(buffer);

    const frame = {
      timestamp: view.getBigInt64(0),
      voyager: view.getFloat64(8),
      solar: view.getFloat64(16),
      lunar: view.getFloat64(24),
      omega: view.getFloat64(32),
      blockHeight: view.getUint32(40),
      nodeCount: view.getUint8(44),
    };

    const oldCoherence = this.coherence;
    this.coherence = frame.omega;

    if (oldCoherence > 0.9 && frame.omega < 0.9) {
      this.config.onCoherenceDrop?.(oldCoherence, frame.omega);
    }

    window.dispatchEvent(new CustomEvent('arkhe:phase', { detail: frame }));
  }

  private handleGovMessage(msg: any): void {
    console.log("Gov message received:", msg);
  }

  private handleTzinorFrame(buffer: ArrayBuffer): void {
    const view = new DataView(buffer);

    const originTime = view.getBigInt64(0);
    const arrivalTime = view.getBigInt64(8);
    const state = view.getUint8(32);

    const payload = new Uint8Array(buffer, 33);

    const msg: TzinorMessage = {
      originTime: new Date(Number(originTime) / 1e6),
      arrivalTime: new Date(Number(arrivalTime) / 1e6),
      state: state === 0 ? 'POTENTIAL' : state === 1 ? 'COLLAPSED' : 'RETRACTED',
      payload: payload,
    };

    this.config.onTzinorMessage?.(msg);
  }

  sendVote(proposalId: string, option: 'YES' | 'NO' | 'ABSTAIN', zkProof: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const msg = {
      type: 'VOTE_CAST',
      ts: Date.now() * 1e6, // nanosec
      seq: this.getNextSequence(),
      payload: JSON.stringify({
        proposal_id: proposalId,
        voter: Array.from(this.config.enclaveKey).map(b => b.toString(16).padStart(2, '0')).join(''),
        option,
        zk_proof: zkProof,
      }),
    };

    this.ws.send(JSON.stringify(msg));
  }

  private getNextSequence(): number {
    return ++this.sequence;
  }

  close(): void {
    this.ws?.close(1000, 'Client disconnect');
  }
}
