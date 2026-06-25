// Address-book access via expo-contacts. Handles the READ_CONTACTS runtime
// permission and shapes results for the model. Fully on-device.

import * as Contacts from "expo-contacts";
import type { ToolCallResult, Language } from "../orchestrator/types";

export type ResolveResult =
  | { ok: true; name: string; number: string }
  | { ok: false; reason: "permission" | "not_found" };

async function hasContactsPermission(): Promise<boolean> {
  const { status } = await Contacts.requestPermissionsAsync();
  return status === "granted";
}

// Returns contacts matching `query` (by name), each with their phone numbers,
// as ToolCallResult.data for the model to summarize in natural language.
// Only the failure messages are user-facing (success feeds a follow-up answer).
export async function searchContacts(
  query: string,
  lang: Language,
): Promise<ToolCallResult> {
  const q = query?.trim();
  if (!q) {
    return {
      success: false,
      message:
        lang === "it" ? "Manca il nome da cercare." : "Missing a name to search for.",
      error: "query is empty",
    };
  }

  if (!(await hasContactsPermission())) {
    return {
      success: false,
      message:
        lang === "it"
          ? "Mi servono i permessi per accedere ai contatti."
          : "I need permission to access your contacts.",
    };
  }

  try {
    const { data } = await Contacts.getContactsAsync({
      name: q,
      fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
    });
    // Filter client-side too: name matching in getContactsAsync is unreliable
    // across Android versions, so never trust it to have narrowed the list.
    const needle = q.toLowerCase();
    const matches = data
      .filter((c) => (c.name ?? "").toLowerCase().includes(needle))
      .slice(0, 10)
      .map((c) => ({
        name: c.name ?? "(no name)",
        numbers: (c.phoneNumbers ?? [])
          .map((p) => p.number)
          .filter((n): n is string => !!n),
      }));

    return {
      success: true,
      message: `Found ${matches.length} contact(s)`,
      data: JSON.stringify(matches),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message:
        lang === "it" ? "Ricerca contatti non riuscita." : "Failed to search contacts.",
      error: msg,
    };
  }
}

// Resolves a contact name or raw number to a dialable number, distinguishing a
// missing permission from a genuine no-match so callers can tell the user the
// real reason.
export async function resolveContactNumber(input: string): Promise<ResolveResult> {
  const value = input?.trim();
  if (!value) return { ok: false, reason: "not_found" };

  // Already a phone number? Normalize to digits and a leading "+", and require
  // at least 3 actual digits so junk like "+-+" falls through to name lookup.
  const normalized = value.replace(/[^\d+]/g, "");
  if (/^\+?\d{3,}$/.test(normalized)) {
    return { ok: true, name: value, number: normalized };
  }

  if (!(await hasContactsPermission())) return { ok: false, reason: "permission" };

  const { data } = await Contacts.getContactsAsync({
    name: value,
    fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
  });
  const needle = value.toLowerCase();
  const hit = data.find(
    (c) =>
      (c.name ?? "").toLowerCase().includes(needle) &&
      (c.phoneNumbers?.length ?? 0) > 0,
  );
  const number = hit?.phoneNumbers?.[0]?.number;
  if (!hit || !number) return { ok: false, reason: "not_found" };
  return { ok: true, name: hit.name ?? value, number: number.replace(/[^\d+]/g, "") };
}
