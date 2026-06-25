// Phone call / SMS launchers. Resolves a contact name (or raw number) to a
// number, then opens the dialer / messaging app via RN Linking. Opening the
// dialer (not auto-calling) needs no CALL_PHONE permission and keeps the user
// in control — they place the call / send the message themselves.

import { Linking } from "react-native";
import type { ToolCallResult, Language } from "../orchestrator/types";
import { resolveContactNumber, type ResolveResult } from "./contacts";

// Localized message for a contact that couldn't be resolved — distinguishing a
// missing permission from a genuine no-match (don't claim the contact is absent
// when we simply weren't allowed to look).
function unresolvedResult(
  failure: Extract<ResolveResult, { ok: false }>,
  contact: string,
  lang: Language,
): ToolCallResult {
  if (failure.reason === "permission") {
    return {
      success: false,
      message:
        lang === "it"
          ? "Mi servono i permessi per accedere ai contatti."
          : "I need permission to access your contacts.",
      error: "permission denied",
    };
  }
  return {
    success: false,
    message:
      lang === "it"
        ? `Non ho trovato un numero per "${contact}".`
        : `Couldn't find a number for "${contact}".`,
    error: "no matching contact",
  };
}

export async function makeCall(
  contact: string,
  lang: Language,
): Promise<ToolCallResult> {
  const resolved = await resolveContactNumber(contact);
  if (!resolved.ok) return unresolvedResult(resolved, contact, lang);

  try {
    await Linking.openURL(`tel:${resolved.number}`);
    return {
      success: true,
      message: lang === "it" ? `Chiamo ${resolved.name}` : `Calling ${resolved.name}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: lang === "it" ? "Chiamata non riuscita." : "Failed to start call.",
      error: msg,
    };
  }
}

export async function sendSms(
  contact: string,
  text: string,
  lang: Language,
): Promise<ToolCallResult> {
  const resolved = await resolveContactNumber(contact);
  if (!resolved.ok) return unresolvedResult(resolved, contact, lang);

  // sms:<number>?body=<text> opens the messaging app with the message
  // pre-filled; the user taps send.
  const url = `sms:${resolved.number}?body=${encodeURIComponent(text ?? "")}`;
  try {
    await Linking.openURL(url);
    return {
      success: true,
      message:
        lang === "it"
          ? `Messaggio per ${resolved.name} pronto da inviare`
          : `Message to ${resolved.name} ready to send`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message:
        lang === "it"
          ? "Impossibile aprire l'app messaggi."
          : "Failed to open the messaging app.",
      error: msg,
    };
  }
}
