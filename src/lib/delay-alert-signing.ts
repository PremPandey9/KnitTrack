import "server-only";

import { randomUUID } from "node:crypto";
import { DelayAlertSnapshot, decodeDelayAlertSigningKey, signDelayAlertPayload, buildDelayAlertPayload, DELAY_ALERT_KEY_ID } from "./delay-alert-signing-core";

/** Private server-side envelope. Never return this from a Server Action. */
export interface SignedDelayAlert {
  keyId: string;
  requestId: string;
  payload: string;
  signatureHex: string;
}

export function signDelayAlert(snapshot: Omit<DelayAlertSnapshot, "requestId">): SignedDelayAlert {
  const requestId = randomUUID().toLowerCase();
  const payload = buildDelayAlertPayload({ ...snapshot, requestId });
  const key = decodeDelayAlertSigningKey(process.env.DELAY_ALERT_HMAC_KEY_V1);
  const signatureHex = signDelayAlertPayload(payload, key);
  return { keyId: DELAY_ALERT_KEY_ID, requestId, payload, signatureHex };
}
