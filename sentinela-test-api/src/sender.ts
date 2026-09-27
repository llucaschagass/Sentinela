export interface CapturedEvent {
  environment: string; level: 'error'|'fatal'; type: string; message: string; occurredAt: string;
  origin: string; stackTrace?: string; endpoint: string; httpMethod: string; httpStatus: number; correlationId: string;
  metadata?: Record<string,string>;
}
export class EventSender {
  private queue: CapturedEvent[]=[];
  private running=false;
  public dropped=0;
  constructor(private readonly url: string,private readonly key: string,private readonly timeoutMs=2000,private readonly capacity=100) {}
  send(event: CapturedEvent): void {
    if (this.queue.length>=this.capacity) { this.dropped++; return; }
    this.queue.push(event);
    if (!this.running) void this.drain();
  }
  private async drain(): Promise<void> {
    this.running=true;
    try {
      while (this.queue.length) {
        const event=this.queue.shift()!;
        try {
          const response=await fetch(`${this.url}/events`,{method:'POST',headers:{'Content-Type':'application/json','X-Application-Key':this.key},
            body:JSON.stringify(event),signal:AbortSignal.timeout(this.timeoutMs)});
          await response.body?.cancel();
          if (!response.ok) this.dropped++;
        } catch { this.dropped++; }
      }
    } finally { this.running=false; }
  }
  async idle(): Promise<void> { while(this.running) await new Promise(resolve=>setTimeout(resolve,10)); }
}
