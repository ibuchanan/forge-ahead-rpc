import { randomUUID } from "node:crypto";

export type AuditReason =
  | "authenticated"
  | "invalid-credentials"
  | "not-admin"
  | "unavailable"
  | "allowed"
  | "denied"
  | "unknown"
  | "started"
  | "succeeded"
  | "failed";
export type AuditPhase =
  | "authentication"
  | "authorization"
  | "attempt"
  | "outcome";
export type AuditEvent = {
  specversion: "1.0";
  id: string;
  source: string;
  type: `com.forge-ahead.rpc.${AuditPhase}`;
  time: string;
  data: {
    correlationId: string;
    installationId: string;
    environment: string;
    reason: AuditReason;
    accountId?: string;
    method?: string;
  };
};
export type AuditPort<Installation, Principal> = {
  source: string;
  identity: (installation: Installation) => {
    installationId: string;
    environment: string;
  };
  accountId?: (principal: Principal) => string;
  publish: (event: AuditEvent) => Promise<void>;
  onFailure: (phase: AuditPhase) => void;
  /** Upper bound for an acknowledgement; uncertain delivery still blocks a critical write. */
  timeoutMs: number;
};

/** Format a single allowlisted CloudEvent without copying request or exception data. */
export function auditEvent(
  source: string,
  phase: AuditPhase,
  data: AuditEvent["data"],
): AuditEvent {
  return {
    specversion: "1.0",
    id: randomUUID(),
    source,
    type: `com.forge-ahead.rpc.${phase}`,
    time: new Date().toISOString(),
    data: { ...data },
  };
}

export function auditSession<Installation, Principal>(
  port: AuditPort<Installation, Principal>,
  installation: Installation,
  principal?: Principal,
) {
  const identity = port.identity(installation);
  const correlationId = randomUUID();
  return {
    async emit(
      phase: AuditPhase,
      reason: AuditReason,
      method?: string,
    ): Promise<boolean> {
      try {
        const accountId =
          principal === undefined ? undefined : port.accountId?.(principal);
        const event = auditEvent(port.source, phase, {
          ...identity,
          correlationId,
          reason,
          ...(accountId ? { accountId } : {}),
          ...(method ? { method } : {}),
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.resolve().then(() => port.publish(event)),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("audit timeout")),
                port.timeoutMs,
              );
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        return true;
      } catch {
        try {
          port.onFailure(phase);
        } catch {
          /* Operator callback cannot mask the decision. */
        }
        return false;
      }
    },
  };
}
